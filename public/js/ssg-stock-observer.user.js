// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      1.4.7
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
        header.innerHTML = `<span style="font-weight:bold; color:#fff;">SSG Stock Observer v1.4.7 - Diagnostics</span>`;
        
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
        logTrace(`Scraping stocks from page...`);

        // Torn's travel.php uses a grid-based layout with hashed CSS module class names.
        // Stock data appears inside <div class="stockTableWrapper___XXXXX"> elements.
        // Each item row has child <div> cells with classes like tabletColA, tabletColB, etc.
        // We use partial class name matching to handle the hashed suffixes.

        // Strategy 1: Find stock table wrappers by partial class match
        const stockTables = document.querySelectorAll('[class*="stockTableWrapper"]');
        
        if (stockTables.length === 0) {
            logTrace(`No stockTableWrapper found, trying broader shop container search.`);
            // Fallback: find the shops container
            const shopContainers = document.querySelectorAll('[class*="shops"]');
            shopContainers.forEach(container => {
                const wrappers = container.querySelectorAll('[class*="stockTableWrapper"]');
                wrappers.forEach(w => {
                    if (!stockTables.length) { /* already handled */ }
                    parseStockTable(w, stocks);
                });
            });
        }
        
        stockTables.forEach(table => parseStockTable(table, stocks));

        // Strategy 2: Fallback - scan all divs containing $ that look like stock items
        if (stocks.length === 0) {
            logTrace(`No stock data from stockTableWrappers, trying direct scanning.`);
            const allDivs = document.querySelectorAll('div[class*="cell"]');
            const nameEls = document.querySelectorAll('[class*="tabletColB"]');
            const costEls = document.querySelectorAll('[class*="displayPrice"]');
            const stockEls = document.querySelectorAll('[class*="neededSpace"]');
            
            // If we found any of these elements, try to pair them up by proximity
            if (nameEls.length > 0 && costEls.length > 0) {
                // Walk through and pair names with costs that are in the same parent row
                const processedParents = new Set();
                nameEls.forEach(nameEl => {
                    const row = nameEl.closest('[class*="cell"]') || nameEl.parentElement;
                    if (!row || processedParents.has(row)) return;
                    processedParents.add(row);
                    
                    // Find all tabletColB (name), tabletColC (stock), tabletColD (cost) in this row
                    const name = (nameEl.textContent || '').trim();
                    const rowParent = row.parentElement;
                    
                    // Find sibling cells in the same row parent
                    if (rowParent) {
                        // Look for the cost cell (tabletColD) and stock cell (tabletColC)
                        const cells = rowParent.querySelectorAll(':scope > [class*="cell"]');
                        let qty = null;
                        let cost = null;
                        
                        cells.forEach(cell => {
                            const cls = cell.className || '';
                            const text = (cell.textContent || '').trim();
                            if (cls.includes('tabletColC') || cls.includes('neededSpace')) {
                                // Stock column - extract number
                                const n = parseNumeric(text);
                                if (n !== null) qty = n;
                            }
                            if (cls.includes('tabletColD') || cls.includes('displayPrice')) {
                                // Cost column - extract $ amount
                                const n = parseNumeric(text);
                                if (n !== null) cost = n;
                            }
                        });
                        
                        if (name && qty !== null && cost !== null && qty > 0 && cost > 0) {
                            if (!stocks.some(s => s.name === name)) {
                                stocks.push({ name, quantity: qty, cost });
                                logTrace(`Scraped stock (cell scan): ${name}, qty=${qty}, cost=${cost}`);
                            }
                        }
                    }
                });
            } else {
                logTrace(`No structured cells found - page may still be loading.`);
            }
        }

        if (stocks.length > 0) {
            stocks.forEach((s, i) => { s.id = -1 - i; });
        } else {
            logTrace(`No stocks scraped from page.`);
        }
        
        return stocks;
    }

    // Helper: Parse items from a stockTableWrapper div
    function parseStockTable(tableEl, stocks) {
        // Get direct children that represent item rows (skip the itemsHeader)
        const children = tableEl.children;
        let sectionName = '';
        
        // Find the shop heading that precedes this table
        let sibling = tableEl.previousElementSibling;
        while (sibling) {
            if (sibling.className && sibling.className.includes('shopHeader')) {
                sectionName = (sibling.textContent || '').trim();
                break;
            }
            sibling = sibling.previousElementSibling;
        }
        
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            // Skip header rows
            if (child.className && child.className.includes('itemsHeader')) continue;
            if (child.className && child.className.includes('itemsHeaderCell')) continue;
            
            // Check if this child contains $ amounts and item data
            const childText = (child.textContent || '').trim();
            if (!childText.includes('$') || childText.length < 10) continue;
            if (childText.includes('Item') && childText.includes('Name') && childText.includes('Cost')) continue;
            
            // Extract data from the child
            // Look for: name in tabletColB descendant, cost in displayPrice descendant, stock in neededSpace descendant
            const nameEl = child.querySelector('[class*="tabletColB"]') || 
                          child.querySelector('[class*="item-name"]');
            const costEl = child.querySelector('[class*="displayPrice"]');
            const stockEl = child.querySelector('[class*="neededSpace"]');
            
            if (nameEl && costEl) {
                const name = (nameEl.textContent || '').trim().replace(/^buy\s+/i, '').replace(/^type\s+/i, '');
                const costNum = parseNumeric(costEl.textContent);
                let qtyNum = null;
                
                // Stock may come from neededSpace element or parsed from text
                if (stockEl) {
                    const stockText = (stockEl.textContent || '').trim();
                    // Sometimes stock shows as "$25" (same as price) - if so, skip it
                    if (!stockText.includes('$')) {
                        qtyNum = parseNumeric(stockText);
                    }
                }
                
                // If qty is still null, try to find it from direct child divs
                if (qtyNum === null) {
                    const itemCells = child.querySelectorAll(':scope > div');
                    itemCells.forEach(cell => {
                        const cls = cell.className || '';
                        const txt = (cell.textContent || '').trim();
                        // tabletColC is the stock column
                        if (cls.includes('tabletColC')) {
                            const n = parseNumeric(txt);
                            if (n !== null && !txt.includes('$')) qtyNum = n;
                        }
                    });
                }
                
                // If still null, try parsing from text: find "stock XXXX" pattern
                if (qtyNum === null) {
                    const stockMatch = childText.match(/stock\s+([\d,]+)/i);
                    if (stockMatch) qtyNum = parseInt(stockMatch[1].replace(/,/g, ''), 10);
                }
                
                if (name && qtyNum !== null && costNum !== null && qtyNum > 0 && costNum > 0) {
                    if (!stocks.some(s => s.name === name)) {
                        stocks.push({ name, quantity: qtyNum, cost: costNum });
                        logTrace(`Scraped stock: ${name}, qty=${qtyNum}, cost=${costNum} [${sectionName}]`);
                    }
                }
            }
        }
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