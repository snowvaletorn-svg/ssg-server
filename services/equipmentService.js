// ─── Equipment service ────────────────────────────────────────────────────────
// Feeds the Profile page's "Equipped Gear" card and the two ranked-gear
// evaluation buttons ("Find a Better Ranked Weapon" / "Find Ranked War Armor").
//
// Torn side — GET https://api.torn.com/v2/user/equipment?key=<member key>
// (minimal access). Live payload per item (richer than the public docs):
//   { id, name, uid, type: 'Weapon'|'Armor', sub_type, rarity,
//     slot, stats: { damage, accuracy, armor, quality },
//     bonuses: [{ id, title, description, value }],
//     ammo: { id, name, type, quantity } | null, mods: [{ id, name }] }
// Slot map verified live: 1 Primary, 2 Secondary, 3 Melee, 4 Body Armor,
// 5 Temporary, 6 Head, 7 Leg, 8 Foot, 9 Hand.
//
// Weav3r side — GET https://weav3r.dev/api/ranked-weapons (public, anonymous
// budget ~10 req/min per IP, responses cached 30-180s upstream). At least one
// filter is required; we always send tab + a stat filter and sort price asc so
// results come back ranked cheapest → most expensive. Weapons support the
// `minDamage` and `minAccuracy` floors (both inclusive); armor supports
// `minQuality`. Responses look like:
//   { total_count, weapons: [{ uid, itemId, itemName, weaponType, rarity,
//     damage, accuracy, quality, bonuses: {0:{bonus,value,description}}, price,
//     playerName, quantity, marketPrice, lastUpdated, itemImage, source }] }
// (stats arrive as strings; normalize to numbers before use.)

const axios = require('axios');

const WEAV3R_BASE = 'https://weav3r.dev/api';
const WEAV3R_RANKED_URL = 'https://weav3r.dev/ranked-weapons';
const EVAL_RESULT_LIMIT = 25;
const EVAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — kind to the anonymous 10/min budget

// Slot numbers → display labels + weav3r weaponType filter values.
const SLOT_LABELS = {
  1: 'Primary', 2: 'Secondary', 3: 'Melee', 4: 'Body Armor', 5: 'Temporary',
  6: 'Head Armor', 7: 'Leg Armor', 8: 'Foot Armor', 9: 'Hand Armor'
};
const WEAPON_SLOT_TO_WEAV3R_TYPE = { 1: 'primary', 2: 'secondary', 3: 'melee' };

let evalCache = new Map(); // key → { value, expiry }

function clearCaches() { evalCache = new Map(); }

// ── Normalization ────────────────────────────────────────────────────────────

function toNumOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Turn one raw equipment row into the shape the dashboard renders.
function normalizeEquipmentItem(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: item.id ?? null,
    name: item.name || 'Unknown item',
    type: item.type || null,
    subType: item.sub_type || null,
    slot: typeof item.slot === 'number' ? item.slot : null,
    slotLabel: SLOT_LABELS[item.slot] || (item.slot != null ? `Slot ${item.slot}` : ''),
    rarity: item.rarity || null,
    stats: {
      damage: toNumOrNull(item.stats?.damage),
      accuracy: toNumOrNull(item.stats?.accuracy),
      armor: toNumOrNull(item.stats?.armor),
      quality: toNumOrNull(item.stats?.quality)
    },
    bonuses: Array.isArray(item.bonuses)
      ? item.bonuses
          .filter(b => b && (b.title || b.description))
          .map(b => ({
            title: b.title || 'Bonus',
            value: toNumOrNull(b.value),
            description: b.description || ''
          }))
      : [],
    ammo: item.ammo ? { name: item.ammo.name, quantity: item.ammo.quantity ?? 0 } : null,
    mods: Array.isArray(item.mods) ? item.mods.filter(m => m && m.name).map(m => m.name) : []
  };
}

