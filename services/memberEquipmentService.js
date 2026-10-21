// ─── Member equipment service ──────────────────────────────────────────────────
// Daily snapshot of every faction member's equipped gear, for the Admin panel's
// "Member Equipment" tab (leadership only).
//
// Why this exists: leadership wants to see what members are wearing so they can
// suggest upgrades without asking each member for a screenshot. Equipment is
// pulled with each member's OWN saved Torn API key — the faction key cannot
// read a member's personal equipment (Torn privacy restriction).
//
// Privacy design decisions (deliberate, don't "simplify" these away):
// - We never store what a member paid for their gear. Torn's equipment
//   endpoint doesn't return purchase price, so there is nothing to leak. The
//   only price stored is the market price of a suggested UPGRADE — i.e. what
//   the faction would need to buy. That is the actionable number.
// - Gear the faction has ON LOAN to a specific member is tagged `factionOwned`
//   for that member only, so leadership can tell "member owns this" from "the
//   faction owns this and loans it out" and never tells a member to buy what
//   we already have. The tag is per-member (keyed off the armory's
//   `loaned_to` field) — matching on item name alone would wrongly mark a
//   member's own copy of an item the faction also owns.
//
// The sweep runs once a day (03:00 UTC cron). The Admin tab reads the stored
// snapshot — it never triggers live Torn calls on page load.

const axios = require('axios');
const { decryptOrRaw } = require('./keyCipher');
const {
  buildLoadout,
  pickMostUsedWeapon,
  evaluateGear: defaultEvaluateGear
} = require('./equipmentService');

const MEMBER_FETCH_CONCURRENCY = 10;   // Torn allows ~100 req/min per key
const WEAV3R_MIN_INTERVAL_MS = 6500;   // weav3r anonymous budget: 10 req/min
// weav3r's anonymous budget is 10 requests/minute per IP, so a sweep can only
// make ~600 calls/day. Each member can need up to TWO lookups (one weapon, one
// armor piece), so the cap must be well above 2x the member count or members
// silently lose their recommendation. 120 leaves headroom for a ~50-member
// faction while staying inside the daily budget when paced at 6.5s.
const MAX_WEAV3R_LOOKUPS_PER_RUN = 120;
const RETENTION_DAYS = 30;
const FACTION_ID = 53272;

// Torn API error codes that mean "this key can't read the data" rather than
// "something went wrong". Anything else is treated as a transient error.
const KEY_ERROR_CODES = new Set([2, 5, 6, 8]);

// ─── Pure helpers (unit-tested) ────────────────────────────────────────────────

// Normalize an item name for fuzzy matching: lowercase, strip everything that
// isn't a letter or digit. "Assault Body Armor" → "assaultbodyarmor".
function normName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Build a PER-MEMBER lookup of the faction gear that is actually on loan.
//
// This must be based on the armory's `loaned_to` field, not on "the faction
// owns an item with this name". The Faction Loans admin page works this way:
// a faction may own several copies of the same item, but only some of them
// are on loan to any given member. Matching on name alone would wrongly tag
// every member who happens to personally own an item the faction also owns,
// and would suppress the upgrade recommendation for their own gear.
//
// `loans` is a flat list of { playerId, name } — one entry per member per
// loaned item. Keyed by player id, so the same item name can be faction-owned
// for one member and personal for another.
function buildFactionOwnedIndex(loans) {
  const index = new Map();
  (Array.isArray(loans) ? loans : []).forEach(entry => {
    if (!entry) return;
    const playerId = Number(entry.playerId);
    const n = normName(entry.name);
    if (!playerId || !n) return;
    if (!index.has(playerId)) index.set(playerId, new Set());
    index.get(playerId).add(n);
  });
  return index;
}

// Mark a piece of gear as faction-owned when it matches gear the faction has
// on loan TO THIS SPECIFIC MEMBER. A member who owns a personal copy of an
// item the faction also owns is NOT tagged — that gear is their own.
function tagFactionOwned(item, factionIndex, playerId) {
  if (!item || !factionIndex) return item;
  const names = factionIndex.get(Number(playerId));
  item.factionOwned = !!(names && names.has(normName(item.name)));
  return item;
}

// Flatten a normalized equipment item into the shape we persist.
function toStoredItem(item) {
  if (!item) return null;
  return {
    id: item.id ?? null,
    name: item.name || null,
    slot: item.slot ?? null,
    slotLabel: item.slotLabel || null,
    rarity: item.rarity || null,
    quality: item.stats?.quality ?? null,
    damage: item.stats?.damage ?? null,
    accuracy: item.stats?.accuracy ?? null,
    armor: item.stats?.armor ?? null,
    bonuses: Array.isArray(item.bonuses) ? item.bonuses : [],
    factionOwned: !!item.factionOwned
  };
}

