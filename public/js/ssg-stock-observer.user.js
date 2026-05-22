// ==UserScript==
// @name         SSG Stock Observer
// @namespace    https://ssg-server.onrender.com
// @version      1.0.0
// @description  Automatically submits foreign stock data to SSG Dashboard when you visit torn.com/travel.php while abroad. PC + Torn PDA friendly.
// @author       SSG
// @match        https://www.torn.com/travel.php*
// @match        https://torn.com/travel.php*
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
    // Auto-detect: if browsing localhost, use local server; otherwise use production
    const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const DEFAULT_SERVER = IS_LOCAL ? 'http://localhost:3000' : 'https://ssg-server.onrender.com';
    const SSG_SERVER = GM_getValue('ssg_server_url', DEFAULT_SERVER);
    const ENABLED = GM_getValue('ssg_enabled', true);
    const SUBMIT_INTERVAL_MS = 60000; // Re-check every 60s while on the page
    const PING_INTERVAL_MS = 3000; // Check DOM every 3s until stock table loads

    let lastSubmitTime = 0;
    let statusIndicator = null;
    let playerId = null;
    let playerName = null;
    let currentCountry = null;
    let pingInterval = null;
    let recheckInterval = null;

    // ─── UI HELPERS (minimal, works on PC and PDA) ─────────────────────────

    function createStatusBadge() {
        // Remove existing if any
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
            alert(`SSG Stock Observer\nStatus: ${statusText}\nServer: ${SSG_SERVER}`);
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
        // Torn exposes the logged-in user on every page via window.user
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.user) {
                playerId = unsafeWindow.user.id;
                playerName = unsafeWindow.user.name;
                return true;
            }
            if (window.user) {
                playerId = window.user.id;
                playerName = window.user.name;
                return true;
            }
        } catch (e) {
            // cross-origin restrictions
        }
        return false;
    }

    // ─── DETECT COUNTRY ────────────────────────────────────────────────────

    function detectCountry() {
        // Try to find the country from the page content
        // Torn travel.php shows the country name in various places
        
        // Method 1: Look for #travel-main or travel container with country data
        const travelMain = document.getElementById('travel-main');
        if (travelMain) {
            const text = travelMain.textContent || '';
            const countryMatch = text.match(/you are currently in\s+([A-Za-z\s]+)/i);
            if (countryMatch) return countryMatch[1].trim();
        }

        // Method 2: Look for country name in the destination/title area
        const titleEl = document.querySelector('.travel-title, .destination-title, h2, h3');
        if (titleEl) {
            const text = titleEl.textContent || '';
            // Known country names in Torn
            const countries = [
                'Mexico', 'Cayman Islands', 'Canada', 'Hawaii', 
                'United Kingdom', 'Argentina', 'Switzerland', 
                'Japan', 'China', 'UAE', 'South Africa'
            ];
            for (const country of countries) {
                if (text.toLowerCase().includes(country.toLowerCase())) {
                    return country;
                }
            }
        }

        // Method 3: URL might contain country info in hash or params
        const urlParams = new URLSearchParams(window.location.search);
        const step = urlParams.get('step');
        if (step && countries.some(c => step.toLowerCase().includes(c.toLowerCase()))) {
            return step;
        }

        return null;
    }

    function countryToCode(countryName) {
        const map = {
            'mexico': 'mex',
            'cayman islands': 'cay',
            'canada': 'can',
            'hawaii': 'haw',
            'united kingdom': 'uni',
            'argentina': 'arg',
            'switzerland': 'swi',
            'japan': 'jap',
            'china': 'chi',
            'uae': 'uae',
            'south africa': 'sou'
        };
        return map[(countryName || '').toLowerCase().trim()] || null;
    }

    // ─── SCRAPE STOCK TABLE ────────────────────────────────────────────────

    function scrapeStocks() {
        // The stock table on torn.com/travel.php has item rows with name, quantity, cost
        // Look for the stock items table - multiple possible selectors for PC and PDA
        
        const stocks = [];
        
        // Method 1: Look for stock items in the travel main content
        // PDA often uses simpler markup
        const stockRows = document.querySelectorAll(
            '.stock-item, ' +
            '[class*="stock-row"], ' +
            '.items-list .item, ' +
            '.travel-stock-table tbody tr, ' +
            '#travel-main .item-row, ' +
            'table.travel-stock tr'
        );

        if (stockRows.length > 0) {
            stockRows.forEach(row => {
                const cells = row.querySelectorAll('td, .item-cell, [class*="cell"]');
                if (cells.length >= 3) {
                    const nameEl = cells[0];
                    const qtyEl = cells[1];
                    const costEl = cells[2];
                    
                    const name = (nameEl.textContent || '').trim();
                    const qtyText = (qtyEl.textContent || '').trim().replace(/,/g, '');
                    const costText = (costEl.textContent || '').trim().replace(/[$,]/g, '');
                    
                    const quantity = parseInt(qtyText);
                    const cost = parseInt(costText);
                    
                    if (name && !isNaN(quantity) && !isNaN(cost)) {
                        stocks.push({ name, quantity, cost });
                    }
                }
            });
        }

        // Method 2: Fall back to looking for structured data attributes
        if (stocks.length === 0) {
            const itemEls = document.querySelectorAll('[data-item-id], [data-stock-id]');
            itemEls.forEach(el => {
                const id = parseInt(el.dataset.itemId || el.dataset.stockId);
                const name = (el.querySelector('.item-name') || el).textContent.trim();
                const qtyEl = el.querySelector('.item-qty, .stock-qty, [data-quantity]');
                const costEl = el.querySelector('.item-cost, .stock-cost, [data-cost]');
                
                const quantity = qtyEl ? parseInt((qtyEl.textContent || qtyEl.dataset.quantity || '').replace(/,/g, '')) : NaN;
                const cost = costEl ? parseInt((costEl.textContent || costEl.dataset.cost || '').replace(/[$,]/g, '')) : NaN;
                
                if (id && name && !isNaN(quantity) && !isNaN(cost)) {
                    stocks.push({ id, name, quantity, cost });
                }
            });
        }

        // Assign sequential IDs if none found (they'll be resolved server-side)
        if (stocks.length > 0 && !stocks[0].id) {
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
        if (now - lastSubmitTime < 10000) return; // Don't submit more than once per 10s
        lastSubmitTime = now;

        const payload = {
            playerId: playerId,
            playerName: playerName || '',
            country: currentCountry,
            observedAt: Math.floor(now / 1000),
            stocks: stocks.map(s => ({
                id: s.id,
                name: s.name,
                quantity: s.quantity,
                cost: s.cost
            }))
        };

        const url = SSG_SERVER + '/api/stock-observe';
        const body = JSON.stringify(payload);

        // Use GM_xmlhttpRequest if available (Tampermonkey/Greasemonkey on PC),
        // otherwise fall back to standard fetch() (Torn PDA app, Violentmonkey, etc.)
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.success) {
                                setStatus('submitted');
                                console.log('[SSG Stock Observer] Submitted', stocks.length, 'items for', currentCountry);
                            } else {
                                setStatus('error');
                                console.error('[SSG Stock Observer] Submit failed:', data.error);
                            }
                        } catch (e) {
                            setStatus('error');
                            console.error('[SSG Stock Observer] Parse error:', e);
                        }
                    } else {
                        setStatus('error');
                        console.error('[SSG Stock Observer] HTTP', response.status, response.responseText);
                    }
                },
                onerror: function(err) {
                    setStatus('error');
                    console.error('[SSG Stock Observer] Network error:', err);
                },
                ontimeout: function() {
                    setStatus('error');
                    console.error('[SSG Stock Observer] Timeout');
                }
            });
        } else {
            // Fallback for Torn PDA and other environments without GM_xmlhttpRequest
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            })
            .then(function(response) {
                if (response.ok) {
                    return response.json().then(function(data) {
                        if (data.success) {
                            setStatus('submitted');
                            console.log('[SSG Stock Observer] Submitted', stocks.length, 'items for', currentCountry);
                        } else {
                            setStatus('error');
                            console.error('[SSG Stock Observer] Submit failed:', data.error);
                        }
                    });
                } else {
                    setStatus('error');
                    console.error('[SSG Stock Observer] HTTP', response.status);
                }
            })
            .catch(function(err) {
                setStatus('error');
                console.error('[SSG Stock Observer] Network error:', err);
            });
        }
    }

    // ─── MAIN CHECK FUNCTION ───────────────────────────────────────────────

    function checkAndSubmit() {
        if (!ENABLED || !playerId) return;

        // Detect if we're abroad - look for stock data on the page
        const stocks = scrapeStocks();
        
        if (stocks.length > 0) {
            // We're abroad with visible stock data
            // currentCountry may already be a code (e.g. 'mex') or a name (e.g. 'Mexico')
            // Try detectCountry() first to get the name, then convert to code
            const countryName = detectCountry();
            const country = countryName ? countryToCode(countryName) : null;
            if (country) {
                currentCountry = country;
                submitStocks(stocks);
            } else {
                setStatus('idle');
                console.log('[SSG Stock Observer] Abroad but could not detect country');
            }
        } else {
            // Check if we're on the travel page abroad OR flying
            const pageText = document.body.textContent;
            const isAbroad = pageText.includes('You are currently in') ||
                           pageText.includes('You are currently flying') ||
                           pageText.includes('currently flying to') ||
                           document.querySelector('.travel-main, #travel-main, .abroad-view') ||
                           window.location.hash.includes('abroad');
            
            if (isAbroad) {
                setStatus('idle');
            } else {
                // In Torn, not abroad - hide the badge
                if (statusIndicator) {
                    statusIndicator.style.display = 'none';
                }
                return;
            }
        }
    }

    // ─── INIT ───────────────────────────────────────────────────────────────

    function init() {
        // Check if enabled
        if (!ENABLED) {
            console.log('[SSG Stock Observer] Disabled by user settings');
            return;
        }

        // Detect user
        if (!detectUser()) {
            console.warn('[SSG Stock Observer] Could not detect user - are you logged in?');
            // Still try to work - maybe user info loads later
            setTimeout(detectUser, 3000);
        }

        // Create status indicator
        statusIndicator = createStatusBadge();
        setStatus('unknown');

        // Register menu command for configuration (only if supported)
        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand('⚙️ SSG Server URL', () => {
                const url = prompt('Enter SSG Dashboard URL:', GM_getValue('ssg_server_url', 'https://ssg-server.onrender.com'));
                if (url) {
                    GM_setValue('ssg_server_url', url);
                    alert('SSG Server URL updated to: ' + url);
                }
            });

            GM_registerMenuCommand(ENABLED ? '⏸️ Pause Observer' : '▶️ Resume Observer', () => {
                const newState = !GM_getValue('ssg_enabled', true);
                GM_setValue('ssg_enabled', newState);
                alert('SSG Stock Observer ' + (newState ? 'resumed' : 'paused'));
                location.reload();
            });
        }

        // Wait for DOM to be ready with stock data
        // Keep checking as long as we're on the travel page (flying or abroad)
        pingInterval = setInterval(() => {
            const stocks = scrapeStocks();
            const pageText = document.body.textContent;
            const isAbroad = pageText.includes('You are currently in') ||
                           pageText.includes('You are currently flying') ||
                           pageText.includes('currently flying to') ||
                           document.querySelector('.travel-main, #travel-main, .abroad-view') ||
                           document.querySelector('.stock-item, [class*="stock-"], table.travel-stock');

            if (stocks.length > 0 || isAbroad) {
                // Don't clear pingInterval if we're still flying (no stocks yet)
                // Only clear once we have stocks or if we've arrived with no stocks
                if (stocks.length > 0 || pageText.includes('You are currently in')) {
                    clearInterval(pingInterval);
                    pingInterval = null;
                }
                
                if (stocks.length > 0) {
                    const countryName = detectCountry();
                    const countryCode = countryName ? countryToCode(countryName) : null;
                    if (countryCode) {
                        currentCountry = countryCode;
                        submitStocks(stocks);
                    }
                }

                // Set up periodic re-check every 60s (only once)
                if (!recheckInterval) {
                    recheckInterval = setInterval(checkAndSubmit, SUBMIT_INTERVAL_MS);
                }
            }
        }, PING_INTERVAL_MS);

        // No 30-second timeout - flights can take hours, so keep checking
        // The script will naturally stop when navigating away from travel.php
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        if (pingInterval) clearInterval(pingInterval);
        if (recheckInterval) clearInterval(recheckInterval);
    });

})();