// Pure grouping of a raw v2/user/equipment payload into the loadout shape:
// { weapons: { primary, secondary, melee, temporary }, armor: [body, head, ...] }
function buildLoadout(equipmentPayload) {
  const rows = Array.isArray(equipmentPayload?.equipment) ? equipmentPayload.equipment : [];
  const items = rows.map(normalizeEquipmentItem).filter(Boolean);

  const weapons = { primary: null, secondary: null, melee: null, temporary: null };
  const armor = [];
  const other = [];

  for (const item of items) {
    if (item.type === 'Weapon') {
      if (item.slot === 1) weapons.primary = item;
      else if (item.slot === 2) weapons.secondary = item;
      else if (item.slot === 3) weapons.melee = item;
      else if (item.slot === 5) weapons.temporary = item;
      else other.push(item);
    } else if (item.type === 'Armor') {
      armor.push(item); // already in slot order from the API
    } else {
      other.push(item);
    }
  }

  return { weapons, armor, other };
}

// "Most used" = highest weapon experience among the equipped primary/secondary/
// melee weapons (Torn's weaponexp). Falls back to primary → secondary → melee
// when weaponexp is empty or unavailable (e.g. restricted keys).
function pickMostUsedWeapon(loadout, weaponExp) {
  const equipped = [loadout.weapons.primary, loadout.weapons.secondary, loadout.weapons.melee]
    .filter(Boolean);

  const expList = Array.isArray(weaponExp?.weaponexp) ? weaponExp.weaponexp : [];
  let best = null;
  for (const item of equipped) {
    const match = expList.find(e => e && e.name === item.name);
    const exp = match ? Number(match.exp) || 0 : 0;
    if (!best || exp > best.exp) best = { item, exp };
  }
  if (best && best.exp > 0) return best.item;

  // Fallback: primary → secondary → melee
  return loadout.weapons.primary || loadout.weapons.secondary || loadout.weapons.melee || null;
}

// ── Weav3r query builders + normalization (pure, unit-tested) ────────────────

// Better weapon = same slot class (primary/secondary/melee) that is strictly
// better on BOTH damage and accuracy, cheapest first.
// weav3r exposes `minDamage` and `minAccuracy` filters; both are inclusive floors,
// so we send floor(stat) + 1 to require a strictly better roll.
function buildWeaponEvalParams(currentWeapon) {
  const weaponType = WEAPON_SLOT_TO_WEAV3R_TYPE[currentWeapon.slot];
  if (!weaponType) return null;
  const damage = toNumOrNull(currentWeapon.stats?.damage);
  const accuracy = toNumOrNull(currentWeapon.stats?.accuracy);
  const params = {
    tab: 'weapons',
    weaponType,
    sortField: 'price',
    sortDirection: 'asc',
    limit: EVAL_RESULT_LIMIT
  };
  if (damage != null) params.minDamage = Math.floor(damage) + 1;
  if (accuracy != null) params.minAccuracy = Math.floor(accuracy) + 1;
  return params;
}

// Better armor = same armor piece with quality at least equal to the current
// piece's, cheapest first. weav3r has no armor-rating filter, so piece + quality
// is the closest lever.
function buildArmorEvalParams(currentArmor) {
  if (!currentArmor?.name) return null;
  const params = {
    tab: 'armor',
    armorPiece: currentArmor.name,
    sortField: 'price',
    sortDirection: 'asc',
    limit: EVAL_RESULT_LIMIT
  };
  const quality = toNumOrNull(currentArmor.stats?.quality);
  if (quality != null) params.minQuality = quality;
  return params;
}

// Normalize weav3r ranked rows: numeric stats, bonus object → array.
function normalizeRankedRows(payload) {
  const rows = Array.isArray(payload?.weapons) ? payload.weapons : [];
  return rows.map(w => ({
    uid: w.uid ?? null,
    itemId: w.itemId ?? null,
    name: w.itemName || 'Unknown item',
    weaponType: w.weaponType || null,
    rarity: w.rarity || null,
    damage: toNumOrNull(w.damage),
    accuracy: toNumOrNull(w.accuracy),
    quality: toNumOrNull(w.quality),
    bonuses: w.bonuses && typeof w.bonuses === 'object'
      ? Object.values(w.bonuses)
          .filter(b => b && (b.bonus || b.description))
          .map(b => ({ bonus: b.bonus || 'Bonus', value: toNumOrNull(b.value), description: b.description || '' }))
      : [],
    price: toNumOrNull(w.price),
    marketPrice: toNumOrNull(w.marketPrice),
    seller: w.playerName || null,
    quantity: toNumOrNull(w.quantity),
    source: w.source || null,
    itemImage: w.itemImage || null,
    lastUpdated: w.lastUpdated || null
  }));
}

