// ==UserScript==
// @name         SSG War Script
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  SSG Faction War Enhancement - Call management, hospital timers, queue ordering
// @author       SSG Team
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      ssg-server.onrender.com
// @connect      localhost
// @connect      api.torn.com
// @connect      ffscouter.com
// @connect      www.torn.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIGURATION ────────────────────────────────────────────────────────
    // Server URL is determined in order:
    // 1. localStorage 'cat_server_url' (set via console: localStorage.setItem('cat_server_url','http://localhost:3000'))
    // 2. GM_getValue 'cat_server_url' (for advanced users)
    // 3. Production fallback
    function determineServerUrl() {
        try {
            // Check localStorage first (persists across updates)
            const saved = localStorage.getItem('cat_server_url');
            if (saved) return saved;
            // Check GM storage
            if (typeof GM_getValue !== 'undefined') {
                const stored = GM_getValue('cat_server_url', null);
                if (stored) return stored;
            }
        } catch (e) { /* ignore */ }
        return 'https://ssg-server.onrender.com';
    }

    const SCRIPT_SERVER = determineServerUrl();

    const CONFIG = {
        serverUrl: SCRIPT_SERVER,
        pollInterval: 3000, // 3 seconds
        version: '1.1.0',
        SSG_FACTION_ID: 53272
    };

    // ─── STATE ────────────────────────────────────────────────────────────────
    const state = {
        registered: false,
        token: null,
        playerId: null,
        playerName: null,
        factionId: null,
        enhancer: null,
        activeCalls: [],
        lastCallCount: -1,
        pollTimer: null,
        hospTime: {},
        travelData: {},
        previousStatus: {},
        tornConfirmedOkay: new Set(),
        wsBuffer: [],
        iconBuffer: [],
        pageFocused: true,
        wasInactive: false
    };

    // ─── STORAGE UTILITY ──────────────────────────────────────────────────────
    const StorageUtil = {
        get(key, defaultValue = null) {
            try {
                const val = localStorage.getItem(key);
                if (val === null) return defaultValue;
                try { return JSON.parse(val); } catch (e) { return val; }
            } catch (e) { return defaultValue; }
        },
        set(key, value) {
            try {
                if (typeof value === 'string') localStorage.setItem(key, value);
                else if (value === null || value === undefined) localStorage.removeItem(key);
                else localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) { return false; }
        }
    };

    // ─── API COMMUNICATION ────────────────────────────────────────────────────
    function apiRequest(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const url = `${CONFIG.serverUrl}${path}`;
            const headers = { 'Content-Type': 'application/json' };
            if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method,
                    url,
                    headers,
                    data: body ? JSON.stringify(body) : null,
                    onload: (resp) => {
                        try { resolve(JSON.parse(resp.responseText)); } catch (e) { reject(e); }
                    },
                    onerror: reject,
                    timeout: 10000
                });
            } else if (typeof PDA_httpGet === 'function' && method === 'GET') {
                PDA_httpGet(url, headers).then(r => r.json()).then(resolve).catch(reject);
            } else if (typeof PDA_httpMutation === 'function' && method !== 'GET') {
                PDA_httpMutation(url, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : null
                }).then(r => r.json()).then(resolve).catch(reject);
            } else {
                // Fallback to fetch
                fetch(url, { method, headers, body: body ? JSON.stringify(body) : null })
                    .then(r => r.json()).then(resolve).catch(reject);
            }
        });
    }

    // ─── REGISTRATION ─────────────────────────────────────────────────────────
    async function register() {
        // Check if already registered
        const savedToken = StorageUtil.get('cat_token');
        const savedPlayerId = StorageUtil.get('cat_player_id');
        if (savedToken && savedPlayerId) {
            state.token = savedToken;
            state.playerId = savedPlayerId;
            state.playerName = StorageUtil.get('cat_player_name', '');
            state.factionId = StorageUtil.get('cat_faction_id', CONFIG.SSG_FACTION_ID);
            state.registered = true;
            console.log('[SSG CAT] Restored session');
            // Update server URL from saved, in case it changed
            const url = localStorage.getItem('cat_server_url');
            if (url) CONFIG.serverUrl = url;
            return true;
        }

        // Need to register - first prompt for server URL
        const currentUrl = CONFIG.serverUrl;
        const serverUrl = prompt('SSG War Script - Server URL\n\n' +
            'Enter the SSG Server URL:\n' +
            '  Local testing: http://localhost:3000\n' +
            '  Production: https://ssg-server.onrender.com\n\n' +
            'Server URL:', currentUrl);
        if (!serverUrl || !serverUrl.trim()) {
            console.log('[SSG CAT] Registration cancelled');
            return false;
        }
        const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
        CONFIG.serverUrl = cleanUrl;
        localStorage.setItem('cat_server_url', cleanUrl);

        // Now prompt for API key
        const apiKey = prompt('SSG War Script needs the API Key you use to log in to the SSG Server to register.\n\n' +
            'This is the same Torn API key you use to log in at ' + CONFIG.serverUrl + '\n\n' +
            'Enter your API key:');
        if (!apiKey || !apiKey.trim()) {
            console.log('[SSG CAT] Registration cancelled');
            return false;
        }

        try {
            const result = await apiRequest('POST', '/api/cat/register', { apiKey: apiKey.trim() });
            if (result.success && result.token) {
                state.token = result.token;
                state.playerId = result.playerId;
                state.playerName = result.playerName;
                state.factionId = result.factionId;
                state.registered = true;
                StorageUtil.set('cat_token', result.token);
                StorageUtil.set('cat_player_id', result.playerId);
                StorageUtil.set('cat_player_name', result.playerName);
                StorageUtil.set('cat_faction_id', result.factionId);
                console.log('[SSG CAT] Registered successfully as', result.playerName);
                return true;
            } else {
                alert('Registration failed: ' + (result.error || 'Unknown error'));
                return false;
            }
        } catch (err) {
            console.error('[SSG CAT] Registration error:', err);
            alert('Registration failed. Check console for details.');
            return false;
        }
    }

    // ─── CALL MANAGEMENT ──────────────────────────────────────────────────────
    async function fetchCalls() {
        if (!state.registered) return;
        try {
            const result = await apiRequest('GET', '/api/cat/calls');
            if (result && result.calls) {
                state.activeCalls = result.calls;
                const count = result.calls.length;
                if (count !== state.lastCallCount) {
                    state.lastCallCount = count;
                    console.log(`[SSG CAT] ${count} active call(s)`);
                }
                renderCallIndicators();
            }
        } catch (err) { /* silent */ }
    }

    async function createCall(targetId, targetName, hospitalUntil) {
        if (!state.registered) return;
        try {
            await apiRequest('POST', '/api/cat/calls', {
                targetId,
                targetName,
                hospitalUntil: hospitalUntil || null
            });
            await fetchCalls();
        } catch (err) { /* silent */ }
    }

    async function deleteCall(callId) {
        if (!state.registered) return;
        try {
            await apiRequest('DELETE', `/api/cat/calls/${callId}`);
            await fetchCalls();
        } catch (err) { /* silent */ }
    }

    async function updateCallTimer(callId, hospitalUntil) {
        if (!state.registered) return;
        try {
            await apiRequest('PUT', `/api/cat/calls/${callId}/timer`, { hospitalUntil });
            await fetchCalls();
        } catch (err) { /* silent */ }
    }

    // ─── DOM ENHANCEMENTS ─────────────────────────────────────────────────────
    function renderCallIndicators() {
        // Remove old indicators
        document.querySelectorAll('.ssg-call-btn, .ssg-call-indicator').forEach(el => el.remove());

        const calls = state.activeCalls || [];
        if (calls.length === 0) return;

        // Find enemy member rows on the war page
        const memberRows = document.querySelectorAll('.desc-wrap li[class*="member"], .desc-wrap [class*="member___"]');
        if (!memberRows.length) return;

        memberRows.forEach(row => {
            const link = row.querySelector('a[href*="profiles.php?XID="]');
            if (!link) return;
            const href = link.getAttribute('href') || '';
            const match = href.match(/XID=(\d+)/);
            if (!match) return;
            const targetId = parseInt(match[1]);

            // Check if this target has a call
            const call = calls.find(c => c.targetId === targetId);
            if (!call) return;

            // Add call indicator
            const indicator = document.createElement('span');
            indicator.className = 'ssg-call-indicator';
            indicator.style.cssText = `
                display: inline-flex; align-items: center; gap: 4px;
                margin-left: 6px; font-size: 11px; font-weight: 600;
                padding: 1px 6px; border-radius: 3px; cursor: default;
            `;

            // Queue position
            const position = calls.indexOf(call) + 1;

            if (call.isAwake) {
                // PULSING state - target is awake, needs to be hit
                indicator.style.background = '#ff4444';
                indicator.style.color = '#fff';
                indicator.style.animation = 'ssg-pulse 1s ease-in-out infinite';
                indicator.textContent = `⚡ #${position} HIT NOW!`;
            } else {
                // Timer running
                const mins = Math.floor(call.timeRemaining / 60);
                const secs = call.timeRemaining % 60;
                const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

                // Color based on urgency
                if (call.timeRemaining < 300) { // < 5 min
                    indicator.style.background = '#ff6b35';
                } else if (call.timeRemaining < 900) { // < 15 min
                    indicator.style.background = '#ffaa00';
                } else {
                    indicator.style.background = '#2d8a4e';
                }
                indicator.style.color = '#fff';
                indicator.textContent = `#${position} ${timeStr} (${call.callerName})`;
            }

            // Add delete button for the caller
            if (call.callerId === state.playerId) {
                const delBtn = document.createElement('span');
                delBtn.textContent = '✕';
                delBtn.style.cssText = `
                    margin-left: 4px; cursor: pointer; font-size: 10px;
                    opacity: 0.7; color: #fff;
                `;
                delBtn.title = 'Remove call';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteCall(call.id);
                });
                indicator.appendChild(delBtn);
            }

            // Insert after the name
            const nameEl = link.querySelector('strong') || link;
            nameEl.parentNode.insertBefore(indicator, nameEl.nextSibling);
        });

        // Add pulsing animation
        if (!document.getElementById('ssg-cat-styles')) {
            const style = document.createElement('style');
            style.id = 'ssg-cat-styles';
            style.textContent = `
                @keyframes ssg-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.7; transform: scale(1.05); }
                }
                @keyframes ssg-glow {
                    0%, 100% { box-shadow: 0 0 5px rgba(255,68,68,0.5); }
                    50% { box-shadow: 0 0 15px rgba(255,68,68,0.8); }
                }
                .ssg-call-indicator {
                    transition: all 0.3s ease;
                }
            `;
            document.head.appendChild(style);
        }
    }

    // Add call button to enemy member rows
    function addCallButtons() {
        // Remove existing buttons
        document.querySelectorAll('.ssg-call-btn').forEach(el => el.remove());

        const memberRows = document.querySelectorAll('.desc-wrap li[class*="member"], .desc-wrap [class*="member___"]');
        if (!memberRows.length) return;

        memberRows.forEach(row => {
            if (row.querySelector('.ssg-call-btn')) return;

            const link = row.querySelector('a[href*="profiles.php?XID="]');
            if (!link) return;
            const href = link.getAttribute('href') || '';
            const match = href.match(/XID=(\d+)/);
            if (!match) return;
            const targetId = parseInt(match[1]);
            const targetName = (link.textContent || '').trim();

            // Check if already called
            const existingCall = state.activeCalls.find(c => c.targetId === targetId);
            if (existingCall) return;

            // Find the attack button area
            const attackBtn = row.querySelector('.desc-wrap .attack, [class*="attack___"]');
            const parent = attackBtn ? attackBtn.parentNode : row.querySelector('.desc-wrap [class*="status___"]') || row;

            const btn = document.createElement('button');
            btn.className = 'ssg-call-btn';
            btn.textContent = '📞 Call';
            btn.style.cssText = `
                display: inline-flex; align-items: center; gap: 3px;
                margin-left: 4px; padding: 2px 8px;
                font-size: 11px; font-weight: 600;
                background: #1a1a2e; color: #4fc3f7;
                border: 1px solid #4fc3f7; border-radius: 4px;
                cursor: pointer; transition: all 0.2s;
            `;
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#4fc3f7';
                btn.style.color = '#1a1a2e';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = '#1a1a2e';
                btn.style.color = '#4fc3f7';
            });

            btn.addEventListener('click', async () => {
                // Extract hospital time from the row if available
                let hospitalUntil = null;
                const statusEl = row.querySelector('[class*="status___"]');
                if (statusEl) {
                    const timeMatch = statusEl.textContent.match(/hospital/i);
                    if (timeMatch) {
                        // Try to extract data-time attribute from icons
                        const icon = row.querySelector('[data-time]');
                        if (icon) {
                            const seconds = parseInt(icon.getAttribute('data-time'));
                            if (seconds > 0) {
                                hospitalUntil = Math.floor(Date.now() / 1000) + seconds;
                            }
                        }
                    }
                }

                btn.textContent = '⏳ Calling...';
                btn.disabled = true;
                await createCall(targetId, targetName, hospitalUntil);
                btn.remove();
            });

            parent.appendChild(btn);
        });
    }

    // ─── HOSPITAL TIMER TRACKING ──────────────────────────────────────────────
    function updateHospitalTimers() {
        // Update the time remaining on call indicators
        const now = Math.floor(Date.now() / 1000);
        state.activeCalls.forEach(call => {
            if (call.hospitalUntil) {
                call.timeRemaining = Math.max(0, call.hospitalUntil - now);
                call.isAwake = now >= call.hospitalUntil;
            }
        });
        renderCallIndicators();
    }

    // ─── WEB SOCKET INTERCEPTION ──────────────────────────────────────────────
    function installInterceptors() {
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        // Monkey-patch WebSocket
        const oldWebSocket = targetWindow.WebSocket;
        targetWindow.WebSocket = function (...args) {
            const socket = new oldWebSocket(...args);
            socket.addEventListener('message', handleWSMessage);
            return socket;
        };
        Object.defineProperties(targetWindow.WebSocket, {
            prototype: { value: oldWebSocket.prototype },
            CONNECTING: { value: oldWebSocket.CONNECTING },
            OPEN: { value: oldWebSocket.OPEN },
            CLOSING: { value: oldWebSocket.CLOSING },
            CLOSED: { value: oldWebSocket.CLOSED },
        });

        // Handle focus/blur for buffering
        targetWindow.addEventListener('blur', () => { state.pageFocused = false; });
        targetWindow.addEventListener('focus', () => {
            state.pageFocused = true;
            if (state.wasInactive) {
                processBufferedMessages();
                state.wasInactive = false;
            }
        });
    }

    function handleWSMessage(event) {
        try {
            const raw = event.data;
            if (typeof raw !== 'string' || raw[0] !== '{') return;

            let json;
            try { json = JSON.parse(raw); } catch (e) { return; }

            const respUser = json?.push?.pub?.data?.message?.namespaces?.users;
            const statusUpdate = respUser?.actions?.updateStatus;
            const iconsUpdate = respUser?.actions?.updateIcons;

            if (statusUpdate) {
                if (state.pageFocused) {
                    processStatusUpdate(statusUpdate);
                } else {
                    state.wsBuffer.push(statusUpdate);
                }
            }

            if (iconsUpdate && iconsUpdate.icons) {
                if (state.pageFocused) {
                    processIconsUpdate(iconsUpdate);
                } else {
                    state.iconBuffer.push(iconsUpdate);
                }
            }
        } catch (e) { /* silent */ }
    }

    function processStatusUpdate(su) {
        if (!su.status) return;
        const id = String(su.userId);
        const statusText = (su.status.text || '').trim();

        if (statusText === 'Hospital' || statusText.toLowerCase().includes('hospital')) {
            state.tornConfirmedOkay.delete(id);
            if (su.status.until) {
                const endMs = su.status.until > 9999999999 ? su.status.until : su.status.until * 1000;
                if (endMs > Date.now()) {
                    const untilSec = Math.floor(endMs / 1000);
                    state.hospTime[id] = untilSec;

                    // Update call timer if this target is called
                    const call = state.activeCalls.find(c => c.targetId === parseInt(id));
                    if (call) {
                        updateCallTimer(call.id, untilSec);
                    }
                }
            }
        } else if (['Okay', 'Traveling', 'Abroad', 'Jail', 'Federal', 'Fallen'].includes(statusText)) {
            state.tornConfirmedOkay.add(id);
            delete state.hospTime[id];

            // If target was awake and now in hospital, clear the awake state
            const call = state.activeCalls.find(c => c.targetId === parseInt(id));
            if (call && call.isAwake && (statusText === 'Hospital' || statusText === 'Fallen')) {
                updateCallTimer(call.id, null);
            }
        }
    }

    function processIconsUpdate(iu) {
        const id = String(iu.userId);
        const html = iu.icons;
        const hospMatch = html.match(/Hospital[^>]*data-time=(?:'|&#039;|"|")(\d+)(?:'|&#039;|"|")/);
        if (hospMatch) {
            const seconds = parseInt(hospMatch[1], 10);
            if (seconds > 0) {
                const untilMs = Date.now() + (seconds * 1000);
                state.hospTime[id] = Math.floor(untilMs / 1000);

                const call = state.activeCalls.find(c => c.targetId === parseInt(id));
                if (call) {
                    updateCallTimer(call.id, Math.floor(untilMs / 1000));
                }
            }
        }
    }

    function processBufferedMessages() {
        // Process buffered WS messages
        state.wsBuffer.forEach(su => processStatusUpdate(su));
        state.iconBuffer.forEach(iu => processIconsUpdate(iu));
        state.wsBuffer = [];
        state.iconBuffer = [];
        fetchCalls();
    }

    // ─── FETCH INTERCEPTION ───────────────────────────────────────────────────
    function installFetchInterceptors() {
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const oldFetch = targetWindow.fetch;

        targetWindow.fetch = async (...args) => {
            let url;
            try {
                const firstArg = args[0];
                url = (typeof firstArg === 'object' && firstArg !== null && 'url' in firstArg)
                    ? firstArg.url
                    : (typeof firstArg === 'string' ? firstArg : undefined);
            } catch (_) { /* ignore */ }

            if (url && typeof url === 'string') {
                // Intercept war-related fetches
                if (url.includes('step=getwarusers') || url.includes('step=getwardata')) {
                    return oldFetch(...args).then(async (response) => {
                        try {
                            const clone = response.clone();
                            const data = await clone.json();
                            if (data && data.members) {
                                // Process member statuses
                                Object.entries(data.members).forEach(([id, member]) => {
                                    if (member.status) {
                                        processStatusUpdate({
                                            userId: parseInt(id),
                                            status: member.status
                                        });
                                    }
                                });
                            }
                        } catch (e) { /* ignore */ }
                        return response;
                    });
                }

                // Intercept online status
                if (url.includes('chat/online-status')) {
                    return oldFetch(...args).then(async (response) => {
                        try {
                            const clone = response.clone();
                            const data = await clone.json();
                            if (data && data.statuses) {
                                state.onlineStatuses = data.statuses;
                            }
                        } catch (e) { /* ignore */ }
                        return response;
                    });
                }
            }

            return oldFetch(...args);
        };
    }

    // ─── MAIN LOOP ────────────────────────────────────────────────────────────
    function startPolling() {
        if (state.pollTimer) clearInterval(state.pollTimer);
        state.pollTimer = setInterval(async () => {
            await fetchCalls();
        }, CONFIG.pollInterval);
    }

    function startDomObserver() {
        // Observe the war page for DOM changes (new members loading, etc.)
        const observer = new MutationObserver(() => {
            addCallButtons();
            renderCallIndicators();
        });

        const target = document.querySelector('.desc-wrap') || document.querySelector('#faction_war_list_id') || document.body;
        observer.observe(target, { childList: true, subtree: true });
    }

    // ─── INITIALIZATION ────────────────────────────────────────────────────────
    async function init() {
        console.log('[SSG CAT] Starting...');

        // Register with server
        const registered = await register();
        if (!registered) {
            console.log('[SSG CAT] Not registered - script will not function');
            return;
        }

        // Install interceptors
        installInterceptors();
        installFetchInterceptors();

        // Initial call fetch
        await fetchCalls();

        // Start polling
        startPolling();

        // Start DOM observer
        setTimeout(startDomObserver, 1000);

        // Update timers every second
        setInterval(updateHospitalTimers, 1000);

        // Re-check for call buttons periodically
        setInterval(addCallButtons, 2000);

        console.log('[SSG CAT] Initialized successfully');
    }

    // ─── START ────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    } else {
        setTimeout(init, 1000);
    }

})();