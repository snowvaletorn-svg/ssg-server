// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      1.2.0
// @description  Monitors and submits foreign stock data dynamically using MutationObservers on page changes. PC + Torn PDA friendly.
// @author       SSG
// @match        *://*.torn.com/travel.php*
// @match        *://*.torn.com/page.php?sid=travel*
// @match        *://torn.com/page.php?sid=travel*
// @icon         https://www.google.com/s2/favicons?domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      localhost
// @connect      127.0.0.1
// @connect      ssg-server.onrender.com
// @connect      torn.com
// @connect      www.torn.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ─── CONFIG ─────────────────────────────────────────────────────────────
    const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const DEFAULT_SERVER = IS_LOCAL ? 'http://localhost:3000' : 'https://ssg-server.onrender.com';
    const SSG_SERVER = GM_getValue('ssg_server_url', DEFAULT_SERVER);
    const ENABLED = GM_getValue('ssg_enabled', true);
    const MIN_SUBMIT_INTERVAL_MS = 10000; // 10s anti-spam protection rule

    let lastSubmitTime = 0;
    let statusIndicator = null;
    let playerId = null;
    let playerName = null;
    let currentCountry = null;
    let pageMutationObserver = null;

    // ─── UI HELPERS ─────────────────────────────────────────────────────────

    function createStatusBadge() {
        const existing = document.getElementById('ssg-stock-badge');
        if (existing) existing.remove();

        const badge = document.createElement('div');
        badge.id = 'ssg-stock-badge';
        badge.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            z-index: 999999;
            box-shadow: 0 0 4px rgba(0,0,0,0.5);
            transition: background 0.3s;
            cursor: pointer;
        `;
        badge.title = 'SSG Stock Observer';
        badge.onclick = () => {
            const status = badge.dataset.status || 'unknown';
            const statusText = {
                'idle': '🟡 Scanning page contents...',
                'submitted': '🟢 Stock data submitted successfully',
                'error': '🔴 Server rejected payload or offline',
                'disabled': '⚫ Observer module disabled',
                'unknown': '⚪ Initializing environment...'
            }[status] || '⚪ Processing...';
            alert(`SSG Stock Observer\nStatus: ${statusText}\nUser: ${playerName || 'Detecting...'} (${playerId || '???'})\nServer: ${SSG_SERVER}`);
        };
        document.body.appendChild(badge);
        return badge;
    }

    function setStatus(status) {
        if (!statusIndicator) statusIndicator = createStatusBadge();
        statusIndicator.dataset.status = status;
        const colors = {
            'idle': '#f0a500',
            'submitted': '#00c853',
            'error': '#ff4444',
            'disabled': '#555555',
            'unknown': '#888888'
        };
        statusIndicator.style.background = colors[status] || '#888888';
    }

    // ─── DETECT DATA LOOKUPS ────────────────────────────────────────────────

    function detectUser() {
        try {
            const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (win && win.user) {
                playerId = win.user.id;
                playerName = win.user.name;
                return true;
            }
        } catch (e) {}
        return false;
    }

    function detectCountry() {
        const countries = [
            'Mexico', 'Cayman Islands', 'Canada', 'Hawaii', 
            'United Kingdom', 'Argentina', 'Switzerland', 
            'Japan', 'China', 'UAE', 'South Africa'
        ];
        
        const entireText = document.body.textContent || '';
        
        // Broad capture matching array items inside modern ajax panels
        for (const country of countries) {
            const regex = new RegExp(`(currently in|welcome to|landed in|stock in|flight to|travelling to|traveling to|you are in)\\s*${country}`, 'i');
            if (regex.test(entireText)) {
                return country;
            }
        }
        return null;
    }

    function countryToCode(countryName) {
        const map = {
            'mexico': 'mex', 'cayman islands': 'cay', 'canada': 'can', 'hawaii': 'haw',
            'united kingdom': 'uni', 'argentina': 'arg', 'switzerland': 'swi',
            'japan': 'jap', 'china': 'chi', 'uae': 'uae', 'south africa': 'sou'
        };
        return map[(countryName || '').toLowerCase().trim()] || null;
    }

    function scrapeStocks() {
        const stocks = [];
        const stockRows = document.querySelectorAll(
            '.travel-agency-market .users-list > li, ' +
            '.travel-market-list .item-row, ' +
            '.stock-item, ' +
            '[class*="travel-"] li, ' +
            'table.travel-stock tr'
        );

        if (stockRows.length > 0) {
            stockRows.forEach(row => {
                if (row.classList.contains('clear') || row.querySelector('.title')) return;

                const nameEl = row.querySelector('.name, .item-name, .title, [class*="name"]');
                const qtyEl = row.querySelector('.stkmkt-qty, .quantity, .stock, .count, [class*="quantity"], [class*="stock"]');
                const costEl = row.querySelector('.stkmkt-value, .cost, .price, .value, [class*="cost"], [class*="price"]');

                if (nameEl && qtyEl && costEl) {
                    const name = nameEl.textContent.trim().split('\n')[0].trim();
                    const qtyText = qtyEl.textContent.trim().replace(/,/g, '').match(/\d+/);
                    const costText = costEl.textContent.trim().replace(/[$,]/g, '').match(/\d+/);
                    
                    const quantity = qtyText ? parseInt(qtyText[0]) : NaN;
                    const cost = costText ? parseInt(costText[0]) : NaN;
                    
                    if (name && !isNaN(quantity) && !isNaN(cost)) {
                        stocks.push({ name, quantity, cost });
                    }
                }
            });
        }

        if (stocks.length > 0) {
            stocks.forEach((s, i) => { s.id = -1 - i; });
        }
        return stocks;
    }

    // ─── TRANSMIT DATA ──────────────────────────────────────────────────────

    function submitStocks(stocks) {
        if (!ENABLED) {
            setStatus('disabled');
            return;
        }

        const now = Date.now();
        if (now - lastSubmitTime < MIN_SUBMIT_INTERVAL_MS) return; 
        lastSubmitTime = now;

        if (!playerId) detectUser();

        const payload = {
            playerId: playerId || 0, 
            playerName: playerName || 'Unknown Observer',
            country: currentCountry,
            observedAt: Math.floor(now / 1000),
            stocks: stocks
        };

        const url = SSG_SERVER + '/api/stock-observe';
        const body = JSON.stringify(payload);

        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                onload: function(response) {
                    if (response.status === 200) {
                        setStatus('submitted');
                        console.log('[SSG Stock Observer] Data successfully transferred to dashboard pipeline.');
                    } else {
                        setStatus('error');
                    }
                },
                onerror: () => setStatus('error')
            });
        } else {
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            })
            .then(res => res.ok ? setStatus('submitted') : setStatus('error'))
            .catch(() => setStatus('error'));
        }
    }

    // ─── RUN ENGINE PROCESSING ──────────────────────────────────────────────

    function processPageParsing() {
        if (!ENABLED) return;

        const countryName = detectCountry();
        const countryCode = countryName ? countryToCode(countryName) : null;

        if (countryCode) {
            currentCountry = countryCode;
            const stocks = scrapeStocks();
            
            // If we have either found data OR location text explicitly matched, sync with server
            if (stocks.length > 0 || countryName) {
                submitStocks(stocks);
            }
        } else {
            setStatus('idle');
        }
    }

    // ─── INITIALIZATION ─────────────────────────────────────────────────────

    function init() {
        if (!ENABLED) return;

        detectUser();
        statusIndicator = createStatusBadge();
        setStatus('idle');

        // Run an immediate baseline capture run
        processPageParsing();

        // Attach MutationObserver to handle Torn's dynamic content swaps smoothly
        const targetNode = document.body;
        const observerConfig = { childList: true, subtree: true };

        // Debounce tracking parameters so execution doesn't lock up computing frames
        let searchTimeout = null;
        pageMutationObserver = new MutationObserver(() => {
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                processPageParsing();
            }, 800); 
        });

        pageMutationObserver.observe(targetNode, observerConfig);
        console.log('[SSG Stock Observer] Dynamic DOM tracking initialized.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('beforeunload', () => {
        if (pageMutationObserver) pageMutationObserver.disconnect();
    });
})();