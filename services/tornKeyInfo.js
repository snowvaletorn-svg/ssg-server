// ─── Torn key/info validator ─────────────────────────────────────────────────
// Wraps Torn's official key-inspection endpoints to determine a key's access
// level and owner:
//   v1: https://api.torn.com/key/?selections=info&key=THE_KEY
//   v2: https://api.torn.com/v2/key/info?key=THE_KEY
//
// access_level values: Public, Minimal, Limited, Full.
// Custom keys report their exact selection coverage; Torn's docs say custom
// keys should be treated as if full-access, but we enforce our own required
// selection set against them (see REQUIRED_SELECTIONS below).
//
// Results are cached in memory for 24h keyed by a hash of the key — we never
// store the raw key as a cache identifier.

const crypto = require('crypto');
const axios = require('axios');

const KEY_INFO_TTL = 24 * 60 * 60 * 1000; // 24 hours
const keyInfoCache = new Map();

// Selections the SSG dashboard relies on. A custom key must cover all of them
// to be accepted as "equivalent to Full" for our purposes.
const REQUIRED_SELECTIONS = ['basic', 'profile', 'bars', 'personalstats'];

const ACCESS_TIER = { Public: 0, Minimal: 1, Limited: 2, Full: 3 };

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32);
}

function getCached(hash) {
  const entry = keyInfoCache.get(hash);
  if (entry && Date.now() < entry.expiry) return entry.value;
  keyInfoCache.delete(hash);
  return null;
}

function setCached(hash, value) {
  keyInfoCache.set(hash, { value, expiry: Date.now() + KEY_INFO_TTL });
}

/**
 * Fetch and normalize key/info data for a Torn API key.
 * @param {string} apiKey
 * @returns {Promise<{ok: true, data: object}|{ok: false, code: number, error: string}>}
 *   data: { accessLevel, accessTier, ownerId, selections }
 */
async function fetchKeyInfo(apiKey) {
  const trimmed = (apiKey || '').trim();
  if (!trimmed) return { ok: false, code: 1, error: 'No API key provided.' };

  const hash = hashKey(trimmed);
  const cached = getCached(hash);
  if (cached) return { ok: true, data: cached };

  try {
    const res = await axios.get('https://api.torn.com/v2/key/info', {
      params: { key: trimmed },
      timeout: 15000
    });

    if (res.data.error) {
      const code = res.data.error.code;
      return { ok: false, code, error: res.data.error.error || 'Torn API error' };
    }

    const info = res.data;

    // ── Access level: handle both Torn API shapes ─────────────────────────
    // v1 (key/?selections=info): { access_level: 'Full', ... } at top level.
    // v2 (v2/key/info): the whole payload is under `info`, e.g.
    //   { info: { selections: {...}, access: { level: 4, type: 'Full Access',
    //             faction: true, company: false, log: {...} } }, user: {...} }
    // Note: in v2 the payload object is the LIVE response itself (no nesting),
    // but the access block sits at `info.access`. Guard both layouts.
    const live = res.data;
    const accessRoot = live.info?.access || live.access || {};
    const a = accessRoot;

    let accessLevel = null;

    if (typeof a.level === 'number') {
      // v2 numeric level: 0=Public 1=Minimal 2=Limited 3=Full 4=Full(same tier)
      const num = a.level;
      accessLevel = ['Public', 'Minimal', 'Limited', 'Full', 'Full'][num] || 'Unknown';
    } else if (typeof a.type === 'string') {
      accessLevel = a.type.toLowerCase().includes('full') ? 'Full' : a.type;
    } else if (typeof a.access_level === 'string') {
      accessLevel = a.access_level;
    } else {
      accessLevel = a.level || 'Unknown';
    }

    const infoAccessLevel = live.access_level || a.access_level || accessLevel;
    if (infoAccessLevel && typeof infoAccessLevel === 'string' && accessLevel === 'Unknown') {
      accessLevel = infoAccessLevel;
    }

    // v2 returns selections as an object keyed by category at `info.selections`
    // (e.g. { user: ['basic','bars'], ... }); flatten to a list of leaf names.
    let selections = [];
    const selectionRoot = live.info?.selections || a.selections || null;
    if (Array.isArray(selectionRoot)) {
      selections = selectionRoot;
    } else if (selectionRoot && typeof selectionRoot === 'object') {
      for (const arr of Object.values(selectionRoot)) {
        if (Array.isArray(arr)) selections.push(...arr);
      }
    }
    // Some v1 responses expose selections directly at top level
    if (!selections.length && Array.isArray(live.selections)) {
      selections = live.selections;
    }

    const ownerId = live.user?.id != null ? Number(live.user.id)
      : (a.player_id != null ? Number(a.player_id) : null);

    const data = {
      accessLevel,
      accessTier: ACCESS_TIER[accessLevel] != null ? ACCESS_TIER[accessLevel] : -1,
      ownerId,
      selections
    };

    setCached(hash, data);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, code: 0, error: err.message };
  }
}

/**
 * Check whether a key meets our requirements: Full access, or a custom key
 * whose selections cover everything we need.
 * @returns {Promise<{sufficient: boolean, reason: string|null, info: object|null}>}
 */
async function checkKeySufficient(apiKey) {
  const result = await fetchKeyInfo(apiKey);

  if (!result.ok) {
    return { sufficient: false, reason: result.error, info: null };
  }

  const { accessLevel, accessTier, selections } = result.data;

  if (accessTier >= ACCESS_TIER.Full) {
    return { sufficient: true, reason: null, info: result.data };
  }

  // Custom keys may be below "Full" tier but cover the needed selections.
  // Only treat them as equivalent when they explicitly cover every category.
  const covered = REQUIRED_SELECTIONS.filter(sel =>
    selections.includes(sel)
  );

  if (selections.length > 0 && covered.length === REQUIRED_SELECTIONS.length) {
    return { sufficient: true, reason: null, info: result.data };
  }

  const missing = REQUIRED_SELECTIONS.filter(sel => !selections.includes(sel));
  const reason =
    accessLevel === 'Unknown'
      ? 'Could not determine key access level.'
      : `Key is ${accessLevel}, not Full.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}`;

  return { sufficient: false, reason, info: result.data };
}

// Clear the cache (used by tests)
function clearKeyInfoCache() {
  keyInfoCache.clear();
}

module.exports = {
  fetchKeyInfo,
  checkKeySufficient,
  clearKeyInfoCache,
  REQUIRED_SELECTIONS,
  ACCESS_TIER
};