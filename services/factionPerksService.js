// ─── Faction Perks service ───────────────────────────────────────────────────
// Feeds the "Faction Perks" section on the public home page straight from the
// Torn API so it never has to be maintained by hand.
//
// GET https://api.torn.com/v2/faction/upgrades?key=<faction key>
// returns:
//   {
//     state: 'peace' | 'war',
//     upgrades: {
//       core:  { upgrades: [{ id, name, ability, level, cost, unlocked_at }] },
//       peace: [{ name, order, multiplier, upgrades: [...] }],
//       war:   [{ name, order, multiplier, upgrades: [...] }]
//     }
//   }
//
// `state` says which branch set (peace/war) is currently in effect, so we show
// the always-on Core upgrades plus the branches active for the current state.
// The result is cached: perks only change when the faction buys an upgrade.

const axios = require('axios');
const { decryptOrRaw } = require('./keyCipher');

const CACHE_TTL = 30 * 60 * 1000;  // 30 minutes - perks change rarely
const FAILURE_TTL = 5 * 60 * 1000; // 5 minutes - back off after a failed call

let cache = { value: null, expiry: 0 };
let pending = null;

// Helper to get faction API key (decrypted at point of use)
async function getFactionApiKey() {
  try {
    const FactionConfig = require('../models/FactionConfig');
    const config = await FactionConfig.findOne({ key: 'config' });
    if (config?.tornFactionApiKey) return decryptOrRaw(config.tornFactionApiKey);
  } catch (err) {
    console.error('Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY || null;
}

// Only upgrades the faction actually has unlocked should be advertised.
function isUnlocked(upgrade) {
  if (typeof upgrade.level === 'number') return upgrade.level > 0;
  return !!upgrade.unlocked_at;
}

function toDisplayUpgrades(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(u => u && u.name && isUnlocked(u))
    .map(u => ({
      name: u.name,
      ability: u.ability || '',
      level: typeof u.level === 'number' ? u.level : null
    }));
}

// Pure transform of the Torn payload into what the template renders.
// Returns { state, stateLabel, cards } or null when there is nothing to show.
function normalizePerks(payload) {
  if (!payload || payload.error || !payload.upgrades) return null;

  const state = payload.state === 'war' ? 'war' : 'peace';
  const upgrades = payload.upgrades;

  const cards = [];

  // Core upgrades are always active (armory unlocks, capacity, chaining, ...)
  const coreUpgrades = toDisplayUpgrades(upgrades.core?.upgrades);
  if (coreUpgrades.length) {
    cards.push({ name: 'Core', upgrades: coreUpgrades });
  }

  // Branch upgrades active for the current peace/war state, in Torn's order
  const branches = Array.isArray(upgrades[state]) ? upgrades[state] : [];
  branches
    .slice()
    .filter(branch => branch && branch.name)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach(branch => {
      const branchUpgrades = toDisplayUpgrades(branch.upgrades);
      if (branchUpgrades.length) {
        cards.push({ name: branch.name, upgrades: branchUpgrades });
      }
    });

  if (!cards.length) return null;
  return {
    state,
    stateLabel: state === 'war' ? 'War' : 'Peace',
    cards
  };
}

// Fetch (or serve from cache) the faction perk tree.
// `keyOverride` exists for tests; production callers pass nothing.
// Never throws - returns null on any failure so the home page can fall back
// to the hand-written cards.
async function fetchFactionPerks(keyOverride) {
  if (Date.now() < cache.expiry) return cache.value;
  if (pending) return pending;

  pending = (async () => {
    try {
      const key = keyOverride || await getFactionApiKey();
      if (!key) {
        cache = { value: null, expiry: Date.now() + FAILURE_TTL };
        return null;
      }

      const res = await axios.get('https://api.torn.com/v2/faction/upgrades', {
        params: { key: String(key).trim() },
        timeout: 10000
      });

      const perks = normalizePerks(res.data);
      // Cache empty results briefly too, so a bad key doesn't hammer Torn
      cache = { value: perks, expiry: Date.now() + (perks ? CACHE_TTL : FAILURE_TTL) };
      return perks;
    } catch (err) {
      console.warn('Could not fetch faction perks:', err.message);
      cache = { value: null, expiry: Date.now() + FAILURE_TTL };
      return null;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

module.exports = { fetchFactionPerks, normalizePerks, clearCache };

// Test-only hook to reset the module-level cache between tests.
function clearCache() {
  cache = { value: null, expiry: 0 };
  pending = null;
}
