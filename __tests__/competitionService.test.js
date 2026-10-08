// Unit tests for the competition service (stat catalog + battle-stat gating).
// Pure logic — no MongoDB, no network.
const {
  BATTLE_STAT_KEYS,
  isBattleStat,
  humaniseKey,
  categoriseStatKey,
  buildStatCatalog,
  filterRequestedStats,
  memberValuesFor
} = require('../services/competitionService');

describe('battle-stat gating', () => {
  test('BATTLE_STAT_KEYS contains the sensitive stats', () => {
    ['strength', 'defense', 'speed', 'dexterity', 'totalstats',
     'manuallabor', 'intelligence', 'endurance', 'baserating'].forEach(k => {
      expect(BATTLE_STAT_KEYS).toContain(k);
      expect(isBattleStat(k)).toBe(true);
    });
  });

  test('non-sensitive stats are not battle stats', () => {
    ['attackswon', 'networth', 'useractivity', 'raceswon'].forEach(k => {
      expect(isBattleStat(k)).toBe(false);
    });
  });

  test('buildStatCatalog excludes battle stats for non-admins', () => {
    const catalog = buildStatCatalog({ isAdmin: false });
    BATTLE_STAT_KEYS.forEach(k => expect(catalog[k]).toBeUndefined());
    expect(catalog.attackswon).toBeDefined();
  });

  test('buildStatCatalog includes battle stats for admins', () => {
    const catalog = buildStatCatalog({ isAdmin: true });
    BATTLE_STAT_KEYS.forEach(k => expect(catalog[k]).toBeDefined());
    expect(catalog.strength.category).toBe('battle');
  });

  test('filterRequestedStats rejects battle stats for non-admin catalog', () => {
    const catalog = buildStatCatalog({ isAdmin: false });
    const { allowed, rejected } = filterRequestedStats(
      ['attackswon', 'strength', 'networth', 'notarealstat'],
      catalog
    );
    expect(allowed).toEqual(['attackswon', 'networth']);
    expect(rejected).toContain('strength');
    expect(rejected).toContain('notarealstat');
  });

  test('filterRequestedStats allows battle stats for admin catalog', () => {
    const catalog = buildStatCatalog({ isAdmin: true });
    const { allowed, rejected } = filterRequestedStats(['strength', 'attackswon'], catalog);
    expect(allowed).toEqual(['strength', 'attackswon']);
    expect(rejected).toEqual([]);
  });
});

describe('catalog construction', () => {
  test('restricts to snapshot keys when provided', () => {
    const catalog = buildStatCatalog({
      isAdmin: false,
      snapshotKeys: ['attackswon', 'networth', 'strength']
    });
    // strength is battle -> excluded for non-admin even though present in snapshot
    expect(Object.keys(catalog).sort()).toEqual(['attackswon', 'networth']);
  });

  test('labels fall back to humanised keys', () => {
    expect(humaniseKey('attackswon')).toBe('Attackswon');
    const catalog = buildStatCatalog({ isAdmin: false, snapshotKeys: ['somebrandnewstat'] });
    expect(catalog.somebrandnewstat.label).toBe('Somebrandnewstat');
    expect(catalog.somebrandnewstat.category).toBe('misc');
  });

  test('known stats get friendly labels and categories', () => {
    const catalog = buildStatCatalog({ isAdmin: true });
    expect(catalog.attackswon.label).toBe('Attacks Won');
    expect(catalog.attackswon.category).toBe('attack');
    expect(catalog.networth.category).toBe('networth');
    expect(catalog.raceswon.category).toBe('racing');
  });

  test('categoriseStatKey places battle keys in battle group', () => {
    expect(categoriseStatKey('strength')).toBe('battle');
    expect(categoriseStatKey('totalstats')).toBe('battle');
  });
});

describe('memberValuesFor', () => {
  const member = {
    playerId: 1,
    playerName: 'Alice',
    totalStats: 12345,
    personalstats: { attackswon: 42, networth: 999, totalstats: 12345 }
  };

  test('reads values from personalstats', () => {
    const values = memberValuesFor(member, ['attackswon', 'networth']);
    expect(values).toEqual({ attackswon: 42, networth: 999 });
  });

  test('missing stats default to 0', () => {
    const values = memberValuesFor(member, ['raceswon']);
    expect(values).toEqual({ raceswon: 0 });
  });

  test('legacy row without personalstats falls back to totalStats', () => {
    const legacy = { playerId: 2, playerName: 'Bob', totalStats: 777, timestamp: new Date() };
    const values = memberValuesFor(legacy, ['totalstats', 'attackswon']);
    expect(values.totalstats).toBe(777);
    expect(values.attackswon).toBe(0);
  });
});
