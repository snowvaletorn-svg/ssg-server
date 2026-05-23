// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      1.4.4
// @description  Monitors and submits foreign stock data dynamically using explicit text node analysis and hybrid polling. PC + Torn PDA friendly.
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
    const MIN_SUBMIT_INTERVAL_MS = 10000;

    let lastSubmitTime = 0;
    let statusIndicator = null;
    let playerId = null;
    let playerName = null;
    let currentCountry = null;
    let pageMutationObserver = null;
    let debounceTimer = null;
    let heartbeatInterval = null;
    
    const completedPageStates = new Set();
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
        header.innerHTML = `<span style="font-weight:bold; color:#fff;">SSG Stock Observer v1.4.3 - Diagnostics</span>`;
        
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
        // Try multiple sources to find the player ID
        try {
            // Method 1: Check unsafeWindow.user (most common for Torn pages)
            const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (win && win.user) {
                playerId = win.user.id;
                playerName = win.user.name;
                logTrace(`User verified via window.user: ${playerName} (${playerId})`);
                return true;
            }
        } catch (e) {
            logTrace(`User context acquisition failure (method 1)`, { error: e.message });
        }

        // Method 2: Check for user data in Torn's global userdata variable
        try {
            const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (win && win.userdata && win.userdata.id) {
                playerId = win.userdata.id;
                playerName = win.userdata.name || win.userdata.username || 'Unknown';
                logTrace(`User verified via window.userdata: ${playerName} (${playerId})`);
                return true;
            }
        } catch (e) {
            logTrace(`User context acquisition failure (method 2)`, { error: e.message });
        }

        // Method 3: Extract from Torn page's user-info elements
        try {
            const userInfoEl = document.querySelector('.user-info-name, .user-name, [class*="user-info"] a, #user-profile a, .msg-wrap .user, [href*="profiles.php?XID="]');
            if (userInfoEl) {
                const href = userInfoEl.getAttribute('href') || '';
                const match = href.match(/XID=(\d+)/);
                if (match && match[1]) {
                    playerId = parseInt(match[1], 10);
                    playerName = userInfoEl.textContent.trim();
                    logTrace(`User verified via page element: ${playerName} (${playerId})`);
                    return true;
                }
            }
        } catch (e) {
            logTrace(`User context acquisition failure (method 3)`, { error: e.message });
        }

        // Method 4: Extract from Torn's API key in localStorage
        try {
            // Torn sometimes stores user info in localStorage
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('user') || key.includes('player') || key.includes('torn'))) {
                    try {
                        const val = JSON.parse(localStorage.getItem(key));
                        if (val && val.player_id) {
                            playerId = val.player_id;
                            playerName = val.name || val.username || 'Unknown';
                            logTrace(`User verified via localStorage: ${playerName} (${playerId})`);
                            return true;
                        }
                        if (val && val.id && typeof val.id === 'number') {
                            playerId = val.id;
                            playerName = val.name || val.username || 'Unknown';
                            logTrace(`User verified via localStorage.data: ${playerName} (${playerId})`);
                            return true;
                        }
                    } catch (e2) { /* not JSON, skip */ }
                }
            }
        } catch (e) {
            logTrace(`User context acquisition failure (method 4)`, { error: e.message });
        }

        // Method 5: Try to find player ID in Torn cookies
        try {
            const cookies = document.cookie.split(';');
            for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'player_id' || name === 'user_id' || name === 'torn_user_id') {
                    playerId = parseInt(value, 10);
                    playerName = 'Unknown';
                    logTrace(`User verified via cookie: ${playerId}`);
                    return true;
                }
            }
        } catch (e) {
            logTrace(`User context acquisition failure (method 5)`, { error: e.message });
        }

        logTrace(`Failed to detect user from any source. Will use 0 as fallback.`);
        return false;
    }

    function detectCountry() {
        const countryConfig = [
            { name: 'Mexico', codes: ['mex', 'mexico'] },
            { name: 'Cayman Islands', codes: ['cay', 'cayman', 'cayman islands'] },
            { name: 'Canada', codes: ['can', 'canada'] },
            { name: 'Hawaii', codes: ['haw', 'hawaii'] },
            { name: 'United Kingdom', codes: ['uni', 'united kingdom', 'uk', 'london'] },
            { name: 'Argentina', codes: ['arg', 'argentina'] },
            { name: 'Switzerland', codes: ['swi', 'switzerland'] },
            { name: 'Japan', codes: ['jap', 'japan'] },
            { name: 'China', codes: ['chi', 'china'] },
            { name: 'UAE', codes: ['uae', 'dubai'] },
            { name: 'South Africa', codes: ['sou', 'south africa'] }
        ];
        
        const entireText = document.body.textContent || '';
        const lowerText = entireText.toLowerCase();
        
        // First: Check if we're in transit (flying) - if so, don't detect any country
        const flightIndicators = ['flight to', 'arriving in', 'travelling to', 'traveling to', 'on a flight', 'in transit', 'departed'];
        for (const indicator of flightIndicators) {
            if (lowerText.includes(indicator)) {
                // If flight indicators exist without arrival indicators, we're still flying
                const arrivalIndicators = ['currently in', 'you are in', 'stock market', 'items for sale'];
                const hasArrived = arrivalIndicators.some(a => lowerText.includes(a));
                if (!hasArrived) {
                    return null; // Still in flight, don't detect country
                }
            }
        }
        
        // Method 1: Look for heading/title elements containing full country names (most reliable)
        const headings = document.querySelectorAll('h1, h2, h3, h4, .title, .page-title, .content-title, [class*="heading"], [class*="header"]');
        for (const el of headings) {
            const text = (el.textContent || '').toLowerCase();
            for (const config of countryConfig) {
                // Only match full country names in headings (no short codes)
                if (text.includes(config.name.toLowerCase())) {
                    return config.name;
                }
            }
        }
        
        // Method 2: Check common markers in page text (only when actually in-country)
        const countryMarkers = [
            { name: 'Mexico', patterns: ['currently in mexico', 'you are in mexico', 'items for sale in mexico', 'mexico stock market'] },
            { name: 'Cayman Islands', patterns: ['currently in cayman', 'you are in cayman', 'items for sale in cayman', 'cayman islands stock'] },
            { name: 'Canada', patterns: ['currently in canada', 'you are in canada', 'items for sale in canada', 'canada stock market'] },
            { name: 'Hawaii', patterns: ['currently in hawaii', 'you are in hawaii', 'items for sale in hawaii', 'hawaii stock market'] },
            { name: 'United Kingdom', patterns: ['currently in united kingdom', 'you are in united kingdom', 'items for sale in united kingdom', 'united kingdom stock', 'items for sale in uk', 'uk stock market'] },
            { name: 'Argentina', patterns: ['currently in argentina', 'you are in argentina', 'items for sale in argentina', 'argentina stock market'] },
            { name: 'Switzerland', patterns: ['currently in switzerland', 'you are in switzerland', 'items for sale in switzerland', 'switzerland stock market'] },
            { name: 'Japan', patterns: ['currently in japan', 'you are in japan', 'items for sale in japan', 'japan stock market'] },
            { name: 'China', patterns: ['currently in china', 'you are in china', 'items for sale in china', 'china stock market'] },
            { name: 'UAE', patterns: ['currently in uae', 'you are in uae', 'items for sale in uae', 'uae stock market', 'items for sale in dubai'] },
            { name: 'South Africa', patterns: ['currently in south africa', 'you are in south africa', 'items for sale in south africa', 'south africa stock market'] }
        ];
        
        for (const marker of countryMarkers) {
            for (const pattern of marker.patterns) {
                if (lowerText.includes(pattern)) {
                    return marker.name;
                }
            }
        }
        
        // Method 3: Full country name as whole word match only (prevent "sou" matching "resource")
        // Uses word boundaries to avoid partial matches
        for (const config of countryConfig) {
            const fullName = config.name.toLowerCase();
            const regex = new RegExp('\\b' + fullName.replace(/ /g, '\\s') + '\\b', 'i');
            if (regex.test(entireText)) {
                // Only match if we also see arrival indicators nearby
                if (lowerText.includes('stock') || lowerText.includes('market') || lowerText.includes('items for sale') || lowerText.includes('currently')) {
                    return config.name;
                }
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

    function scrapeStocks() {
        const stocks = [];
        
        // Dynamic search of common row containers
        const rows = document.querySelectorAll(
            '.travel-agency-market .users-list > li, ' +
            '.travel-market-list .item-row, ' +
            '.content-wrapper li, ' +
            '.content-wrapper tr, ' +
            '#mainContainer li, ' +
            'tr, li'
        );
        
        rows.forEach((row) => {
            if (row.querySelector('th') || row.classList.contains('clear') || row.classList.contains('title')) return;

            // Target structural class definitions cleanly
            const nameEl = row.querySelector('.name, .item-name, .title, [class*="name"]');
            const qtyEl = row.querySelector('.stkmkt-qty, .quantity, .stock, .count, [class*="quantity"], [class*="stock"]');
            const costEl = row.querySelector('.stkmkt-value, .cost, .price, .value, [class*="cost"], [class*="price"]');

            if (nameEl && qtyEl && costEl) {
                const name = (nameEl.textContent || '').trim();
                const qty = parseNumeric(qtyEl.textContent);
                const cost = parseNumeric(costEl.textContent);

                if (name && qty !== null && cost !== null && !stocks.some(s => s.name === name)) {
                    stocks.push({ name, quantity: qty, cost });
                }
            } else {
                // Fallback text cell breakdown mapping loop
                const divs = row.querySelectorAll(':scope > div, :scope > span, :scope > td');
                if (divs.length >= 3) {
                    const rowText = row.textContent || '';
                    if (rowText.includes('$')) {
                        // Use the first div as name, parse numbers from all divs for qty/cost
                        const name = (divs[0].textContent || '').trim();
                        const numbers = [];
                        divs.forEach(d => {
                            const n = parseNumeric(d.textContent);
                            if (n !== null) numbers.push(n);
                        });
                        let qty = numbers.length > 0 ? numbers[0] : null;
                        let cost = numbers.length > 1 ? numbers[1] : null;

                        // Final structural block data type confirmation
                        if (name && qty !== null && cost !== null && !isNaN(qty) && !isNaN(cost)) {
                            // Filter headers and dirty strings out
                            if (!stocks.some(s => s.name === name) && !['item', 'product', 'name', 'type', 'avail'].includes(name.toLowerCase())) {
                                stocks.push({ name, quantity: qty, cost });
                            }
                        }
                    }
                }
            }
        });

        if (stocks.length > 0) {
            stocks.forEach((s, i) => { s.id = -1 - i; });
        }
        
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

        const stateKey = currentCountry + "_" + stocks.length + "_" + stocks.reduce((acc, s) => acc + s.quantity, 0);
        if (completedPageStates.has(stateKey)) {
            return; // Dropped to avoid duplicating existing records on current tick
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

        const url = SSG_SERVER + '/api/stock-observe';
        const body = JSON.stringify(payload);

        logTrace(`Dispatching stock update array (${stocks.length} records) to Mongoose pipeline.`);

        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                onload: function(response) {
                    logTrace(`Server status trace: ${response.status}`);
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
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            })
            .then(res => {
                if (res.ok) {
                    setStatus('submitted');
                    completedPageStates.add(stateKey);
                    logTrace(`SUCCESS: Native window fallback sync complete.`);
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

        // Re-detect user on each cycle if we don't have it yet
        if (!playerId) {
            detectUser();
        }

        const countryName = detectCountry();
        const countryCode = countryName ? countryToCode(countryName) : null;

        if (countryCode) {
            currentCountry = countryCode;
            const stocks = scrapeStocks();
            
            if (stocks.length > 0) {
                logTrace(`Valid stock arrays verified. Passing data down pipeline.`);
                submitStocks(stocks);
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

        // FORCE IMMEDIATE PROCESS CALL INSTEAD OF WAITING ON MUTATIONS
        logTrace(`Executing immediate upfront document analysis scan.`);
        processPageParsing();

        // Standard Mutation tracking capture link
        pageMutationObserver = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processPageParsing();
            }, 400); 
        });
        pageMutationObserver.observe(document.body, { childList: true, subtree: true });

        // HYBRID HEARTBEAT LOOP: Fires a safety check every 1.5s to capture dynamic mobile loading scripts
        heartbeatInterval = setInterval(() => {
            processPageParsing();
        }, 1500);

        logTrace(`System live. Mutation listener + Hybrid Heartbeat loop active.`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('beforeunload', () => {
        if (pageMutationObserver) pageMutationObserver.disconnect();
        if (heartbeatInterval) clearInterval(heartbeatInterval);
    });
})();