// Sum of the armor pieces' armor ratings — the number leadership compares on.
function totalArmorRating(armorItems) {
  return (Array.isArray(armorItems) ? armorItems : [])
    .reduce((sum, a) => sum + (Number(a?.armor) || 0), 0);
}

// The lowest-quality armor piece — the obvious upgrade candidate.
//
// Only PERSONAL pieces count. Faction-loaned gear is owned by the faction
// (and carries no quality roll), so it is never something a member should be
// told to buy; the same goes for pieces with no quality roll at all. When
// every piece is faction-owned or unrolled, there is no upgrade target.
function findLowestQualityArmor(armorItems) {
  const list = (Array.isArray(armorItems) ? armorItems : [])
    .filter(Boolean)
    .filter(a => !a.factionOwned && Number.isFinite(Number(a.quality)));
  if (!list.length) return null;
  return list.reduce((lowest, a) => {
    const lq = lowest.quality ?? Infinity;
    const aq = a.quality ?? Infinity;
    if (aq < lq) return a;
    if (aq === lq && (a.armor ?? 0) < (lowest.armor ?? 0)) return a;
    return lowest;
  });
}

// Build the persisted member row from a member + their gear.
function buildMemberRow(member, gear) {
  const base = {
    playerId: member?.id ?? null,
    playerName: member?.name || null,
    position: member?.position || null,
    timestamp: new Date(),
    status: 'ok',
    weapons: { primary: null, secondary: null, melee: null, temporary: null },
    armor: [],
    mostUsedWeapon: null,
    armorRatingTotal: 0,
    lowestQualityArmor: null
  };

  if (!gear?.ok) {
    base.status = gear?.status || 'error';
    return base;
  }

  const loadout = gear.loadout || {};
  const w = loadout.weapons || {};
  base.weapons = {
    primary: toStoredItem(w.primary),
    secondary: toStoredItem(w.secondary),
    melee: toStoredItem(w.melee),
    temporary: toStoredItem(w.temporary)
  };
  base.armor = (loadout.armor || []).map(toStoredItem).filter(Boolean);
  base.mostUsedWeapon = toStoredItem(loadout.mostUsedWeapon);
  base.armorRatingTotal = totalArmorRating(base.armor);
  base.lowestQualityArmor = toStoredItem(findLowestQualityArmor(base.armor));
  return base;
}

// Turn the cheapest qualifying weav3r listing into a recommendation with
// stat deltas against what the member already has.
//
// `rows` is already sorted cheapest → most expensive and already filtered by
// evaluateGear to be strictly better (weapons: better damage AND accuracy;
// armor: equal-or-better quality), so the first row is the cheapest upgrade.
function buildRecommendation(current, rows, kind) {
  if (!current || !Array.isArray(rows) || !rows.length) return null;
  const best = rows[0];
  if (!best) return null;

  const delta = (a, b) => {
    // Number(null) is 0, which would turn a missing stat into a huge bogus
    // delta. Require both sides to be real, finite numbers.
    if (a == null || b == null) return null;
    const x = Number(a), y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return Math.round((y - x) * 100) / 100;
  };

  return {
    currentName: current.name || null,
    name: best.name || null,
    rarity: best.rarity || null,
    quality: best.quality ?? null,
    damage: best.damage ?? null,
    accuracy: best.accuracy ?? null,
    armor: best.armor ?? null,
    damageDelta: delta(current.damage, best.damage),
    accuracyDelta: delta(current.accuracy, best.accuracy),
    qualityDelta: delta(current.quality, best.quality),
    armorDelta: delta(current.armor, best.armor),
    price: best.price ?? null,
    source: best.source || null,
    bonuses: Array.isArray(best.bonuses) ? best.bonuses : [],
    evaluatedAt: new Date()
  };
}

// A simple interval pacer — keeps weav3r calls inside the anonymous rate
// budget no matter how many members we're checking.
function createPacer(minIntervalMs) {
  let nextAllowed = 0;
  return async function pace() {
    const now = Date.now();
    const wait = Math.max(0, nextAllowed - now);
    nextAllowed = Math.max(now, nextAllowed) + minIntervalMs;
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  };
}

// ─── Network helpers ──────────────────────────────────────────────────────────