// ── Network calls ────────────────────────────────────────────────────────────

// Fetch + group the member's equipped gear. Returns { ok, data } /
// { ok: false, error } — never throws, so the endpoint maps cleanly.
async function getEquipmentLoadout(apiKey) {
  const trimmed = (apiKey || '').trim();
  if (!trimmed) return { ok: false, error: 'No Torn API key provided.' };

  try {
    const res = await axios.get('https://api.torn.com/v2/user/equipment', {
      params: { key: trimmed },
      timeout: 15000
    });
    if (res.data?.error) {
      return { ok: false, error: res.data.error.error || 'Torn API error' };
    }

    const loadout = buildLoadout(res.data);

    // weaponexp is a nice-to-have: "most used" falls back to primary without it.
    let weaponExp = null;
    try {
      const expRes = await axios.get('https://api.torn.com/v2/user/weaponexp', {
        params: { key: trimmed },
        timeout: 15000
      });
      if (!expRes.data?.error) weaponExp = expRes.data;
    } catch (err) {
      console.warn('Equipment: weaponexp fetch failed (non-fatal):', err.message);
    }

    const mostUsedWeapon = pickMostUsedWeapon(loadout, weaponExp);

    return {
      ok: true,
      data: {
        ...loadout,
        mostUsedWeapon,
        rankedPageUrl: WEAV3R_RANKED_URL,
        fetchedAt: new Date().toISOString()
      }
    };
  } catch (err) {
    console.error('Equipment loadout error:', err.message);
    return { ok: false, error: 'Could not reach the Torn API. Try again shortly.' };
  }
}

// Evaluate ranked alternatives for the member's current gear via weav3r.
// `currentItem` must be a normalized equipment item (from buildLoadout).
// Returns { ok, data: { tab, current, totalCount, results, pageUrl } }.
async function evaluateGear(tab, currentItem) {
  if (!currentItem) return { ok: false, error: 'No equipped item to evaluate.' };

  const params = tab === 'armor'
    ? buildArmorEvalParams(currentItem)
    : buildWeaponEvalParams(currentItem);
  if (!params) {
    return { ok: false, error: 'This item type cannot be evaluated against ranked listings.' };
  }

  // Cache per resolved query so double-clicks stay inside the anonymous budget.
  const cacheKey = JSON.stringify(params);
  const cached = evalCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return { ok: true, data: { tab, current: currentItem, ...cached.value, pageUrl: WEAV3R_RANKED_URL } };
  }

  try {
    const res = await axios.get(`${WEAV3R_BASE}/ranked-weapons`, {
      params,
      timeout: 20000,
      headers: { 'User-Agent': 'SSG-Dashboard/1.0', Accept: 'application/json' }
    });

    const value = {
      totalCount: toNumOrNull(res.data?.total_count) ?? 0,
      results: normalizeRankedRows(res.data)
    };
    evalCache.set(cacheKey, { value, expiry: Date.now() + EVAL_CACHE_TTL });

    return { ok: true, data: { tab, current: currentItem, ...value, pageUrl: WEAV3R_RANKED_URL } };
  } catch (err) {
    const status = err.response?.status;
    console.error('Gear evaluation error:', status || err.message);
    if (status === 400) {
      return { ok: false, error: 'The ranked-gear service could not match this item.' };
    }
    return {
      ok: false,
      error: 'The ranked-gear service is unavailable right now. Browse weav3r.dev directly instead.'
    };
  }
}

module.exports = {
  getEquipmentLoadout,
  evaluateGear,
  // Pure helpers exported for unit tests
  buildLoadout,
  normalizeEquipmentItem,
  pickMostUsedWeapon,
  buildWeaponEvalParams,
  buildArmorEvalParams,
  normalizeRankedRows,
  clearCaches,
  SLOT_LABELS
};

