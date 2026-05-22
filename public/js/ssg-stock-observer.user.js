// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      1.1.0
// @description  Automatically submits foreign stock data to SSG Dashboard when you visit torn.com/travel.php while abroad. PC + Torn PDA friendly.
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
    const SUBMIT_INTERVAL_MS = 60000; 
    const PING_INTERVAL_MS = 2000; // Checked slightly faster for snappier loading

    let lastSubmitTime = 0;
    let statusIndicator = null;
    let playerId = null;
    let playerName = null;
    let currentCountry = null;
    let pingInterval = null;
    let recheckInterval = null;

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
                'idle': '🟡 Waiting for stock data...',
                'submitted': '🟢 Stock data submitted',
                'error': '🔴 Error submitting data',
                'disabled': '⚫ Observer disabled',
                'unknown': '⚪ Initializing...'
            }[status] || '⚪ Checking...';
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

    // ─── DETECT USER ───────────────────────────────────────────────────────

    function detectUser() {
        try {
            const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (win.user) {
                playerId = win.user.id;
                playerName = win.user.name;
                return true;
            }
        } catch (e) {
            // Context/cross-origin handling
        }
        return false;
    }

    // ─── DETECT COUNTRY ────────────────────────────────────────────────────

    function detectCountry() {
        const countries = [
            'Mexico', 'Cayman Islands', 'Canada', 'Hawaii', 
            'United Kingdom', 'Argentina', 'Switzerland', 
            'Japan', 'China', 'UAE', 'South Africa'
        ];
        
        // Method 1: Look at Torn's native travel header container text
        const travelHeader = document.querySelector('.travel-agency-header, .travel-header, .title-container');
        const entireText = document.body.textContent || '';
        
        // Fallback checks on the container element or body text
        for (const country of countries) {
            const regex = new RegExp(`(currently in|welcome to|landed in|stock in)\\s*${country}`, 'i');
            if (regex.test(entireText) || (travelHeader && travelHeader.textContent.toLowerCase().includes(country.toLowerCase()))) {
                return country;
            }
        }

        // Method 2: Fallback selector patterns
        const titleEl = document.querySelector('.travel-title, .destination-title, h2, h3');
        if (titleEl) {
            const text = titleEl.textContent || '';
            for (const country of countries) {
                if (text.toLowerCase().includes(country.toLowerCase())) return country;
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

    // ─── SCRAPE STOCK TABLE ────────────────────────────────────────────────

    function scrapeStocks() {
        const stocks = [];
        
        // Targeted selectors targeting modern Torn travel list structures 
        const stockRows = document.querySelectorAll(
            '.travel-agency-market .users-list > li, ' +
            '.travel-market-list .item-row, ' +
            '.stock-item, ' +
            'table.travel-stock tr'
        );

        if (stockRows.length > 0) {
            stockRows.forEach(row => {
                // Ignore headers if applicable
                if (row.classList.contains('clear') || row.querySelector('.title')) return;

                const nameEl = row.querySelector('.name, .item-name, .title');
                const qtyEl = row.querySelector('.stkmkt-qty, .quantity, .stock, .count');
                const costEl = row.querySelector('.stkmkt-value, .cost, .price, .value');

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

        // Pass explicit sequential IDs if server expects it
        if (stocks.length > 0) {
            stocks.forEach((s, i) => { s.id = -1 - i; });
        }

        return stocks;
    }

    // ─── SUBMIT DATA ───────────────────────────────────────────────────────

    function submitStocks(stocks) {
        if (!ENABLED) {
            setStatus('disabled');
            return;
        }

        const now = Date.now();
        if (now - lastSubmitTime < 5000) return; // Drop safety window slightly to 5s
        lastSubmitTime = now;

        // Try user detection right before submitting if it wasn't caught at init
        if (!playerId) detectUser();

        const payload = {
            playerId: playerId || 0, // Fallback to 0 if Torn window hook is being stubborn
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
                        console.log('[SSG Stock Observer] API Response Accepted');
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

    // ─── MAIN CHECK FUNCTION ───────────────────────────────────────────────

    function checkAndSubmit() {
        if (!ENABLED) return;

        const stocks = scrapeStocks();
        if (stocks.length > 0) {
            const countryName = detectCountry();
            const country = countryName ? countryToCode(countryName) : null;
            if (country) {
                currentCountry = country;
                submitStocks(stocks);
            } else {
                setStatus('idle');
                console.log('[SSG Stock Observer] Items found but country matching delayed.');
            }
        } else {
            // Keep status badging active if user is explicitly on a travel view
            if (document.querySelector('.travel-agency-market, .travel-agency-header, #travel-main')) {
                setStatus('idle');
            } else if (statusIndicator) {
                statusIndicator.style.display = 'none';
            }
        }
    }

    // ─── INIT ───────────────────────────────────────────────────────────────

    function init() {
        if (!ENABLED) return;

        detectUser();
        statusIndicator = createStatusBadge();
        setStatus('idle');

        // Setup dynamic interval loops
        pingInterval = setInterval(() => {
            const stocks = scrapeStocks();
            
            if (stocks.length > 0) {
                const countryName = detectCountry();
                const countryCode = countryName ? countryToCode(countryName) : null;
                
                if (countryCode) {
                    currentCountry = countryCode;
                    submitStocks(stocks);
                    
                    // Kill aggressive pinging cycle once we've successfully dropped our load
                    clearInterval(pingInterval);
                    pingInterval = null;
                }
            }
            
            if (!recheckInterval) {
                recheckInterval = setInterval(checkAndSubmit, SUBMIT_INTERVAL_MS);
            }
        }, PING_INTERVAL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('beforeunload', () => {
        if (pingInterval) clearInterval(pingInterval);
        if (recheckInterval) clearInterval(recheckInterval);
    });
})();