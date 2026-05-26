// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      2.5.0
// @description  Precision Data Harvesting Engine with Structural Quantity Layout Correction.
// @author       SSG
// @match        *://*.torn.com/*.php*
// @match        *://torn.com/*.php*
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

    const SSG_SERVER = 'https://ssg-server.onrender.com';
    const MIN_SUBMIT_INTERVAL_MS = 6000;

    let lastSubmitTime = 0;
    let statusIndicator = null;
    let pageObserver = null;
    let debounceTimer = null;
    const debugLogs = [];

    function logTrace(message) {
        const timestamp = new Date().toLocaleTimeString();
        debugLogs.push(`[${timestamp}] ${message}`);
        console.log(`[SSG-PRECISION-TRACE] ${message}`);
    }

    // ─── DIAGNOSTICS TERMINAL OVERLAY ────────────────────────────────────────

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
            z-index: 2147483647;
            border: 2px solid #34495e;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.7);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:15px; border-bottom:1px solid #2c3e50; padding-bottom:10px;';
        header.innerHTML = `<span style="font-weight:bold; color:#fff;">SSG Stock Observer v2.5.0 - Precision Control</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '❌ Close Logs';
        closeBtn.style.cssText = 'background:#e74c3c; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:4px;';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);
        overlay.appendChild(header);

        const textLogs = document.createElement('textarea');
        textLogs.readOnly = true;
        textLogs.style.cssText = 'flex-grow:1; background:#0d1117; color:#c9d1d9; border:1px solid #30363d; padding:10px; font-size:12px; resize:none; border-radius:4px;';

        let reportStr = `SYSTEM ENVIRONMENTAL DATA:\n`;
        reportStr += `--------------------------------------------------\n`;
        reportStr += `Target Backend : ${SSG_SERVER}\n`;
        reportStr += `Parsing Filter : Overhauled Quantity Parser\n`;
        reportStr += `--------------------------------------------------\n\n`;
        reportStr += `LOG EVENT HISTORY:\n`;
        reportStr += debugLogs.join('\n');

        textLogs.value = reportStr;
        overlay.appendChild(textLogs);
        document.body.appendChild(overlay);
    }

    function createStatusBadge() {
        let badge = document.getElementById('ssg-stock-badge');
        if (!badge && document.body) {
            badge = document.createElement('div');
            badge.id = 'ssg-stock-badge';
            badge.style.cssText = `
                position: fixed;
                bottom: 15px;
                right: 15px;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                z-index: 2147483647;
                box-shadow: 0 0 8px rgba(0,0,0,0.8);
                transition: background 0.3s;
                cursor: pointer;
                border: 1px solid rgba(255,255,255,0.6);
                background: #f0a500;
            `;
            badge.title = 'Click for SSG Precision Logs';
            badge.onclick = () => showDiagnosticReport();
            document.body.appendChild(badge);
        }
        return badge;
    }

    function setStatus(status) {
        if (status === 'submitted') {
            try { localStorage.setItem('ssg_last_success', Date.now().toString()); } catch (e) { }
        }
        statusIndicator = createStatusBadge();
        if (statusIndicator) {
            const colors = { 'idle': '#f0a500', 'submitted': '#00c853', 'error': '#ff4444' };
            statusIndicator.style.background = colors[status] || '#888888';
        }
    }

    setInterval(() => {
        try {
            const lastSuccess = localStorage.getItem('ssg_last_success');
            if (lastSuccess && (Date.now() - parseInt(lastSuccess, 10) < 8000)) {
                if (statusIndicator && statusIndicator.style.background !== 'rgb(0, 200, 83)') {
                    statusIndicator.style.background = '#00c853';
                }
            } else if (statusIndicator && statusIndicator.style.background === 'rgb(0, 200, 83)') {
                statusIndicator.style.background = '#f0a500';
            }
        } catch (e) { }
    }, 1000);

    // ─── NETWORK TRANSMISSION INTERFACE ──────────────────────────────────────

    function transmitPayload(countryCode, itemsArray) {
        try {
            if (sessionStorage.getItem(`ssg_submitted_${countryCode}`) === 'true') {
                return; 
            }
        } catch(e) {}

        const now = Date.now();
        if (now - lastSubmitTime < MIN_SUBMIT_INTERVAL_MS) return;
        lastSubmitTime = now;

        let dynamicPlayerId = 1337;
        let dynamicPlayerName = 'SSG Precision Core Engine';

        try {
            if (window.top) {
                dynamicPlayerId = GM_getValue('ssg_player_id', 1337);
                dynamicPlayerName = GM_getValue('ssg_player_name', 'SSG Member');
            }
        } catch (e) { }

        const payload = {
            playerId: dynamicPlayerId,
            playerName: dynamicPlayerName,
            country: countryCode,
            observedAt: Math.floor(now / 1000),
            stocks: itemsArray
        };

        logTrace(`Transmitting dataset entry (${itemsArray.length} items parsed) for location: ${countryCode.toUpperCase()}`);

        GM_xmlhttpRequest({
            method: 'POST',
            url: `${SSG_SERVER}/api/stock-observe`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(payload),
            onload: function (res) {
                if (res.status === 200 || res.status === 201) {
                    setStatus('submitted');
                    logTrace(`Success: Server confirmed safe processing. Locking submission for this visit.`);
                    try { sessionStorage.setItem(`ssg_submitted_${countryCode}`, 'true'); } catch(e) {}
                } else {
                    setStatus('error');
                    logTrace(`Warning: Server rejected entry with status code ${res.status}`);
                }
            },
            onerror: () => {
                setStatus('error');
                logTrace(`Failure: Target server unreachable.`);
            }
        });
    }

    function extractCountryCode() {
        const url = window.location.href.toLowerCase();
        const targets = ['mex', 'cay', 'can', 'haw', 'uni', 'arg', 'swi', 'jap', 'chi', 'uae', 'sou'];
        for (const t of targets) { if (url.includes(t)) return t; }
        return 'mex';
    }

    // ─── DE-DUPLICATED DATA HARVESTER ────────────────────────────────────────

    function runLayoutHarvest() {
        const countryCode = extractCountryCode();
        
        try {
            if (sessionStorage.getItem(`ssg_submitted_${countryCode}`) === 'true') return;
        } catch(e) {}

        const stocks = [];
        const selectors = 'table tbody tr, .travel-item, .item-wrapper, ul.travel-agency-market > li, [class*="itemRow"], [class*="marketItem"], [class*="row___"], [class*="item___"], [class*="item-info___"]';
        const itemRows = document.querySelectorAll(selectors);

        itemRows.forEach(row => {
            const nameEl = row.querySelector('.name, td:first-child, .title, [class*="name"], [class*="title"], [class*="itemName"]');
            if (!nameEl) return;

            const name = nameEl.textContent.trim();
            if (!name || name.includes('Item') || name.includes('Name') || name.length < 2) return;

            // 1. Refactored Quantity Selector Engine
            let qty = 0;
            const qtyEl = row.querySelector('.quantity, .stock, [class*="quantity"], [class*="stock"], td:nth-child(2), [class*="count"], [class*="amount"]');
            
            if (qtyEl) {
                const textVal = qtyEl.textContent.trim().toUpperCase();
                if (textVal === 'OUT OF STOCK') {
                    qty = 0;
                } else {
                    // Extract numbers cleanly, ignoring any adjacent category strings
                    const digits = textVal.replace(/[^0-9]/g, '');
                    qty = digits ? parseInt(digits, 10) : 0;
                }
            } else {
                // Deep-search cell element fallback
                const innerCells = row.querySelectorAll('td, div, span');
                for (const cell of innerCells) {
                    const cTxt = cell.textContent.trim().toUpperCase();
                    if (cTxt === 'OUT OF STOCK') {
                        qty = 0;
                        break;
                    }
                    if (!cTxt.includes('$') && /^\d+[\d,]*$/.test(cTxt.replace(/,/g, ''))) {
                        qty = parseInt(cTxt.replace(/[^0-9]/g, ''), 10) || 0;
                        break;
                    }
                }
            }

            // 2. Short-Circuit Price Selector Engine
            let cost = 0;
            const priceEls = row.querySelectorAll('.cost, .price, [class*="cost"], [class*="price"], td, div, span');
            for (const pEl of priceEls) {
                const txt = pEl.textContent.trim();
                if (txt.includes('$')) {
                    const extractedNum = parseInt(txt.replace(/[^0-9]/g, ''), 10) || 0;
                    if (extractedNum > 0) {
                        cost = extractedNum;
                        break;
                    }
                }
            }

            if (name && cost > 0 && !stocks.some(s => s.name === name)) {
                stocks.push({ id: stocks.length + 1, name: name, quantity: qty, cost: cost });
            }
        });

        if (stocks.length > 0) {
            transmitPayload(countryCode, stocks);
        }
    }

    // ─── INITIALIZATION SEQUENCE ────────────────────────────────────────────

    function triggerScanSequence() {
        const lastSuccess = localStorage.getItem('ssg_last_success');
        if (!lastSuccess || (Date.now() - parseInt(lastSuccess, 10) > 8000)) {
            setStatus('idle');
        }
        runLayoutHarvest();
    }

    if (document.body) {
        triggerScanSequence();
    }

    pageObserver = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            triggerScanSequence();
        }, 400);
    });

    pageObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    setInterval(triggerScanSequence, 2500);
})();