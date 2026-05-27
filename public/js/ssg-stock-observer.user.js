// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      2.7.0
// @description  Precision Data Harvesting Engine - Travel Page Only
// @author       SSG
// @match        *://*.torn.com/page.php?sid=travel*
// @match        *://torn.com/page.php?sid=travel*
// @icon         https://www.google.com/s2/favicons?domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ssg-server.onrender.com
// @connect      torn.com
// @connect      www.torn.com
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ─── GUARD CLAUSE: Only run on the travel page ────────────────────────────
    const PAGE_URL = window.location.href.toLowerCase();
    if (!PAGE_URL.includes('sid=travel')) {
        console.log('[SSG] Not travel page, exiting.');
        return;
    }
    console.log('[SSG] Travel page detected, initializing stock observer...');

    const SSG_SERVER = 'https://ssg-server.onrender.com';
    const MIN_SUBMIT_INTERVAL_MS = 6000;
    const FOREIGN_COUNTRIES = ['mexico', 'cayman', 'canada', 'hawaii', 'uk', 'argentina', 'switzerland', 'japan', 'china', 'uae', 'south_africa'];

    let lastSubmitTime = 0;
    let statusIndicator = null;
    let pageObserver = null;
    let debounceTimer = null;
    let previousCountry = null; // Track previous country to detect departures
    const logs = [];

    // Mapping of Torn country names → short codes
    const COUNTRY_MAP = {
        'mexico': 'mex', 'cayman': 'cay', 'canada': 'can',
        'hawaii': 'haw', 'uk': 'uni', 'argentina': 'arg',
        'switzerland': 'swi', 'japan': 'jap', 'china': 'chi',
        'uae': 'uae', 'south_africa': 'sou'
    };

    function log(msg) {
        const ts = new Date().toLocaleTimeString();
        logs.push(`[${ts}] ${msg}`);
        console.log(`[SSG] ${msg}`);
    }

    // ─── DIAGNOSTIC OVERLAY ──────────────────────────────────────────────────

    function showLog() {
        const existing = document.getElementById('ssg-debug-overlay');
        if (existing) { existing.remove(); return; }

        const overlay = document.createElement('div');
        overlay.id = 'ssg-debug-overlay';
        overlay.style.cssText = 'position:fixed;top:10%;left:10%;width:80%;height:80%;background:rgba(20,24,33,0.98);color:#00ff66;font-family:monospace;padding:20px;z-index:2147483647;border:2px solid #34495e;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:15px;border-bottom:1px solid #2c3e50;padding-bottom:10px;';
        header.innerHTML = '<span style="font-weight:bold;color:#fff;">SSG Stock Observer v2.7.0 - Logs</span>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = 'background:#e74c3c;color:white;border:none;padding:5px 10px;cursor:pointer;border-radius:4px;';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);
        overlay.appendChild(header);

        const textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.style.cssText = 'flex-grow:1;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:10px;font-size:12px;resize:none;border-radius:4px;';
        textarea.value = logs.join('\n');
        overlay.appendChild(textarea);
        document.body.appendChild(overlay);
    }

    // ─── STATUS BADGE ─────────────────────────────────────────────────────────

    function createStatusBadge() {
        let badge = document.getElementById('ssg-stock-badge');
        if (!badge && document.body) {
            badge = document.createElement('div');
            badge.id = 'ssg-stock-badge';
            badge.style.cssText = 'position:fixed;bottom:15px;right:15px;width:14px;height:14px;border-radius:50%;z-index:2147483647;box-shadow:0 0 8px rgba(0,0,0,0.8);cursor:pointer;border:1px solid rgba(255,255,255,0.6);background:#f0a500;';
            badge.title = 'Click for SSG debug logs';
            badge.onclick = showLog;
            document.body.appendChild(badge);
        }
        return badge;
    }

    function setStatus(color) {
        statusIndicator = createStatusBadge();
        if (statusIndicator) {
            statusIndicator.style.background = color;
        }
    }

    // ─── STATE MANAGEMENT ──────────────────────────────────────────────────

    function isInForeignCountry() {
        const country = document.body?.getAttribute('data-country') || '';
        return FOREIGN_COUNTRIES.includes(country.toLowerCase());
    }

    function isTraveling() {
        return document.body?.getAttribute('data-traveling') === 'true';
    }

    function getCountryName() {
        return (document.body?.getAttribute('data-country') || '').toLowerCase();
    }

    function extractCountryCode() {
        const country = getCountryName();

        // PRIMARY: Use body[data-country]
        if (COUNTRY_MAP[country]) {
            return COUNTRY_MAP[country];
        }

        // FALLBACK: URL parameter
        const match = PAGE_URL.match(/[?&]countryid=([a-z_]+)/);
        if (match && COUNTRY_MAP[match[1]]) {
            return COUNTRY_MAP[match[1]];
        }

        // FALLBACK: URL text search
        for (const [fullName, code] of Object.entries(COUNTRY_MAP)) {
            if (PAGE_URL.includes(fullName) || PAGE_URL.includes(code)) {
                return code;
            }
        }

        return null; // No country detected (home or unknown)
    }

    // ─── HELPER: Get direct text only (no child elements) ────────────────────

    function getDirectText(el) {
        if (!el) return '';
        let text = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            }
        }
        return text.trim();
    }

    // ─── NETWORK TRANSMISSION ────────────────────────────────────────────────

    function transmit(countryCode, items) {
        try {
            if (sessionStorage.getItem(`ssg_submitted_${countryCode}`) === 'true') {
                log(`Skipping: already submitted for ${countryCode} this visit`);
                return;
            }
        } catch(e) {}

        const now = Date.now();
        if (now - lastSubmitTime < MIN_SUBMIT_INTERVAL_MS) {
            log(`Skipping: rate limited`);
            return;
        }
        lastSubmitTime = now;

        // Extract player info from Torn's own page data
        let pid = 1337, pname = 'SSG Member';
        try {
            // Look for ANY element with a 'value' or 'data-*' attribute containing player JSON
            // Torn typically embeds user data in a div/script/input with value='{"id":1234,"playername":"User"}'
            let found = false;
            const candidates = document.querySelectorAll('[value*="{"], [value*="id"], script[type="application/json"], [data-player], [data-user]');
            log(`Searching ${candidates.length} elements for player data...`);
            if (candidates.length > 0) {
                log(`First candidate value sample: ${(candidates[0].getAttribute('value') || candidates[0].textContent || '').substring(0, 100)}`);
            }
            for (const el of candidates) {
                const raw = el.getAttribute('value') || el.value || el.textContent || '';
                if (raw.includes('"id"') && (raw.includes('player') || raw.includes('user') || raw.includes('name'))) {
                    try {
                        const data = JSON.parse(raw.replace(/'/g, '"'));
                        if (data.id && typeof data.id === 'number') {
                            pid = data.id;
                            pname = data.playername || data.playerName || data.username || data.name || pname;
                            log(`Player: ${pname} (ID: ${pid})`);
                            found = true;
                            break;
                        }
                    } catch(e) {}
                }
            }
            if (!found) {
                // Fallback to GM storage
                try {
                    pid = GM_getValue('ssg_player_id', 1337);
                    pname = GM_getValue('ssg_player_name', 'SSG Member');
                    log(`Using GM stored player: ${pname} (ID: ${pid})`);
                } catch(e2) {}
            }
        } catch(e) {
            try { pid = GM_getValue('ssg_player_id', 1337); } catch(e2) {}
            try { pname = GM_getValue('ssg_player_name', 'SSG Member'); } catch(e2) {}
        }

        const payload = {
            playerId: pid,
            playerName: pname,
            country: countryCode,
            observedAt: Math.floor(now / 1000),
            stocks: items
        };

        log(`SENDING ${items.length} items for ${countryCode}`);
        setStatus('#f0a500');

        GM_xmlhttpRequest({
            method: 'POST',
            url: `${SSG_SERVER}/api/stock-observe`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(payload),
            onload: function (res) {
                if (res.status === 200 || res.status === 201) {
                    setStatus('#00c853');
                    log(`SUCCESS! Server: ${res.responseText}`);
                    try { sessionStorage.setItem(`ssg_submitted_${countryCode}`, 'true'); } catch(e) {}
                } else {
                    setStatus('#ff4444');
                    log(`ERROR ${res.status}: ${res.responseText}`);
                }
            },
            onerror: function() {
                setStatus('#ff4444');
                log(`NETWORK FAILURE`);
            }
        });
    }

    // ─── MAIN HARVEST FUNCTION ──────────────────────────────────────────────

    function harvest() {
        const countryName = getCountryName();
        const traveling = isTraveling();

        log(`State: country="${countryName}" traveling=${traveling}`);

        // ─── Handle departure: clearing locks when leaving ───
        // If we WERE in a foreign country and now we're traveling (flying away),
        // clear the session lock so we can resubmit on return
        if (previousCountry && FOREIGN_COUNTRIES.includes(previousCountry) && traveling) {
            const prevCode = COUNTRY_MAP[previousCountry];
            if (prevCode) {
                try { sessionStorage.removeItem(`ssg_submitted_${prevCode}`); } catch(e) {}
                log(`Cleared lock for ${previousCountry} -> ${prevCode} (departing)`);
            }
        }
        // Also clear if we're back in Torn after being abroad
        if (previousCountry && FOREIGN_COUNTRIES.includes(previousCountry) && countryName === 'torn') {
            const prevCode = COUNTRY_MAP[previousCountry];
            if (prevCode) {
                try { sessionStorage.removeItem(`ssg_submitted_${prevCode}`); } catch(e) {}
                log(`Cleared lock for ${previousCountry} -> ${prevCode} (returned home)`);
            }
        }
        previousCountry = countryName;

        // ─── Skip conditions ───
        // 1. Still flying
        if (traveling) {
            log('In flight, waiting to land...');
            setStatus('#f0a500');
            return;
        }

        // 2. Not in a foreign country (in Torn or unknown)
        if (!isInForeignCountry()) {
            log(`Not in a foreign country (country="${countryName}"), idle.`);
            setStatus('#f0a500');
            return;
        }

        // 3. Get country code
        const countryCode = extractCountryCode();
        if (!countryCode) {
            log(`Unknown country: "${countryName}", cannot submit`);
            setStatus('#ff4444');
            return;
        }

        // 4. Already submitted
        try {
            if (sessionStorage.getItem(`ssg_submitted_${countryCode}`) === 'true') {
                log(`${countryCode} already submitted this visit`);
                setStatus('#00c853');
                return;
            }
        } catch(e) {}

        log(`Harvesting for ${countryCode}...`);

        // ─── Scan ALL elements for price/stock patterns ───
        // Torn uses dynamic class names that change, so we scan by content patterns
        const stocks = [];
        const seen = new Set();
        let candidatesFound = 0;

        // Strategy 1: Find all elements that contain "$" (prices)
        // Walk up from each price element to find the item container/row
        // then extract name and stock from that container
        const priceElements = document.querySelectorAll('*');
        log(`Scanning ${priceElements.length} total elements for patterns...`);

        priceElements.forEach(el => {
            // Only look at leaf elements with dollar amounts
            const text = el.textContent.trim();
            if (!text.includes('$') || el.children.length > 0) return;

            // Check if the text has a clean dollar amount
            if (!/^\$[\d,]+$/.test(text.trim())) return;

            const costDigits = text.replace(/[^0-9]/g, '');
            const cost = costDigits ? parseInt(costDigits, 10) : 0;
            if (cost <= 0) return;

            // Walk up to find a container that also has a name and stock data
            let parent = el.parentElement;
            let name = null;
            let qty = 0;
            let searchDepth = 0;

            while (parent && searchDepth < 5) {
                // Look for a name element in this parent's children
                const nameEl = parent.querySelector('.name, .title, [class*="name"], [class*="title"], [class*="itemName"]');
                if (nameEl && !name) {
                    name = nameEl.textContent.trim();
                }

                // Also try all direct text children for name (since classes are dynamic)
                if (!name) {
                    for (const child of parent.children) {
                        const ct = child.textContent.trim();
                        if (ct && ct.length > 2 && !ct.includes('$') && !ct.startsWith('type ') && !ct.startsWith('stock') && !ct.includes('Buy') && !ct.includes('Qty')) {
                            // Potential name - check it's not a header/label
                            if (!['Item', 'Name', 'Type', 'Cost', 'Stock', 'Amount', 'Buy', 'Qty'].includes(ct)) {
                                name = ct;
                                break;
                            }
                        }
                    }
                }

                // Look for stock quantity
                if (qty === 0) {
                    const stockEls = parent.querySelectorAll('[class*="stock"], [class*="quantity"], [class*="count"], [class*="amount"]');
                    for (const sEl of stockEls) {
                        const sText = sEl.textContent.trim().toUpperCase();
                        if (sText.includes('STOCK') || sText === 'OUT OF STOCK') {
                            const digits = sText.replace(/[^0-9]/g, '');
                            qty = digits ? parseInt(digits, 10) : 0;
                            break;
                        }
                    }
                    // Also try all children for "stock" pattern
                    if (qty === 0) {
                        for (const child of parent.children) {
                            const ct = child.textContent.trim().toLowerCase();
                            if (ct.startsWith('stock')) {
                                const digits = ct.replace(/[^0-9]/g, '');
                                qty = digits ? parseInt(digits, 10) : 0;
                                break;
                            }
                        }
                    }
                }

                if (name && cost > 0) {
                    break;
                }

                parent = parent.parentElement;
                searchDepth++;
            }

            // Filter out false positives from sidebar/navigation
            if (!name) return;
            if (name.endsWith(':') || name.endsWith(':')) return;           // "Money:", "Travel:", etc.
            if (['Torn', 'Travel', 'Home', 'Items', 'Events', 'Money', 'Lye'].includes(name)) return;
            if (name.length < 3) return;
            // Only accept items that have ALL letters (not purely numeric like "1234")
            if (/^[0-9\s]+$/.test(name)) return;

            if (!seen.has(name)) {
                seen.add(name);
                candidatesFound++;
                log(`  Item: "${name}" cost=${cost} qty=${qty}`);
                // DON'T send sequential IDs - let the backend generate stable
                // name-based IDs for proper analytics across visits
                stocks.push({ name, quantity: qty, cost });
            }
        });

        // ─── Fallback: scan ALL text for price patterns ██
        if (stocks.length === 0) {
            log('Price element scan found nothing, trying brute-force text scan...');
            
            // Get all leaf elements that contain text
            const allElements = document.body.querySelectorAll('*');
            const textData = [];
            
            allElements.forEach(el => {
                const text = el.textContent.trim();
                if (text && el.children.length === 0) {
                    textData.push({ text, el });
                }
            });

            // Look for items by finding "$" leaf nodes and working backwards
            textData.forEach((item, idx) => {
                const t = item.text.trim();
                if (t.startsWith('$') && /^\$[\d,]+$/.test(t)) {
                    const costDigits = t.replace(/[^0-9]/g, '');
                    const cost = costDigits ? parseInt(costDigits, 10) : 0;
                    if (cost <= 0) return;

                    // The name is likely a few elements before this one in DOM order
                    // Look back to find a plausible item name
                    let name = null;
                    let qty = 0;

                    for (let i = idx - 1; i >= Math.max(0, idx - 15); i--) {
                        const prev = textData[i].text.trim();
                        // Skip type labels and headers
                        if (prev.startsWith('type ') || ['Type', 'Cost', 'Stock', 'Amount', 'Buy', 'Qty', 'Item', 'Name'].includes(prev)) continue;
                        // If it's a reasonable item name (2+ chars, no special markers)
                        if (prev.length >= 2 && !prev.includes('$') && !prev.startsWith('stock')) {
                            name = prev;
                            break;
                        }
                    }

                    // Look forward for stock value
                    for (let i = idx + 1; i <= Math.min(textData.length - 1, idx + 15); i++) {
                        const next = textData[i].text.trim().toLowerCase();
                        if (next.startsWith('stock')) {
                            const digits = next.replace(/[^0-9]/g, '');
                            qty = digits ? parseInt(digits, 10) : 0;
                            break;
                        }
                        if (next === 'out of stock') {
                            qty = 0;
                            break;
                        }
                    }

                    if (name && !seen.has(name)) {
                        seen.add(name);
                        candidatesFound++;
                        log(`  TextScan: "${name}" cost=${cost} qty=${qty}`);
                        stocks.push({ name, quantity: qty, cost });
                    }
                }
            });
        }

        // ─── Submit ───
        if (stocks.length > 0) {
            log(`*** FOUND ${stocks.length} ITEMS! ***`);
            transmit(countryCode, stocks);
        } else {
            log(`*** NO ITEMS FOUND (${candidatesFound} candidates found) ***`);
            setStatus('#ff4444');
        }
    }

    // ─── INIT ────────────────────────────────────────────────────────────────

    function init() {
        log('Initializing...');
        setStatus('#f0a500');
        log(`body data-country="${getCountryName()}" data-traveling="${document.body?.getAttribute('data-traveling')}"`);

        // Monitor attribute changes AND DOM changes
        pageObserver = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(harvest, 400);
        });
        pageObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-traveling', 'data-country']
        });

        // Initial scan
        setTimeout(harvest, 500);

        // Poll every 2s
        setInterval(harvest, 2000);
    }

    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();