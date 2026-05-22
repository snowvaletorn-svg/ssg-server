// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      1.3.1
// @description  Monitors and submits foreign stock data dynamically using MutationObservers on page changes. Includes persistent UI overlay logs.
// @author       SSG
// @match        *://*.torn.com/travel.php*
// @match        *://*.torn.com/page.php?sid=travel*
// @match        *://torn.com/page.php?sid=travel*
// @icon         https://www.google.com/s2/favicons?domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      ssg-server.onrender.com
// @connect      torn.com
// @connect      www.torn.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ─── CONFIG ─────────────────────────────────────────────────────────────
    const SSG_SERVER = 'https://ssg-server.onrender.com';
    const ENABLED = true;
    const MIN_SUBMIT_INTERVAL_MS = 10000; // 10s anti-spam protection rule

    let lastSubmitTime = 0;
    let statusIndicator = null;
    let playerId = null;
    let playerName = null;
    let currentCountry = null;
    let pageMutationObserver = null;
    
    // Diagnostic History Buffer
    const debugLogs = [];

    function logTrace(message, errorObj = null) {
        const timestamp = new Date().toLocaleTimeString();
        let formattedStr = `[${timestamp}] ${message}`;
        if (errorObj) {
            formattedStr += ` | Details: ${JSON.stringify(errorObj)}`;
        }
        debugLogs.push(formattedStr);
        console.log(`[SSG-TRACE] ${message}`, errorObj || '');
    }

    // ─── UI HELPERS ─────────────────────────────────────────────────────────

    function showDiagnosticReport() {
        const existingOverlay = document.getElementById('ssg-debug-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'ssg-debug-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 10%;
            left: 10%;
            width: 80%;
            height: 80%;
            background: rgba(20, 24, 33, 0.98);
            color: #00ff66;
            font-family: monospace;
            padding: 20px;
            z-index: 9999999;
            border: 2px solid #34495e;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.7);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:15px; border-bottom:1px solid #2c3e50; padding-bottom:10px;';
        header.innerHTML = `<span style="font-weight:bold; color:#fff;">SSG Stock Observer v1.3.1 - System Diagnostics</span>`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '❌ Close Logs';
        closeBtn.style.cssText = 'background:#e74c3c; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:4px;';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);
        overlay.appendChild(header);

        const textLogs = document.createElement('textarea');
        textLogs.readOnly = true;
        textLogs.style.cssText = 'flex-grow:1; background:#0d1117; color:#c9d1d9; border:1px solid #30363d; padding:10px; font-size:12px; resize:none; border-radius:4px;';
        
        // Build out current context state header block
        let reportStr = `ENVIRONMENT STATS:\n`;
        reportStr += `--------------------------------------------------\n`;
        reportStr += `Target Server : ${SSG_SERVER}\n`;
        reportStr += `Current Player: ${playerName || 'NOT_DETECTED'} (${playerId || '???'})\n`;
        reportStr += `Detected Zone : ${currentCountry || 'NOT_IN_FOREIGN_COUNTRY'}\n`;
        reportStr += `UserAgent     : ${navigator.userAgent}\n`;
        reportStr += `GM Network    : ${typeof GM_xmlhttpRequest !== 'undefined' ? 'Available (Extension Mode)' : 'Unavailable (Native Fetch Mode)'}\n`;
        reportStr += `--------------------------------------------------\n\nLOG EVENT HISTORY:\n`;
        reportStr += debugLogs.join('\n');

        textLogs.value = reportStr;
        overlay.appendChild(textLogs);
        document.body.appendChild(overlay);
    }

    function createStatusBadge() {
        const existing = document.getElementById('ssg-stock-badge');
        if (existing) existing.remove();

        const badge = document.createElement('div');
        badge.id = 'ssg-stock-badge';
        badge.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            z-index: 999999;
            box-shadow: 0 0 6px rgba(0,0,0,0.6);
            transition: background 0.3s;
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.4);
        `;
        badge.title = 'Click for SSG System Logs';
        badge.onclick = () => showDiagnosticReport();
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
                logTrace(`User verification hook resolved: ${playerName} (${playerId})`);
                return true;
            }
        } catch (e) {
            logTrace(`User context acquisition exception`, { error: e.message });
        }
        return false;
    }

    function detectCountry() {
        const countries = [
            'Mexico', 'Cayman Islands', 'Canada', 'Hawaii', 
            'United Kingdom', 'Argentina', 'Switzerland', 
            'Japan', 'China', 'UAE', 'South Africa'
        ];
        
        const entireText = document.body.textContent || '';
        
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

        logTrace(`Scraper triggered. Found total DOM rows matching selectors: ${stockRows.length}`);

        if (stockRows.length > 0) {
            stockRows.forEach((row, idx) => {
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
                } else {
                    // Log out specific DOM structural failures if layout changes
                    if (idx === 0) {
                        logTrace(`Row layout pattern evaluation failed. Element structural map:`, {
                            hasName: !!nameEl, hasQty: !!qtyEl, hasCost: !!costEl
                        });
                    }
                }
            });
        }

        if (stocks.length > 0) {
            stocks.forEach((s, i) => { s.id = -1 - i; });
        }
        logTrace(`Scrape engine evaluation completed. Total elements validated: ${stocks.length}`);
        return stocks;
    }

    // ─── TRANSMIT DATA ──────────────────────────────────────────────────────

    function submitStocks(stocks) {
        if (!ENABLED) {
            setStatus('disabled');
            logTrace(`Submission bypassed: Script execution is set to explicit disabled state.`);
            return;
        }

        const now = Date.now();
        const splitDiff = now - lastSubmitTime;
        if (splitDiff < MIN_SUBMIT_INTERVAL_MS) {
            logTrace(`Submission throttled by anti-spam rule. Time delta: ${splitDiff}ms / Required: ${MIN_SUBMIT_INTERVAL_MS}ms`);
            return;
        } 
        lastSubmitTime = now;

        if (!playerId) detectUser();

        const payload = {
            playerId: playerId || 0, 
            playerName: playerName || 'Unknown Observer',
            country: currentCountry,
            observedAt: Math.floor(now / 1000),
            stocks: stocks
        };

        const url = SSG_SERVER + '/api/stocks';
        const body = JSON.stringify(payload);

        logTrace(`Beginning data transmission to endpoint: ${url}`);

        if (typeof GM_xmlhttpRequest !== 'undefined') {
            logTrace(`Dispatching payload via GM_xmlhttpRequest loop.`);
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                onload: function(response) {
                    logTrace(`GM Response interceptor fired. Server Code: ${response.status}`);
                    if (response.status === 200 || response.status === 201) {
                        setStatus('submitted');
                        logTrace(`SUCCESS: Data pipeline accepted array structures cleanly.`);
                    } else {
                        setStatus('error');
                        logTrace(`FAILURE: Server threw validation error rejection. Raw Response Body:`, {
                            status: response.status,
                            text: response.responseText ? response.responseText.substring(0, 300) : 'None'
                        });
                    }
                },
                onerror: (err) => {
                    setStatus('error');
                    logTrace(`CRITICAL ERROR: GM execution block context level drop. Raw error details:`, err);
                }
            });
        } else {
            logTrace(`GM wrapper fallback. Dispatching pipeline payload via Standard Native Fetch window component.`);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            })
            .then(res => {
                logTrace(`Native Fetch Response interceptor fired. Server Code: ${res.status} | Ok: ${res.ok}`);
                if (res.ok) {
                    setStatus('submitted');
                } else {
                    setStatus('error');
                    logTrace(`Server returned rejection across standard fetch route.`);
                }
            })
            .catch((fetchErr) => {
                setStatus('error');
                logTrace(`CRITICAL ERROR: Native fetch context execution thrown. Network might be offline or blocked by CORS rules.`, {
                    message: fetchErr.message
                    style: fetchErr.stack ? 'Check browser cross-origin policy exceptions' : 'Unknown'
                });
            });
        }
    }

    // ─── RUN ENGINE PROCESSING ──────────────────────────────────────────────

    function processPageParsing() {
        if (!ENABLED) return;

        const countryName = detectCountry();
        const countryCode = countryName ? countryToCode(countryName) : null;

        if (countryCode) {
            if (currentCountry !== countryCode) {
                logTrace(`Location initialization completed. Structural Target: ${countryName} (${countryCode})`);
            }
            currentCountry = countryCode;
            const stocks = scrapeStocks();
            
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
        logTrace(`Boot sequence active. Running environment analysis...`);

        detectUser();
        statusIndicator = createStatusBadge();
        setStatus('idle');

        processPageParsing();

        const targetNode = document.body;
        const observerConfig = { childList: true, subtree: true };

        let searchTimeout = null;
        pageMutationObserver = new MutationObserver(() => {
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                processPageParsing();
            }, 800); 
        });

        pageMutationObserver.observe(targetNode, observerConfig);
        logTrace(`Mutation Tracking Core bound to active document body.`);
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