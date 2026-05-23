// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      2.0.0
// @description  Monitors and submits foreign stock data. Flight-aware: only polls when landed, uses arrival time estimation.
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
    let flightTimer = null;
    let landingTimer = null;
    
    const completedPageStates = new Set();
    const debugLogs = [];
    let stocksLogged = false;

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
        header.innerHTML = `<span style="font-weight:bold; color:#fff;">SSG Stock Observer v1.5.0 - Diagnostics</span>`;
        
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
        reportStr += `--------------------------------------------------\n\n`;
        reportStr += `LOG EVENT HISTORY:\n`;
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
                return true;
            }
        } catch (e) { /* fall through */ }

        try {
            const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            if (win && win.userdata && win.userdata.id) {
                playerId = win.userdata.id;
                playerName = win.userdata.name || win.userdata.username || 'Unknown';
                return true;
            }
        } catch (e) { /* fall through */ }

        try {
            const userInfoEl = document.querySelector('.user-info-name, .user-name, [class*="user-info"] a, #user-profile a, .msg-wrap .user, [href*="profiles.php?XID="]');
            if (userInfoEl) {
                const href = userInfoEl.getAttribute('href') || '';
                const match = href.match(/XID=(\d+)/);
                if (match && match[1]) {
                    playerId = parseInt(match[1], 10);
                    playerName = userInfoEl.textContent.trim();
                    return true;
                }
            }
        } catch (e) { /* fall through */ }

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('user') || key.includes('player') || key.includes('torn'))) {
                    try {
                        const val = JSON.parse(localStorage.getItem(key));
                        if (val && val.player_id) {
                            playerId = val.player_id;
                            playerName = val.name || val.username || 'Unknown';
                            return true;
                        }
                        if (val && val.id && typeof val.id === 'number') {
                            playerId = val.id;
                            playerName = val.name || val.username || 'Unknown';
                            return true;
                        }
                    } catch (e2) { /* skip */ }
                }
            }
        } catch (e) { /* fall through */ }

        try {
            const cookies = document.cookie.split(';');
            for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'player_id' || name === 'user_id' || name === 'torn_user_id') {
                    playerId = parseInt(value, 10);
                    playerName = 'Unknown';
                    return true;
                }
            }
        } catch (e) { /* fall through */ }

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
        
        // Method 1: Look for heading/title elements containing full country names
        const headings = document.querySelectorAll('h1, h2, h3, h4, .title, .page-title, .content-title, [class*="heading"], [class*="header"]');
        for (const el of headings) {
            const text = (el.textContent || '').toLowerCase();
            for (const config of countryConfig) {
                if (text.includes(config.name.toLowerCase())) {
                    return config.name;
                }
            }
        }
        
        // Method 2: Check common arrival markers in page text
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
        
        // Method 3: Full country name as whole word match
        for (const config of countryConfig) {
            const fullName = config.name.toLowerCase();
            const regex = new RegExp('\\b' + fullName.replace(/ /g, '\\s') + '\\b', 'i');
            if (regex.test(entireText)) {
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

    // ─── FLIGHT DETECTION ───────────────────────────────────────────────────

    function isInTransit() {
        const lowerText = (document.body.textContent || '').toLowerCase();
        const flightIndicators = ['flight to', 'arriving in', 'travelling to', 'traveling to', 'on a flight', 'departed', 'arrives in'];
        const arrivalIndicators = ['currently in', 'you are in', 'stock market', 'items for sale', 'travel home'];
        
        const hasFlightIndicators = flightIndicators.some(i => lowerText.includes(i));
        const hasArrived = arrivalIndicators.some(i => lowerText.includes(i));
        
        return hasFlightIndicators && !hasArrived;
    }

    function detectFlightTimeRemaining() {
        const lowerText = (document.body.textContent || '').toLowerCase();
        
        const minuteMatch = lowerText.match(/arriving in\s+(\d+)\s*minutes?/i);
        if (minuteMatch) return parseInt(minuteMatch[1], 10) * 60 * 1000;
        
        const hourMatch = lowerText.match(/arriving in\s+(\d+)\s*hours?/i);
        if (hourMatch) return parseInt(hourMatch[1], 10) * 3600 * 1000;
        
        const timerMatch = lowerText.match(/(\d+)m\s*(\d+)s\s*(?:remaining|left|to go)/i);
        if (timerMatch) return (parseInt(timerMatch[1], 10) * 60 + parseInt(timerMatch[2], 10)) * 1000;
        
        return null;
    }

    // ─── STOCK SCRAPING ─────────────────────────────────────────────────────

    function scrapeStocks() {
        const stocks = [];

        const stockTables = document.querySelectorAll('[class*="stockTableWrapper"]');
        
        if (stockTables.length > 0) {
            stockTables.forEach(table => parseStockTable(table, stocks));
        } else {
            // Fallback: try from shop containers
            const shopContainers = document.querySelectorAll('[class*="shops"]');
            shopContainers.forEach(container => {
                const wrappers = container.querySelectorAll('[class*="stockTableWrapper"]');
                wrappers.forEach(w => parseStockTable(w, stocks));
            });
        }

        // Fallback: cell scanning
        if (stocks.length === 0) {
            const nameEls = document.querySelectorAll('[class*="tabletColB"]');
            const costEls = document.querySelectorAll('[class*="displayPrice"]');
            
            if (nameEls.length > 0 && costEls.length > 0) {
                const processedParents = new Set();
                nameEls.forEach(nameEl => {
                    const row = nameEl.closest('[class*="cell"]') || nameEl.parentElement;
                    if (!row || processedParents.has(row)) return;
                    processedParents.add(row);
                    
                    const name = (nameEl.textContent || '').trim();
                    const rowParent = row.parentElement;
                    
                    if (rowParent) {
                        const cells = rowParent.querySelectorAll(':scope > [class*="cell"]');
                        let qty = null;
                        let cost = null;
                        
                        cells.forEach(cell => {
                            const cls = cell.className || '';
                            const text = (cell.textContent || '').trim();
                            if (cls.includes('tabletColC') || cls.includes('neededSpace')) {
                                const n = parseNumeric(text);
                                if (n !== null && !text.includes('$')) qty = n;
                            }
                            if (cls.includes('tabletColD') || cls.includes('displayPrice')) {
                                const n = parseNumeric(text);
                                if (n !== null) cost = n;
                            }
                        });
                        
                        if (name && qty !== null && cost !== null && qty > 0 && cost > 0) {
                            if (!stocks.some(s => s.name === name)) {
                                stocks.push({ name, quantity: qty, cost });
                            }
                        }
                    }
                });
            }
        }

        if (stocks.length > 0) {
            stocks.forEach((s, i) => { s.id = -1 - i; });
        }
        
        return stocks;
    }

    function parseStockTable(tableEl, stocks) {
        const children = tableEl.children;
        
        let sibling = tableEl.previousElementSibling;
        while (sibling) {
            if (sibling.className && sibling.className.includes('shopHeader')) {
                break;
            }
            sibling = sibling.previousElementSibling;
        }
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.className && child.className.includes('itemsHeader')) continue;
            
            const childText = (child.textContent || '').trim();
            if (!childText.includes('$') || childText.length < 10) continue;
            
            const nameEl = child.querySelector('[class*="tabletColB"]');
            const costEl = child.querySelector('[class*="displayPrice"]');
            const stockEl = child.querySelector('[class*="neededSpace"]');
            
            if (nameEl && costEl) {
                const name = (nameEl.textContent || '').trim().replace(/^buy\s+/i, '').replace(/^type\s+/i, '');
                const costNum = parseNumeric(costEl.textContent);
                let qtyNum = null;
                
                if (stockEl) {
                    const stockText = (stockEl.textContent || '').trim();
                    if (!stockText.includes('$')) {
                        qtyNum = parseNumeric(stockText);
                    }
                }
                
                if (qtyNum === null) {
                    const itemCells = child.querySelectorAll(':scope > div');
                    itemCells.forEach(cell => {
                        const cls = cell.className || '';
                        const txt = (cell.textContent || '').trim();
                        if (cls.includes('tabletColC')) {
                            const n = parseNumeric(txt);
                            if (n !== null && !txt.includes('$')) qtyNum = n;
                        }
                    });
                }
                
                if (qtyNum === null) {
                    const stockMatch = childText.match(/stock\s+([\d,]+)/i);
                    if (stockMatch) qtyNum = parseInt(stockMatch[1].replace(/,/g, ''), 10);
                }
                
                if (name && qtyNum !== null && costNum !== null && qtyNum > 0 && costNum > 0) {
                    if (!stocks.some(s => s.name === name)) {
                        stocks.push({ name, quantity: qtyNum, cost: costNum });
                    }
                }
            }
        }
    }

    // ─── TRANSMIT DATA ──────────────────────────────────────────────────────

    function submitStocks(stocks) {
        if (!ENABLED) {
            setStatus('disabled');
            return;
        }

        const now = Date.now();
        if (now - lastSubmitTime < MIN_SUBMIT_INTERVAL_MS) return; 

        const stateKey = currentCountry + "_" + stocks.length + "_" + stocks.reduce((acc, s) => acc + s.quantity, 0);
        if (completedPageStates.has(stateKey)) {
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

        const url = SSG_SERVER + '/api/stock-observe';
        const body = JSON.stringify(payload);

        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                onload: function(response) {
                    if (response.status === 200 || response.status === 201) {
                        setStatus('submitted');
                        if (!completedPageStates.has(stateKey)) {
                            logTrace(`Stock data submitted (${stocks.length} items).`);
                        }
                        completedPageStates.add(stateKey);
                    } else {
                        setStatus('error');
                        logTrace(`Submission failed: server returned ${response.status}`);
                    }
                },
                onerror: (err) => {
                    setStatus('error');
                    logTrace(`Network error submitting data.`, err);
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
                    if (!completedPageStates.has(stateKey)) {
                        logTrace(`Stock data submitted (${stocks.length} items).`);
                    }
                    completedPageStates.add(stateKey);
                } else {
                    setStatus('error');
                    logTrace(`Submission failed: server returned ${res.status}`);
                }
            })
            .catch((fetchErr) => {
                setStatus('error');
                logTrace(`Network error submitting data.`, { message: fetchErr.message });
            });
        }
    }

    // ─── ENGINE ─────────────────────────────────────────────────────────────

    function processPageParsing() {
        if (!ENABLED) return;

        if (!playerId) {
            detectUser();
        }

        // If in transit, schedule landing check and skip scraping
        if (isInTransit()) {
            setStatus('idle');
            const flightRemaining = detectFlightTimeRemaining();
            if (flightRemaining && flightRemaining > 0 && flightRemaining < 7200000) {
                logTrace(`In flight. Arriving in ~${Math.round(flightRemaining / 60000)} min.`);
                if (flightTimer) clearTimeout(flightTimer);
                if (landingTimer) clearInterval(landingTimer);
                // Check for landing every 1 second - supports fast in-and-out trips (<15s)
                landingTimer = setInterval(() => {
                    if (!isInTransit() && detectCountry()) {
                        clearInterval(landingTimer);
                        landingTimer = null;
                        logTrace(`Landed. Scraping stock data.`);
                        processPageParsing();
                        // One more check after 2s for dynamic content to fully render
                        setTimeout(() => { processPageParsing(); }, 2000);
                    }
                }, 1000);
                // Also schedule a timeout at estimated arrival + a buffer
                flightTimer = setTimeout(() => { processPageParsing(); }, Math.min(flightRemaining + 5000, 7200000));
            }
            return;
        }

        const countryName = detectCountry();
        const countryCode = countryName ? countryToCode(countryName) : null;

        if (countryCode) {
            if (currentCountry !== countryCode) {
                stocksLogged = false;
            }
            currentCountry = countryCode;
            const stocks = scrapeStocks();
            
            if (stocks.length > 0) {
                if (!stocksLogged) {
                    logTrace(`Scraped ${stocks.length} stock items in ${countryName}.`);
                    stocksLogged = true;
                }
                submitStocks(stocks);
            }
        } else {
            setStatus('idle');
        }
    }

    // ─── INITIALIZATION ─────────────────────────────────────────────────────

    function init() {
        if (!ENABLED) return;
        logTrace(`SSG Stock Observer v1.5.0 loaded.`);

        detectUser();
        if (playerId) {
            logTrace(`Player detected.`);
        }
        statusIndicator = createStatusBadge();
        setStatus('idle');

        processPageParsing();

        // Mutation observer for dynamic content changes
        pageMutationObserver = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processPageParsing();
            }, 400); 
        });
        pageMutationObserver.observe(document.body, { childList: true, subtree: true });

        // One extra check 3s after init for dynamic content
        setTimeout(() => {
            processPageParsing();
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('beforeunload', () => {
        if (pageMutationObserver) pageMutationObserver.disconnect();
        if (flightTimer) clearTimeout(flightTimer);
        if (landingTimer) clearInterval(landingTimer);
    });
})();