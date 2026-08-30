// ─── Enemy intel service (free data sources) ──────────────────────────────────
// Provides two FFScouter-premium-style insights using free inputs:
//   1. Landing-window estimates for enemies currently flying, derived from
//      Torn's public member status text + public flight-duration constants
//      (same methodology class as FFScouter premium: it is an estimate).
//   2. Top-two battle-stat percentages from crowdsourced spy data (TornStats),
//      or FFScouter's premium `distribution` field when a premium key is saved.
const axios = require('axios');

// ─── Public game data: base one-way flight durations (minutes) ────────────────
// Torn↔country legs are symmetric for airline flights. Source: in-game travel
// agency values as published by the open-source TornTools extension.
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

// Status-text variants → FLIGHT_TIMES keys
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

// ─── TornStats spy cache ──────────────────────────────────────────────────────
const spyCache = new Map();
const SPY_TTL = 10 * 60 * 1000;      // successful spy lookups: 10 minutes
const SPY_NEG_TTL = 5 * 60 * 1000;   // misses/errors: 5 minutes (coverage grows)

function lookupCountryKey(text) {
  if (!text) return null;
  return COUNTRY_ALIASES[String(text).trim().toLowerCase()] || null;
}

function canonicalCountryName(key, raw) {
  if (key && FLIGHT_TIMES[key]) return FLIGHT_TIMES[key].name;
  if (!raw) return null;
  return String(raw).trim().replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Parse a Torn member status description ───────────────────────────────────
// Handles: "Traveling from Torn to China", "Traveling from UAE to Torn",
// "Traveling to Mexico", "In South Africa". Returns null for hospital/jail/
// okay/other statuses (callers gate on state anyway; this is a safety net).
function parseTravelStatus(description) {
  if (!description || typeof description !== 'string') return null;
  const d = description.trim();

  let m = d.match(/^Traveling\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (m) {
    const origin = m[1].trim();
    const dest = m[2].trim();
    if (/^torn$/i.test(dest)) {
      // Returning home — flight time comes from the origin country's table.
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

// ─── Estimate a landing window (unix seconds) for a flying member ─────────────
// earliest: latest takeoff cannot be before the member's last recorded action
//           (players cannot act mid-flight); assume book perk for the best case.
// latest:   worst case is a takeoff that happened this instant, no book.
// Returns null for members not mid-flight, or unknown destinations.
function estimateLandingWindow({ description, lastAction, now } = {}) {
  const nowSec = Number.isFinite(now) ? Math.floor(now) : Math.floor(Date.now() / 1000);
  const parsed = parseTravelStatus(description);
  if (!parsed || parsed.type === 'abroad') return null;

  const info = parsed.countryKey ? FLIGHT_TIMES[parsed.countryKey] : null;
  if (!info) {
    // Destination known (or unknown) but no duration data — report the country
    // without a timer so the UI can still show where they are headed.
    return {
      destination: parsed.destination,
      country: info ? info.name : null,
      earliestArrival: nowSec,
      latestArrival: null,
      baseFlightMinutes: null
    };
  }

  const baseSec = info.minutes * 60;
  let earliest = Number.isFinite(lastAction) && lastAction > 0
    ? Math.max(nowSec, lastAction + BOOK_FACTOR * baseSec)
    : nowSec;
  const latest = nowSec + baseSec;
  if (earliest > latest) earliest = latest; // clock-skew guard

  return {
    destination: parsed.destination,
    country: info.name,
    earliestArrival: Math.round(earliest),
    latestArrival: Math.round(latest),
    baseFlightMinutes: info.minutes
  };
}

// ─── Top-two stat percentages ─────────────────────────────────────────────────
// Input: { strength, speed, dexterity } (from FFScouter premium distribution;
// values are already percentages of total) → { top1, top2 }
function statSplitFromPercentages(pct) {
  if (!pct || typeof pct !== 'object') return null;
  const entries = [];
  if (Number.isFinite(+pct.strength) && +pct.strength > 0) entries.push({ stat: 'Strength', pct: Math.round(+pct.strength) });
  if (Number.isFinite(+pct.speed) && +pct.speed > 0) entries.push({ stat: 'Speed', pct: Math.round(+pct.speed) });
  if (Number.isFinite(+pct.dexterity) && +pct.dexterity > 0) entries.push({ stat: 'Dexterity', pct: Math.round(+pct.dexterity) });
  if (!entries.length) return null;
  entries.sort((a, b) => b.pct - a.pct);
  return { top1: entries[0], top2: entries[1] || null, source: 'ffscouter-premium' };
}

// Input: TornStats spy record { strength, defense, speed, dexterity, total }
// → { top1, top2 } computed against the total (or the sum when total missing).
function computeStatPercentages(spy) {
  if (!spy || typeof spy !== 'object') return null;
  const stats = [
    { stat: 'Strength', value: +spy.strength || 0 },
    { stat: 'Defense', value: +spy.defense || 0 },
    { stat: 'Speed', value: +spy.speed || 0 },
    { stat: 'Dexterity', value: +spy.dexterity || 0 }
  ];
  if (!stats.some(s => s.value > 0)) return null;
  const total = +spy.total || stats.reduce((sum, s) => sum + s.value, 0);
  if (!total) return null;
  const entries = stats
    .map(s => ({ stat: s.stat, pct: Math.round((s.value / total) * 100) }))
    .sort((a, b) => b.pct - a.pct);
  return { top1: entries[0], top2: entries[1] || null, source: 'tornstats-spy', spyTimestamp: +spy.timestamp || null };
}

// ─── TornStats API client (free; requires a linked TornStats account key) ─────
// Docs: https://tornstats.com/api — rate limit 100 calls/minute.
function fetchSpyUser(tornStatsKey, playerId) {
  if (!tornStatsKey || !playerId) return Promise.resolve(null);
  const cacheKey = `spy:${playerId}`;
  const cached = spyCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return Promise.resolve(cached.value);
  }
  return axios.get(`https://www.tornstats.com/api/v2/${encodeURIComponent(tornStatsKey)}/spy/user/${encodeURIComponent(playerId)}`, { timeout: 10000 })
    .then(res => {
      const data = res.data || {};
      const spy = Array.isArray(data.spy) ? data.spy[0] : data.spy;
      if (data.status === true && spy) {
        spyCache.set(cacheKey, { value: spy, expiry: Date.now() + SPY_TTL });
        return spy;
      }
      spyCache.set(cacheKey, { value: null, expiry: Date.now() + SPY_NEG_TTL });
      return null;
    })
    .catch(() => {
      spyCache.set(cacheKey, { value: null, expiry: Date.now() + SPY_NEG_TTL });
      return null;
    });
}

module.exports = {
  FLIGHT_TIMES,
  parseTravelStatus,
  estimateLandingWindow,
  statSplitFromPercentages,
  computeStatPercentages,
  fetchSpyUser
};