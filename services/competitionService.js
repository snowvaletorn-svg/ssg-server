// ─── Competition service ───────────────────────────────────────────────────────
// Pure logic for the faction competition page: builds the stat catalog from a
// snapshot's stored personalstats, and enforces the battle-stat gate.
//
// Battle stats (strength/defense/speed/dexterity + derived totals and work
// stats) are only ever exposed to admins (ownership/leadership — the same group
// that can open the Admin area). They are excluded from the catalog and stripped
// from every response for non-admin callers.

// The sensitive stat keys. Anything not in this list is safe for all members.
const BATTLE_STAT_KEYS = [
  'strength', 'defense', 'speed', 'dexterity', 'totalstats',
  'manuallabor', 'intelligence', 'endurance', 'baserating'
];

// Friendly labels for the stats we surface. Keys not listed here fall back to
// a humanised version of the key (e.g. 'attackswon' -> 'Attackswon').
const STAT_LABELS = {
  // Battle (admin-only)
  strength: 'Strength',
  defense: 'Defense',
  speed: 'Speed',
  dexterity: 'Dexterity',
  totalstats: 'Total Battle Stats',
  manuallabor: 'Manual Labor',
  intelligence: 'Intelligence',
  endurance: 'Endurance',
  baserating: 'Base Rating',
  // Attack
  attackswon: 'Attacks Won',
  attackslost: 'Attacks Lost',
  attacksdraw: 'Attacks Drawn',
  attacksassisted: 'Attacks Assisted',
  attackhits: 'Attack Hits',
  attackmisses: 'Attack Misses',
  attackdamage: 'Attack Damage',
  attackcriticalhits: 'Attack Critical Hits',
  bestdamage: 'Best Damage',
  onehitkills: 'One Hit Kills',
  killstreak: 'Current Killstreak',
  bestkillstreak: 'Best Killstreak',
  highestbeaten: 'Highest Beaten',
  unarmoredwon: 'Unarmored Wins',
  yourunaway: 'Times You Ran Away',
  theyrunaway: 'Times They Ran Away',
  // Defense / record
  defendswon: 'Defends Won',
  defendslost: 'Defends Lost',
  defendsstalemated: 'Defends Stalemated',
  elo: 'ELO'
};

function isBattleStat(key) {
  return BATTLE_STAT_KEYS.includes(key);
}

// Turn a raw key like 'attackswon' into a readable label when none is defined.
function humaniseKey(key) {
  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Categories used to group the picker UI. A stat not claimed by any category
// lands in 'misc'.
function categoriseStatKey(key) {
  if (BATTLE_STAT_KEYS.includes(key)) return 'battle';
  if (key.startsWith('attack') || key.startsWith('defend') || key.includes('kill') ||
      ['elo', 'unarmoredwon', 'yourunaway', 'theyrunaway', 'highestbeaten', 'bestdamage'].includes(key)) return 'attack';
  if (key.includes('travel')) return 'travel';
  if (key.startsWith('networth')) return 'networth';
  if (['racesentered', 'raceswon', 'racingpointsearned', 'racingskill'].includes(key)) return 'racing';
  if (['arrestsmade', 'peoplebusted', 'failedbusts', 'peoplebought', 'peopleboughtspent',
       'largestmug', 'moneymugged', 'extortion', 'theft', 'burglaryskill', 'counterfeiting',
       'fraud', 'criminaloffenses', 'organisedcrimes', 'dumpfinds', 'cityfinds', 'dumpsearches',
       'searchforcashskill'].includes(key)) return 'crimes';
  if (['useractivity', 'activestreak', 'bestactivestreak', 'hospital', 'jailed', 'rehabs',
       'rehabcost', 'respectforfaction', 'daysbeendonator', 'awards', 'meritsbought'].includes(key)) return 'activity';
  return 'misc';
}

const CATEGORY_LABELS = {
  battle: '⚔ Battle Stats (Admin)',
  attack: '🗡 Attack & Defense',
  travel: '✈ Travel',
  networth: '💰 Networth',
  racing: '🏁 Racing',
  crimes: '🔨 Crimes',
  activity: '📅 Activity & Record',
  misc: '📊 Other'
};

// Fallback catalog keys when no snapshot keys are supplied (e.g. tests or a
// snapshot without personalstats). In practice the routes pass snapshotKeys so
// the catalog only ever contains stats we actually have data for.
const DEFAULT_CATALOG_KEYS = Object.keys(STAT_LABELS).concat([
  'networth', 'networthwallet', 'networthvault', 'networthbank', 'networthbazaar',
  'raceswon', 'racesentered', 'racingpointsearned', 'racingskill',
  'moneymugged', 'largestmug', 'criminaloffenses', 'organisedcrimes',
  'respectforfaction', 'daysbeendonator', 'awards', 'hospital', 'jailed',
  'useractivity', 'activestreak', 'bestactivestreak', 'itemsbought', 'trades'
]);

// Build the visible stat catalog for a caller.
//  - isAdmin=true  -> battle stats included (grouped under 'battle')
//  - isAdmin=false -> battle stats excluded entirely
// `snapshotKeys` (optional) restricts the catalog to keys actually present in
// the snapshot, so the UI never offers a stat we have no data for.
function buildStatCatalog({ isAdmin = false, snapshotKeys = null } = {}) {
  const keys = snapshotKeys && snapshotKeys.length
    ? snapshotKeys
    : DEFAULT_CATALOG_KEYS;

  const catalog = {};
  for (const key of keys) {
    if (isBattleStat(key) && !isAdmin) continue;
    catalog[key] = {
      label: STAT_LABELS[key] || humaniseKey(key),
      category: categoriseStatKey(key)
    };
  }
  return catalog;
}

// Validate requested stat keys against the caller's visible catalog.
// Returns { allowed, rejected } — rejected covers battle stats a non-admin
// asked for, plus any unknown keys.
function filterRequestedStats(requestedKeys, catalog) {
  const allowed = [];
  const rejected = [];
  for (const key of requestedKeys) {
    if (Object.prototype.hasOwnProperty.call(catalog, key)) allowed.push(key);
    else rejected.push(key);
  }
  return { allowed, rejected };
}

// Flatten a member's stored snapshot row into { statKey: value } for the
// requested keys. Falls back to totalStats for legacy rows without personalstats.
function memberValuesFor(member, statKeys) {
  const ps = member.personalstats || {};
  const values = {};
  for (const key of statKeys) {
    if (key === 'totalstats' && ps.totalstats == null && member.totalStats != null) {
      values[key] = member.totalStats;
    } else {
      values[key] = typeof ps[key] === 'number' ? ps[key] : 0;
    }
  }
  return values;
}

module.exports = {
  BATTLE_STAT_KEYS,
  STAT_LABELS,
  CATEGORY_LABELS,
  isBattleStat,
  humaniseKey,
  categoriseStatKey,
  buildStatCatalog,
  filterRequestedStats,
  memberValuesFor
};