async function getFactionApiKey() {
  try {
    const FactionConfig = require('../models/FactionConfig');
    const config = await FactionConfig.findOne({ key: 'config' });
    if (config?.tornFactionApiKey) return decryptOrRaw(config.tornFactionApiKey);
  } catch (err) {
    console.error('[MemberEquipment] Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY?.trim() || null;
}

// The faction roster, with each member's saved key attached (when they have
// one). The roster comes from Torn so we're always looking at real members.
async function fetchFactionMembers() {
  const factionKey = await getFactionApiKey();
  if (!factionKey) throw new Error('No faction API key configured.');

  const res = await axios.get(
    'https://api.torn.com/v2/faction/?selections=members&key=' + encodeURIComponent(factionKey)
  );
  if (res.data?.error) throw new Error(res.data.error.error || 'Torn API error');
  const members = res.data?.members || [];

  const User = require('../models/User');
  const dbUsers = await User.find(
    { tornPlayerId: { $ne: null } },
    'tornPlayerId tornName tornApiKey accountType'
  );
  const dbByTornId = new Map();
  dbUsers.forEach(u => { if (u.tornPlayerId) dbByTornId.set(u.tornPlayerId, u); });

  return members.map(m => {
    const dbUser = dbByTornId.get(m?.id);
    return {
      id: m?.id ?? null,
      name: m?.name || null,
      position: m?.position || null,
      apiKey: dbUser?.tornApiKey ? decryptOrRaw(dbUser.tornApiKey) : null,
      isEmployee: dbUser?.accountType === 'employee'
    };
  });
}

// The faction armory's items that are actually ON LOAN, mapped to the member
// holding each one.
//
// This mirrors how the Faction Loans admin page resolves loans: an armory item
// counts as loaned only when `loaned` is truthy and `loaned_to` names a
// member. `loaned_to` may be a single id or a comma-separated list of ids.
//
// Returns a flat list of { playerId, name } entries.
async function fetchFactionLoans() {
  const factionKey = await getFactionApiKey();
  if (!factionKey) return [];
  const key = encodeURIComponent(factionKey);
  const loans = [];

  // Collect the armory items for each selection.
  const collect = (items) => {
    (Array.isArray(items) ? items : []).forEach(item => {
      if (!item) return;
      if (!item.loaned_to || !item.loaned) return;
      const ids = typeof item.loaned_to === 'string'
        ? item.loaned_to.split(',').map(id => id.trim()).filter(Boolean)
        : [String(item.loaned_to)];
      ids.forEach(id => {
        const playerId = Number(id);
        if (!playerId) return;
        loans.push({ playerId, name: item.name });
      });
    });
  };

  try {
    const armorRes = await axios.get(`https://api.torn.com/faction/?selections=armor&key=${key}`);
    collect(armorRes.data?.armor || []);
  } catch (err) {
    console.warn('[MemberEquipment] armor armory fetch failed:', err.message);
  }
  try {
    const weaponsRes = await axios.get(`https://api.torn.com/faction/?selections=weapons&key=${key}`);
    collect(weaponsRes.data?.weapons || []);
  } catch (err) {
    console.warn('[MemberEquipment] weapon armory fetch failed:', err.message);
  }
  return loans;
}

// One member's gear. Returns { ok: true, loadout } or { ok: false, status }.
// `status` is 'no_key' | 'key_restricted' | 'error' — a failure here never
// aborts the sweep, it just marks that one member.
async function fetchMemberGear(apiKey) {
  if (!apiKey) return { ok: false, status: 'no_key' };
  try {
    const res = await axios.get('https://api.torn.com/v2/user/equipment', {
      params: { key: apiKey },
      timeout: 15000
    });
    if (res.data?.error) {
      const code = Number(res.data.error.code);
      const message = String(res.data.error.error || '');
      const keyish = KEY_ERROR_CODES.has(code) || /key|access denied|unauthorized/i.test(message);
      return { ok: false, status: keyish ? 'key_restricted' : 'error' };
    }

    const loadout = buildLoadout(res.data);

    // weaponexp is a nice-to-have for "most used"; failure is non-fatal.
    let weaponExp = null;
    try {
      const expRes = await axios.get('https://api.torn.com/v2/user/weaponexp', {
        params: { key: apiKey },
        timeout: 15000
      });
      if (!expRes.data?.error) weaponExp = expRes.data;
    } catch (err) {
      console.warn('[MemberEquipment] weaponexp fetch failed (non-fatal):', err.message);
    }
    loadout.mostUsedWeapon = pickMostUsedWeapon(loadout, weaponExp);

    return { ok: true, loadout };
  } catch (err) {
    console.warn('[MemberEquipment] gear fetch failed:', err.message);
    return { ok: false, status: 'error' };
  }
}

// ─── The daily sweep ──────────────────────────────────────────────────────────

// Pull gear for every member and store it as today's snapshot.
async function takeMemberEquipmentSnapshot(createdBy = 'scheduler', options = {}) {
  const {
    fetchMembers = fetchFactionMembers,
    fetchGear = fetchMemberGear,
    fetchLoans = fetchFactionLoans,
    evaluate = true,
    evaluateGear = defaultEvaluateGear,
    concurrency = MEMBER_FETCH_CONCURRENCY,
    weav3rIntervalMs = WEAV3R_MIN_INTERVAL_MS,
    maxLookups = MAX_WEAV3R_LOOKUPS_PER_RUN
  } = options;

  const members = await fetchMembers();
  const factionIndex = buildFactionOwnedIndex(await fetchLoans());

  // Bounded parallelism — Torn allows ~100 req/min per key.
  const results = new Array(members.length);
  let nextIndex = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, members.length)))
    .fill(null)
    .map(async () => {
      while (nextIndex < members.length) {
        const i = nextIndex++;
        const member = members[i];
        try {
          const gear = await fetchGear(member.apiKey);
          if (gear?.ok && gear.loadout) {
            const w = gear.loadout.weapons || {};
            // Tag against the gear the faction has on loan TO THIS MEMBER, so a
            // member's own copy of an item the faction also owns isn't mislabelled.
            [w.primary, w.secondary, w.melee, w.temporary]
              .forEach(it => tagFactionOwned(it, factionIndex, member.id));
            (gear.loadout.armor || [])
              .forEach(it => tagFactionOwned(it, factionIndex, member.id));
            tagFactionOwned(gear.loadout.mostUsedWeapon, factionIndex, member.id);
          }
          results[i] = buildMemberRow(member, gear);
        } catch (err) {
          console.warn(`[MemberEquipment] ${member?.name || 'member'} failed:`, err.message);
          results[i] = buildMemberRow(member, { ok: false, status: 'error' });
        }
      }
    });
  await Promise.all(workers);

  const rows = results.filter(Boolean);

  if (evaluate) {
    await evaluateRecommendations(rows, { evaluateGear, weav3rIntervalMs, maxLookups });
  }

  const now = new Date();
  const snapshotDate = now.toISOString().slice(0, 10);
  const snapshotId = `equipment_${snapshotDate}`;

  const MemberEquipmentSnapshot = require('../models/MemberEquipmentSnapshot');
  const doc = await MemberEquipmentSnapshot.findOneAndUpdate(
    { snapshotId },
    {
      snapshotId,
      snapshotDate,
      factionId: FACTION_ID,
      members: rows,
      createdBy,
      createdAt: now,
      updatedAt: now
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  const okCount = rows.filter(r => r.status === 'ok').length;
  console.log(`[MemberEquipment] ✅ Snapshot ${snapshotId} — ${okCount}/${rows.length} members with gear`);

  await pruneOldSnapshots(RETENTION_DAYS);

  return {
    success: true,
    snapshotId,
    members: rows.length,
    withGear: okCount
  };
}

// Attach a "cheapest better option" recommendation to each member row.
// weav3r failures are swallowed — a missing recommendation must never fail
// the snapshot.
async function evaluateRecommendations(rows, options = {}) {
  const {
    evaluateGear = defaultEvaluateGear,
    weav3rIntervalMs = WEAV3R_MIN_INTERVAL_MS,
    maxLookups = MAX_WEAV3R_LOOKUPS_PER_RUN
  } = options;

  const pace = createPacer(weav3rIntervalMs);
  let lookups = 0;

  for (const row of rows) {
    if (!row || row.status !== 'ok') continue;

    // Weapon: evaluate the member's most-used weapon (falls back to primary).
    // Faction-loaned weapons are skipped — the faction already owns them, so
    // suggesting an upgrade would be telling the member to buy their own.
    const weapon = row.mostUsedWeapon || row.weapons?.primary;
    const personalWeapon = weapon && !weapon.factionOwned ? weapon : (row.weapons?.primary && !row.weapons.primary.factionOwned ? row.weapons.primary : null);
    if (personalWeapon && lookups < maxLookups) {
      lookups++;
      try {
        await pace();
        const res = await evaluateGear('weapons', {
          name: personalWeapon.name,
          slot: personalWeapon.slot,
          stats: { damage: personalWeapon.damage, accuracy: personalWeapon.accuracy, quality: personalWeapon.quality }
        });
        if (res?.ok) {
          row.recommendations = row.recommendations || {};
          row.recommendations.weapon = buildRecommendation(personalWeapon, res.data?.results, 'weapons');
        }
      } catch (err) {
        console.warn('[MemberEquipment] weapon recommendation failed:', err.message);
      }
    }

    // Armor: evaluate the weakest piece.
    const armor = row.lowestQualityArmor;
    if (armor && lookups < maxLookups) {
      lookups++;
      try {
        await pace();
        const res = await evaluateGear('armor', {
          name: armor.name,
          slot: armor.slot,
          stats: { damage: armor.damage, accuracy: armor.accuracy, quality: armor.quality, armor: armor.armor }
        });
        if (res?.ok) {
          row.recommendations = row.recommendations || {};
          row.recommendations.armor = buildRecommendation(armor, res.data?.results, 'armor');
        }
      } catch (err) {
        console.warn('[MemberEquipment] armor recommendation failed:', err.message);
      }
    }
  }
  return rows;
}

// Re-check a single member's recommendations (reuses the weav3r cache).
async function refreshMemberRecommendation(memberRow, options = {}) {
  const { evaluateGear = defaultEvaluateGear } = options;
  if (!memberRow || memberRow.status !== 'ok') return memberRow;
  const row = {
    ...memberRow,
    weapons: { ...memberRow.weapons },
    recommendations: { ...(memberRow.recommendations || {}) }
  };
  await evaluateRecommendations([row], {
    ...options,
    evaluateGear,
    weav3rIntervalMs: 0,
    maxLookups: 2
  });
  return row;
}

// ─── Retention + purge ────────────────────────────────────────────────────────

// Keep RETENTION_DAYS days of snapshots; drop the rest.
async function pruneOldSnapshots(retentionDays = RETENTION_DAYS) {
  try {
    const MemberEquipmentSnapshot = require('../models/MemberEquipmentSnapshot');
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const result = await MemberEquipmentSnapshot.deleteMany({ snapshotDate: { $lt: cutoff } });
    if (result?.deletedCount) {
      console.log(`[MemberEquipment] Pruned ${result.deletedCount} snapshot(s) older than ${cutoff}`);
    }
    return result?.deletedCount || 0;
  } catch (err) {
    console.warn('[MemberEquipment] prune failed:', err.message);
    return 0;
  }
}

// Remove every stored record for a member (used when a member leaves).
async function purgeMemberEquipment(playerId) {
  if (playerId == null) return 0;
  try {
    const MemberEquipmentSnapshot = require('../models/MemberEquipmentSnapshot');
    const result = await MemberEquipmentSnapshot.updateMany(
      {},
      { $pull: { members: { playerId } } }
    );
    return result?.modifiedCount || 0;
  } catch (err) {
    console.warn('[MemberEquipment] purge failed:', err.message);
    return 0;
  }
}

// Persist a single member's refreshed recommendations back into the latest
// snapshot, so a manual re-check survives a page reload.
async function saveMemberRecommendation(playerId, row) {
  if (playerId == null || !row) return false;
  try {
    const MemberEquipmentSnapshot = require('../models/MemberEquipmentSnapshot');
    const latest = await MemberEquipmentSnapshot.findOne().sort({ snapshotDate: -1 }).select('_id');
    if (!latest?._id) return false;
    const result = await MemberEquipmentSnapshot.updateOne(
      { _id: latest._id, 'members.playerId': playerId },
      { $set: {
        'members.$.recommendations': row.recommendations || {},
        'members.$.recommendationsUpdatedAt': new Date()
      } }
    );
    return !!(result?.modifiedCount);
  } catch (err) {
    console.warn('[MemberEquipment] save recommendation failed:', err.message);
    return false;
  }
}

// The most recent stored snapshot (the Admin tab's data source).
async function getLatestMemberEquipment() {
  const MemberEquipmentSnapshot = require('../models/MemberEquipmentSnapshot');
  return MemberEquipmentSnapshot.findOne().sort({ snapshotDate: -1 }).lean();
}

module.exports = {
  takeMemberEquipmentSnapshot,
  evaluateRecommendations,
  refreshMemberRecommendation,
  pruneOldSnapshots,
  purgeMemberEquipment,
  saveMemberRecommendation,
  getLatestMemberEquipment,
  // Pure helpers exported for unit tests
  normName,
  buildFactionOwnedIndex,
  tagFactionOwned,
  toStoredItem,
  totalArmorRating,
  findLowestQualityArmor,
  buildMemberRow,
  buildRecommendation,
  createPacer,
  fetchMemberGear,
  fetchFactionLoans,
  MEMBER_FETCH_CONCURRENCY,
  WEAV3R_MIN_INTERVAL_MS,
  MAX_WEAV3R_LOOKUPS_PER_RUN,
  RETENTION_DAYS
};
