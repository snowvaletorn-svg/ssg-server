// ==UserScript==
// @name         SSG War Flight Times
// @namespace    https://ssg-server.onrender.com
// @version      1.0.0
// @description  Show estimated landing windows for members flying during a war, directly on the Torn ranked-war page (#/war). Mirrors SSG dashboard's Enemy Stats flight timers.
// @author       SSG
// @license      MIT
// @match        https://www.torn.com/factions.php*
// @match        http://www.torn.com/factions.php*
// @match        https://torn.com/factions.php*
// @match        http://torn.com/factions.php*
// @icon         https://www.google.com/s2/favicons?domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // â”€â”€â”€ CONFIGURATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const CONFIG = {
        version: '1.0.0',
        KEY_STORAGE: 'ssg_war_flights_api_key',
        refetchInterval: 30 * 1000,   // refresh the enemy roster when an API key is saved
        pollInterval: 2000,           // re-scan the DOM for new member rows
        tickInterval: 1000            // tick the live countdowns every second
    };

    // â”€â”€â”€ PUBLIC GAME DATA: base one-way flight durations (minutes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Ported verbatim from services/intelService.js (kept in sync with the
    // dashboard so the two cannot diverge). Source: in-game travel agency
    // values as published by the open-source TornTools extension.
    const FLIGHT_TIMES = {
        mex: { name: 'Mexico', minutes: 26 },
        cay: { name: 'Cayman Islands', minutes: 35 },
        can: { name: 'Canada', minutes: 41 },
        haw: { name: 'Hawaii', minutes: 134 },
        uni: { name: 'United Kingdom', minutes: 159 },
        swi: { name: 'Switzerland', minutes: 175 },
        jap: { name: 'Japan', minutes: 225 },
        chi: { name: 'China', minutes: 242 },
        uae: { name: 'UAE', minutes: 271 },
        sou: { name: 'South Africa', minutes: 297 }
    };

    // Status-text variants â†’ FLIGHT_TIMES keys (also used to recognise whether a
    // flying member is headed for an enemy-owned country).
    const COUNTRY_ALIASES = {
        'mexico': 'mex',
        'cayman islands': 'cay', 'cayman': 'cay',
        'canada': 'can',
        'hawaii': 'haw',
        'united kingdom': 'uni', 'uk': 'uni',
        'switzerland': 'swi',
        'japan': 'jap',
        'china': 'chi',
        'uae': 'uae', 'united arab emirates': 'uae',
        'south africa': 'sou'
    };

    // Torn's Travel Book perk reduces flight time by up to 50%. We cannot see who
    // owns one, so the earliest bound assumes a book was used on a takeoff right
    // after the member's last recorded action.
    const BOOK_FACTOR = 0.5;

    // â”€â”€â”€ PARSING + WINDOW ESTIMATION (mirrors services/intelService.js) â”€â”€â”€â”€â”€â”€â”€â”€
    function lookupCountryKey(text) {
        if (!text) return null;
        return COUNTRY_ALIASES[String(text).trim().toLowerCase()] || null;
    }
    function canonicalCountryName(key, raw) {
        if (key && FLIGHT_TIMES[key]) return FLIGHT_TIMES[key].name;
        if (!raw) return null;
        return String(raw).trim().replace(/\b\w/g, c => c.toUpperCase());
    }

    // Parse a Torn member status description:
    //   "Traveling from Torn to China", "Traveling from UAE to Torn",
    //   "Traveling to Mexico", "In South Africa".
    // Returns null for hospital/jail/okay/other statuses.
    function parseTravelStatus(description) {
        if (!description || typeof description !== 'string') return null;
        const d = description.trim();

        let m = d.match(/^Traveling\s+from\s+(.+?)\s+to\s+(.+)$/i);
        if (m) {
            const origin = m[1].trim();
            const dest = m[2].trim();
            if (/^torn$/i.test(dest)) {
                const key = lookupCountryKey(origin);
                return { type: 'returning', countryKey: key, countryName: canonicalCountryName(key, origin), destination: 'Torn' };
            }
            const key = lookupCountryKey(dest);
            return { type: 'outbound', countryKey: key, countryName: canonicalCountryName(key, dest), destination: canonicalCountryName(key, dest) };
        }

        m = d.match(/^Traveling\s+to\s+(.+)$/i);
        if (m) {
            const dest = m[1].trim();
            const key = lookupCountryKey(dest);
            return { type: 'outbound', countryKey: key, countryName: canonicalCountryName(key, dest), destination: canonicalCountryName(key, dest) };
        }

        m = d.match(/^In\s+(.+)$/i);
        if (m && !/^(a|an|the)\s/i.test(m[1]) && !/^hospital/i.test(m[1]) && !/^jail/i.test(m[1])) {
            const country = m[1].trim();
            const key = lookupCountryKey(country);
            return { type: 'abroad', countryKey: key, countryName: canonicalCountryName(key, country), destination: canonicalCountryName(key, country) };
        }

        return null;
    }

    // Estimate a landing window (unix seconds) for a flying member.
    //  - takeoffSec (optional, from WebSocket/fetch observation): the exact moment
    //    the member took off. earliest = takeoff + BOOK_FACTOR*flight (best case
    //    book perk), latest = takeoff + flight (no book). Set only when we observed
    //    the takeoff live; otherwise we fall back to last-action bounds.
    //  - lastAction (optional): latest observable action time. earliest = max(now,
    //    lastAction + BOOK_FACTOR*base) exactly like the server.
    //  - now (optional): epoch seconds to compute against (defaults to Date.now()).
    // Returns null for members not mid-flight; unknown destinations yield an object
    // with a destination but no timer (matching the server behaviour).
    function estimateLandingWindow({ description, takeoffSec, lastAction, now } = {}) {
        const nowSec = Number.isFinite(now) ? Math.floor(now) : Math.floor(Date.now() / 1000);
        const parsed = parseTravelStatus(description);
        if (!parsed || parsed.type === 'abroad') return null;

        const info = parsed.countryKey ? FLIGHT_TIMES[parsed.countryKey] : null;
        if (!info) {
            return {
                destination: parsed.destination,
                country: info ? info.name : null,
                earliestArrival: nowSec,
                latestArrival: null,
                baseFlightMinutes: null
            };
        }

        const baseSec = info.minutes * 60;
        let earliest;
        let latest;

        if (Number.isFinite(takeoffSec) && takeoffSec > 0) {
            // We observed the takeoff (WS push or explicit roster timestamp).
            earliest = takeoffSec + BOOK_FACTOR * baseSec;
            latest = takeoffSec + baseSec;
            if (earliest < nowSec) earliest = nowSec; // already in flight
            if (latest < nowSec) latest = nowSec;
        } else {
            earliest = Number.isFinite(lastAction) && lastAction > 0
                ? Math.max(nowSec, lastAction + BOOK_FACTOR * baseSec)
                : nowSec;
            latest = nowSec + baseSec;
        }
        if (earliest > latest) earliest = latest; // clock-skew guard

        return {
            destination: parsed.destination,
            country: info.name,
            earliestArrival: Math.round(earliest),
            latestArrival: Math.round(latest),
            baseFlightMinutes: info.minutes
        };
    }

    // â”€â”€â”€ STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const state = {
        apiKey: null,             // optional Torn faction-access key
        enemyRoster: [],          // [ { id, name, status, statusState, lastAction } ] from the API
        takeoffTimes: new Map(),  // playerId -> exact takeoff unix seconds (WS/fetch observation)
        loggedNoAccess: false     // only warn about missing access once per session
    };

    const StorageUtil = {
        get(key, dv) { try { const v = localStorage.getItem(key); return v === null ? dv : (JSON.parse(v) ?? dv); } catch (e) { return dv; } },
        set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }
    };
    // ─── STYLE + PILL RENDERER ─────────────────────────────────────────────────
    function ensureStyles() {
        if (document.getElementById('ssg-war-flights-styles')) return;
        const style = document.createElement('style');
        style.id = 'ssg-war-flights-styles';
        style.textContent = `
            .ssg-flight-pill {
                display: inline-flex; align-items: center; gap: 3px;
                margin-left: 6px; font-size: 10px; line-height: 1.2;
                font-weight: 600; color: #4fc3f7;
                background: rgba(20,20,40,0.92);
                border: 1px solid #4fc3f7; border-radius: 3px;
                padding: 1px 5px; vertical-align: middle; cursor: default;
                box-shadow: 0 0 3px rgba(79,195,247,0.25);
            }
            .ssg-flight-pill .ssg-fw-timer { margin-left: 1px; }
            .ssg-flight-pill.ssg-fw-urgent { border-color: #ffaa00; color: #ffaa00; }
            .ssg-flight-pill.ssg-fw-landed { border-color: #2d8a4e; color: #7ed994; }
            .ssg-flight-pill.ssg-fw-nokey { color: #ffaa00; border-color: #ffaa00; opacity: 0.9; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    // "~12m 30s â€“ 20m" / "landing â‰¤ 25m" / "âœ… landed"
    function formatWindow(nowMs, earliestSec, latestSec) {
        const fmt = s => {
            if (s <= 0) return 'now';
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
            return h > 0 ? `${h}h ${pad2(m)}m` : (m > 0 ? `${m}m ${pad2(sec)}s` : `${sec}s`);
        };
        const e = Math.floor((earliestSec * 1000 - nowMs) / 1000);
        const l = Math.floor((latestSec * 1000 - nowMs) / 1000);
        if (l <= 0) return { text: 'âœ… landed', cls: 'ssg-fw-landed' };
        if (e <= 0) return { text: `landing â‰¤ ${fmt(l)}`, cls: 'ssg-fw-urgent' };
        return { text: `~${fmt(e)} â€“ ${fmt(l)}`, cls: '' };
    }

    // Build the per-flyer display object. Uses an observed takeoff (WS/fetch) when
    // available to tighten the window; otherwise falls back to the last-action bound.
    function windowForStatus(description, id) {
        const parsed = parseTravelStatus(description);
        if (!parsed || parsed.type === 'abroad') return null;

        const numId = id != null ? Number(id) : null;
        const takeoffSec = (numId != null && Number.isFinite(state.takeoffTimes.get(numId)))
            ? state.takeoffTimes.get(numId)
            : null;

        const win = estimateLandingWindow({ description, takeoffSec, now: Math.floor(Date.now() / 1000) });
        if (!win) return null;
        if (!win.latestArrival) return { destination: win.destination || parsed.countryName, timer: null };
        return {
            destination: win.destination || parsed.countryName,
            timer: { e: win.earliestArrival, l: win.latestArrival }
        };
    }

    function createPill(fly) {
        const pill = document.createElement('span');
        pill.className = 'ssg-flight-pill';
        const dest = fly.destination || 'flying';
        if (fly.timer) {
            pill.dataset.e = String(fly.timer.e);
            pill.dataset.l = String(fly.timer.l);
            pill.appendChild(document.createTextNode(`âœˆï¸ ${dest} `));
            const timer = document.createElement('span');
            timer.className = 'ssg-fw-timer';
            timer.textContent = 'â€¦';
            pill.appendChild(timer);
        } else {
            pill.classList.add('ssg-fw-nokey');
            pill.textContent = `âœˆï¸ ${dest} (no duration)`;
            pill.title = 'Destination recognised but this country has no base flight duration.';
        }
        return pill;
    }

    function updatePillText(pill, nowMs) {
        const timer = pill.querySelector('.ssg-fw-timer');
        if (!timer) return;
        const e = parseInt(pill.dataset.e, 10);
        const l = parseInt(pill.dataset.l, 10);
        if (!Number.isFinite(e) || !Number.isFinite(l)) { timer.textContent = 'â€¦'; return; }
        const { text, cls } = formatWindow(nowMs, e, l);
        timer.textContent = text;
        pill.classList.toggle('ssg-fw-urgent', cls === 'ssg-fw-urgent');
        pill.classList.toggle('ssg-fw-landed', cls === 'ssg-fw-landed');
    }
// â”€â”€â”€ MEMBER ROW DISCOVERY + PILL INJECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Same DOM pattern proven by the SSG War Script:
    //   rows: '.desc-wrap li[class*="member"], .desc-wrap [class*="member___"]'
    //   id:   'a[href*="profiles.php?XID="]'
    //   status text: '[class*="status___"]' / '[class*="status"]'
    function memberRows() {
        return Array.from(document.querySelectorAll(
            '.desc-wrap li[class*="member"], .desc-wrap [class*="member___"]'
        ));
    }

    function playerIdFor(row) {
        const link = row.querySelector('a[href*="profiles.php?XID="]');
        if (!link) return null;
        const m = (link.getAttribute('href') || '').match(/XID=(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    function statusTextFor(row) {
        const el = row.querySelector('[class*="status___"], [class*="status"]');
        if (!el) return '';
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        // Drop a trailing Torn countdown such as "(14s)" appended to the status.
        return t.replace(/\s*$$\d+[shms]$$$/i, '').trim();
    }

    function renderRows() {
        if (!document.body) return;
        ensureStyles();
        const enemyOk = state.enemyRoster.length > 0;

        memberRows().forEach(row => {
            if (row.querySelector('.ssg-flight-pill')) return;
            const id = playerIdFor(row);
            const statusText = statusTextFor(row);
            if (!statusText) return;

            const parsed = parseTravelStatus(statusText);
            if (!parsed || parsed.type === 'abroad') {
                // Not flying right now â€” clear any tracked takeoff (they landed).
                if (id != null && state.takeoffTimes.has(Number(id))) {
                    state.takeoffTimes.delete(Number(id));
                }
                return;
            }

            let fly = windowForStatus(statusText, id);

            // If we have enemy roster data, only annotate flyers that are actually
            // in that faction (avoids labelling your own team's travellers).
            if (enemyOk && id != null && !state.enemyRoster.some(e => Number(e.id) === Number(id))) {
                return;
            }

            if (!fly) fly = { destination: null, timer: null };
            const pill = createPill(fly);
            const statusEl = row.querySelector('[class*="status___"], [class*="status"]');
            const anchor = statusEl || row.querySelector('a[href*="profiles.php?XID="]');
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(pill, anchor.nextSibling);
            } else {
                row.appendChild(pill);
            }
        });
    }

    function tickCountdowns() {
        const nowMs = Date.now();
        document.querySelectorAll('.ssg-flight-pill').forEach(pill => updatePillText(pill, nowMs));
    }

    // â”€â”€â”€ LIVE TAKEOFF OBSERVATION (WebSocket) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Torn pushes user status changes over a WebSocket; we capture the exact
    // takeoff instant the first moment a member appears "Travelingâ€¦", yielding a
    // much tighter window than the last-action bound.
    function handleStatusPush(su) {
        if (!su || !su.status) return;
        const id = Number(su.userId);
        if (!Number.isFinite(id)) return;
        const text = (su.status.text || '').trim();

        const parsed = parseTravelStatus(text);
        if (parsed && parsed.type !== 'abroad') {
            if (!state.takeoffTimes.has(id)) {
                state.takeoffTimes.set(id, Math.floor(Date.now() / 1000));
                renderRows();
            }
        } else if (state.takeoffTimes.has(id)) {
            // Landed (or otherwise left the "flying" state).
            state.takeoffTimes.delete(id);
            renderRows();
        }
    }

    function installWebSocketInterceptor() {
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const RealWS = targetWindow.WebSocket;
        if (!RealWS) return;

        targetWindow.WebSocket = function (...args) {
            const socket = new RealWS(...args);
            socket.addEventListener('message', ev => {
                try {
                    const raw = ev.data;
                    if (typeof raw !== 'string' || raw[0] !== '{') return;
                    const json = JSON.parse(raw);
                    const respUser = json?.push?.pub?.data?.message?.namespaces?.users;
                    const su = respUser?.actions?.updateStatus;
                    if (su && su.userId !== undefined) handleStatusPush(su);
                } catch (e) { /* ignore */ }
            });
            return socket;
        };
        // Re-attach prototype accessors (Tampermonkey sandbox may not inherit).
        try {
            Object.defineProperties(targetWindow.WebSocket, {
                prototype: { value: RealWS.prototype },
                CONNECTING: { value: RealWS.CONNECTING },
                OPEN: { value: RealWS.OPEN },
                CLOSING: { value: RealWS.CLOSING },
                CLOSED: { value: RealWS.CLOSED }
            });
        } catch (e) { /* ignore */ }
    }
    // ─── FACTION ROSTER VIA TORN API (optional; requires faction access) ───────
    function gmRequest(url) {
        return new Promise((resolve) => {
            if (typeof GM_xmlhttpRequest === 'undefined') return resolve(null);
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: r => {
                    try { resolve({ status: r.status, data: JSON.parse(r.responseText) }); }
                    catch (e) { resolve({ status: r.status, data: null }); }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null),
                timeout: 15000
            });
        });
    }

    async function refreshEnemyRoster() {
        const key = state.apiKey;
        if (!key) return [];
        const enc = encodeURIComponent(key);

        try {
            const wars = await gmRequest(`https://api.torn.com/v2/faction/?selections=wars&key=${enc}`);
            if (!wars || wars.status !== 200 || !wars.data) {
                if (!state.loggedNoAccess) { console.warn('[SSG War Flights] Cannot read ranked war (check the key has at least Faction access).'); state.loggedNoAccess = true; }
                return [];
            }
            state.loggedNoAccess = false;

            const rankedWar = wars.data.wars?.ranked;
            if (!rankedWar || !rankedWar.start) return [];
            const enemy = (rankedWar.factions || []).find(f => f.id !== 53272);
            if (!enemy) return [];

            const res = await gmRequest(`https://api.torn.com/v2/faction/${encodeURIComponent(enemy.id)}?selections=basic,members&key=${enc}`);
            if (!res || res.status !== 200 || !res.data) return [];

            const members = res.data.members || {};
            const list = Array.isArray(members) ? members : Object.values(members);
            return list
                .filter(m => m && m.id)
                .map(m => ({
                    id: Number(m.id),
                    name: m.name,
                    status: m.status?.description || m.status?.state || 'Unknown',
                    statusState: m.status?.state || 'Unknown',
                    lastAction: m.last_action?.timestamp || null
                }));
        } catch (e) {
            console.warn('[SSG War Flights] roster refresh failed:', e);
            return [];
        }
    }

    async function refreshEnemyRosterIfKey() {
        state.enemyRoster = await refreshEnemyRoster();
        renderRows();
    }

    // â”€â”€â”€ KEY PROMPT (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function askForKey() {
        const existing = StorageUtil.get(CONFIG.KEY_STORAGE, null) || (typeof GM_getValue === 'function' ? GM_getValue(CONFIG.KEY_STORAGE, null) : null) || '';
        const input = window.prompt(
            'SSG War Flight Times\n\nOptional: paste a Torn API key with at least "Faction" access to ' +
            '(a) restrict flight pills to the enemy roster and (b) base them on live status + last-action data.\n\n' +
            'Leave blank to keep the free DOM/WebSocket mode (marks all flyers, wider estimate windows).\n\n' +
            (existing ? `Currently saved: ${existing}` : 'No key saved yet.'),
            existing
        );
        if (input === null) return; // cancelled
        const trimmed = input.trim();
        if (trimmed === existing) return;
        if (trimmed) {
            StorageUtil.set(CONFIG.KEY_STORAGE, trimmed);
            try { GM_setValue(CONFIG.KEY_STORAGE, trimmed); } catch (e) { /* ignore */ }
        } else {
            try { localStorage.removeItem(CONFIG.KEY_STORAGE); } catch (e) { /* ignore */ }
            try { GM_setValue(CONFIG.KEY_STORAGE, ''); } catch (e) { /* ignore */ }
        }
        state.apiKey = trimmed || null;
        state.enemyRoster = [];
        refreshEnemyRosterIfKey();
    }
    // ─── APP BOOTSTRAP ─────────────────────────────────────────────────────────
    async function applyApiKey() {
        const stored = (typeof GM_getValue === 'function' ? GM_getValue(CONFIG.KEY_STORAGE, '') : '')
            || StorageUtil.get(CONFIG.KEY_STORAGE, '') || '';
        if (stored) {
            state.apiKey = stored;
            refreshEnemyRosterIfKey(); // fire-and-forget background validation/load
        }
    }

    let domTimer = null;
    let tickTimer = null;
    let refetchTimer = null;

    function start() {
        console.log('[SSG War Flights] initialized (v' + CONFIG.version + ')');
        ensureStyles();
        applyApiKey();
        installWebSocketInterceptor();

        if (!domTimer) domTimer = setInterval(renderRows, CONFIG.pollInterval);
        if (!tickTimer) tickTimer = setInterval(tickCountdowns, CONFIG.tickInterval);
        if (!refetchTimer) refetchTimer = setInterval(() => { if (state.apiKey) refreshEnemyRosterIfKey(); }, CONFIG.refetchInterval);

        setTimeout(renderRows, 800);
        setTimeout(renderRows, 2500);
    }

    function stop() {
        if (domTimer) { clearInterval(domTimer); domTimer = null; }
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        if (refetchTimer) { clearInterval(refetchTimer); refetchTimer = null; }
        document.querySelectorAll('.ssg-flight-pill').forEach(el => el.remove());
    }

    function isWarPage() {
        const hash = window.location.href.split('#')[1] || '';
        return hash.toLowerCase().startsWith('/war') || window.location.search.includes('step=profile');
    }

    // Torn navigates in-SPA (hash changes), so react to tab switches too.
    let currentUrl = window.location.href;
    setInterval(() => {
        const now = window.location.href;
        if (now !== currentUrl) {
            currentUrl = now;
            if (isWarPage()) start();
            else stop();
        }
    }, 1000);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { if (isWarPage()) setTimeout(start, 700); });
    } else if (isWarPage()) {
        setTimeout(start, 700);
    }

    // Small advanced-user hook (open console: SSGWarFlights.setApiKey()).
    try {
        window.SSGWarFlights = {
            version: CONFIG.version,
            setApiKey: askForKey,
            refresh: refreshEnemyRosterIfKey,
            stop,
            start
        };
    } catch (e) { /* ignore */ }
})();
