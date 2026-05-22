// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      1.4.0
// @description  Monitors and submits foreign stock data dynamically using safe layout DOM mapping. PC + Torn PDA friendly.
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
    const MIN_SUBMIT_INTERVAL_MS = 10000; // 10s anti-spam protection

    let lastSubmitTime = 0;
    let statusIndicator = null;
    let playerId = null;
    let playerName = null;
    let currentCountry = null;
    let pageMutationObserver = null;
    let debounceTimer = null;
    
    // Tracking set to ensure we don't spam duplicate uploads on the same page state
    const completedPageStates = new Set();

    // Diagnostic Log History Buffer
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

    // ─── UI INTERACTIVE DIAGNOSTICS ──────────────────────────────────────────

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
        header.innerHTML = `<span style="font-weight:bold; color:#fff;">SSG Stock Observer v1.4.0 - Diagnostics</span>`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '❌ Close Logs';
        closeBtn.style.cssText = 'background:#e74c3c; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:4px;';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);
        overlay.appendChild(header);

        const textLogs = document.createElement('textarea');
        textLogs.readOnly = true;
        textLogs.style.cssText = 'flex-grow:1; background:#0d1117; color:#c9d1d9; border:1px solid #30363d; padding:10px; font-size:12px; resize:none; border-radius:4px;';
        
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

    // ─── RESILIENT DATA PARSING ─────────────────────────────────────────────

    function detectUser() {
        try {
            const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (win && win.user) {
                playerId = win.user.id;
                playerName = win.user.name;
                logTrace(`User verified: ${playerName} (${playerId})`);
                return true;
            }
        } catch (e) {
            logTrace(`User context acquisition failure`, { error: e.message });
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

    function parseNumeric(text) {
        if (!text) return null;
        const cleaned = text.replace(/,/g, '').trim();
        const match = cleaned.match(/\d+/);
        return match ? parseInt(match, 10) : null;
    }

    // DroqsDB-inspired robust text node scanning (bypasses broken CSS selectors)
    function scrapeStocks() {
        const stocks = [];
        
        // Scan common block elements in the travel container layout
        const rows = document.querySelectorAll('.content-wrapper li, .content-wrapper tr, [class*="travel-"] li, .travel-market-list .item-row');
        
        logTrace(`Scraper triggered. Evaluating ${rows.length} generic text nodes.`);

        rows.forEach((row) => {
            if (row.querySelector('th') || row.classList.contains('clear') || row.classList.contains('title')) return;

            const textContent = row.textContent || '';
            // If there's no money sign present, this is not a stock transaction line
            if (!textContent.includes('$')) return; 

            // Safely breakdown inner cell arrays regardless of Torn's random class updates
            const cells = row.querySelectorAll('div, span, td, p');
            
            // Clean out hidden elements or empty container text nodes
            const validCells = Array.from(cells).filter(c => c.textContent.trim().length > 0);

            if (validCells.length >= 3) {
                let name = validCells.textContent.trim().split('\n').trim();
                let qty = parseNumeric(validCells.textContent);
                let cost = parseNumeric(validCells.textContent);

                // Ensure data is mathematically structured before saving
                if (name && qty !== null && cost !== null && !isNaN(qty) && !isNaN(cost)) {
                    // Prevent pushing duplicate entries of the same item name in a single pass
                    if (!stocks.some(s => s.name === name)) {
                        stocks.push({ name, quantity: qty, cost });
                    }
                }
            }
        });

        if (stocks.length > 0) {
            stocks.forEach((s, i) => { s.id = -1 - i; });
        }
        
        logTrace(`Scrape phase finalized. Extracted: ${stocks.length} structured stock records.`);
        return stocks;
    }

    // ─── TRANSMIT DATA WITH CORS SAFEGUARDS ──────────────────────────────────

    function submitStocks(stocks) {
        if (!ENABLED) {
            setStatus('disabled');
            return;
        }

        const now = Date.now();
        if (now - lastSubmitTime < MIN_SUBMIT_INTERVAL_MS) return; 

        // Generate a unique fingerprint for this specific stock count payload
        const stateKey = currentCountry + "_" + stocks.length + "_" + stocks.reduce((acc, s) => acc + s.quantity, 0);
        if (completedPageStates.has(stateKey)) {
            logTrace(`Payload dropped: State signature ${stateKey} already synced to server.`);
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

        logTrace(`Dispatching secure out-of-context upload to: ${url}`);

        // EXPLICITLY REQUIRE GM FOR PC AND FALLBACK SAFELY FOR MOBILE APP CONTAINER WIRES
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                onload: function(response) {
                    logTrace(`Network callback returned: Status Code ${response.status}`);
                    if (response.status === 200 || response.status === 201) {
                        setStatus('submitted');
                        completedPageStates.add(stateKey);
                        logTrace(`SUCCESS: Data saved to Mongoose pipeline.`);
                    } else {
                        setStatus('error');
                        logTrace(`REJECTED: Server code ${response.status}. Raw string reply: ${response.responseText}`);
                    }
                },
                onerror: (err) => {
                    setStatus('error');
                    logTrace(`CRITICAL DROP: Extension network layer crashed. Check extension security tab.`, err);
                }
            });
        } else {
            logTrace(`GM object unavailable. Attempting fallback via native DOM window pipeline.`);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            })
            .then(res => {
                if (res.ok) {
                    setStatus('submitted');
                    completedPageStates.add(stateKey);
                } else {
                    setStatus('error');
                    logTrace(`Native Fetch failed. Server status: ${res.status}`);
                }
            })
            .catch((fetchErr) => {
                setStatus('error');
                logTrace(`CORS / NETWORK LOCK: Native browser engine rejected connection payload.`, { message: fetchErr.message });
            });
        }
    }

    // ─── ENGINE RUN TIME EXECUTION ──────────────────────────────────────────

    function processPageParsing() {
        if (!ENABLED) return;

        const countryName = detectCountry();
        const countryCode = countryName ? countryToCode(countryName) : null;

        if (countryCode) {
            currentCountry = countryCode;
            const stocks = scrapeStocks();
            
            if (stocks.length > 0) {
                submitStocks(stocks);
            } else {
                setStatus('idle');
            }
        } else {
            setStatus('idle');
        }
    }

    // ─── INITIALIZATION ─────────────────────────────────────────────────────

    function init() {
        if (!ENABLED) return;
        logTrace(`Boot initialization running.`);

        detectUser();
        statusIndicator = createStatusBadge();
        setStatus('idle');

        processPageParsing();

        // Standard 400ms Debounced Page Watcher loop
        pageMutationObserver = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processPageParsing();
            }, 400); 
        });

        pageMutationObserver.observe(document.body, { childList: true, subtree: true });
        logTrace(`System live. Mutation listener attached successfully.`);
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