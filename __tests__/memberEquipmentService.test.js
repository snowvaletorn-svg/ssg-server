// Unit tests for the daily member-equipment sweep (Admin panel's
// "Member Equipment" tab). axios is mocked — no network, no DB.
//
// These cover the pieces that carry real risk:
//   - one member's failure must never abort the sweep
//   - weav3r calls must stay inside the anonymous rate budget
//   - faction-owned gear must be tagged so leadership doesn't recommend
//     buying something the faction already loans out
//   - recommendations must be the CHEAPEST qualifying upgrade

process.env.KEY_ENCRYPTION_KEY = process.env.KEY_ENCRYPTION_KEY || 'ab'.repeat(32);

jest.mock('axios');

jest.mock('../models/MemberEquipmentSnapshot', () => ({
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  deleteMany: jest.fn(),
  updateMany: jest.fn()
}));

jest.mock('../models/User', () => ({ find: jest.fn() }));
jest.mock('../models/FactionConfig', () => ({ findOne: jest.fn() }));

const {
  takeMemberEquipmentSnapshot,
  evaluateRecommendations,
  buildMemberRow,
  buildRecommendation,
  buildFactionOwnedIndex,
  tagFactionOwned,
  toStoredItem,
  totalArmorRating,
  findLowestQualityArmor,
  normName,
  createPacer,
  purgeMemberEquipment,
  saveMemberRecommendation,
  refreshMemberRecommendation,
  MEMBER_FETCH_CONCURRENCY,
  WEAV3R_MIN_INTERVAL_MS,
  MAX_WEAV3R_LOOKUPS_PER_RUN,
  RETENTION_DAYS
} = require('../services/memberEquipmentService');

const MemberEquipmentSnapshot = require('../models/MemberEquipmentSnapshot');

beforeEach(() => {
  jest.clearAllMocks();
  MemberEquipmentSnapshot.findOneAndUpdate.mockResolvedValue({ snapshotId: 'equipment_2026-01-01' });
  MemberEquipmentSnapshot.findOne.mockReturnValue({
    sort: () => ({
      select: () => ({ select: () => ({ lean: async () => null }) }),
      lean: async () => null
    })
  });
  MemberEquipmentSnapshot.deleteMany.mockResolvedValue({ deletedCount: 0 });
  MemberEquipmentSnapshot.updateMany.mockResolvedValue({ modifiedCount: 0 });
  MemberEquipmentSnapshot.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe('pure helpers', () => {
  test('normName strips punctuation and case', () => {
    expect(normName('Assault Body Armor')).toBe('assaultbodyarmor');
    expect(normName('  ARMA-LITE M-15A4 ')).toBe('armalitem15a4');
    expect(normName(null)).toBe('');
  });

  test('buildFactionOwnedIndex keys loans by the member holding them', () => {
    const index = buildFactionOwnedIndex([
      { playerId: 101, name: 'Assault Body' },
      { playerId: 101, name: 'China Lake' },
      { playerId: 202, name: 'Assault Body' }
    ]);
    expect(index.size).toBe(2);
    expect(index.get(101).has('assaultbody')).toBe(true);
    expect(index.get(101).has('chinalake')).toBe(true);
    expect(index.get(202).has('assaultbody')).toBe(true);
    expect(index.get(202).has('chinalake')).toBe(false);
  });

  test('buildFactionOwnedIndex tolerates a non-array', () => {
    expect(buildFactionOwnedIndex(undefined).size).toBe(0);
  });

  test('buildFactionOwnedIndex ignores entries with no player or name', () => {
    const index = buildFactionOwnedIndex([
      { playerId: null, name: 'Assault Body' },
      { playerId: 101, name: null },
      null
    ]);
    expect(index.size).toBe(0);
  });

  test('tagFactionOwned marks gear the faction has on loan to that member', () => {
    const index = buildFactionOwnedIndex([{ playerId: 101, name: 'Assault Body' }]);
    const owned = tagFactionOwned({ name: 'Assault Body' }, index, 101);
    expect(owned.factionOwned).toBe(true);
  });

  test('tagFactionOwned does not mark the same gear for a different member', () => {
    const index = buildFactionOwnedIndex([{ playerId: 101, name: 'Assault Body' }]);
    const own = tagFactionOwned({ name: 'Assault Body' }, index, 202);
    expect(own.factionOwned).toBe(false);
  });

  test('tagFactionOwned leaves unmatched gear untagged', () => {
    const index = buildFactionOwnedIndex([{ playerId: 101, name: 'Assault Body' }]);
    const own = tagFactionOwned({ name: 'Ski Mask' }, index, 101);
    expect(own.factionOwned).toBe(false);
  });


  test('findLowestQualityArmor picks the weakest piece', () => {
    const low = findLowestQualityArmor([
      { name: 'Helmet', quality: 5.29, armor: 46.26 },
      { name: 'Body', quality: 24.44, armor: 47.22 }
    ]);
    expect(low.name).toBe('Helmet');
  });

  test('findLowestQualityArmor breaks ties on lower armor rating', () => {
    const low = findLowestQualityArmor([
      { name: 'A', quality: 10, armor: 50 },
      { name: 'B', quality: 10, armor: 40 }
    ]);
    expect(low.name).toBe('B');
  });

  test('findLowestQualityArmor returns null for an empty list', () => {
    expect(findLowestQualityArmor([])).toBeNull();
  });

  test('findLowestQualityArmor ignores faction-owned pieces', () => {
    const low = findLowestQualityArmor([
      { name: 'Combat Vest', quality: 1, armor: 40, factionOwned: true },
      { name: 'Helmet', quality: 30, armor: 46 }
    ]);
    expect(low.name).toBe('Helmet');
  });

  test('findLowestQualityArmor ignores pieces with no quality roll', () => {
    const low = findLowestQualityArmor([
      { name: 'Combat Pants', quality: null, armor: 40 },
      { name: 'Helmet', quality: 30, armor: 46 }
    ]);
    expect(low.name).toBe('Helmet');
  });

  test('findLowestQualityArmor returns null when everything is faction-owned', () => {
    expect(findLowestQualityArmor([
      { name: 'Combat Vest', quality: 10, armor: 40, factionOwned: true }
    ])).toBeNull();
  });

});

describe('toStoredItem', () => {
  test('flattens a normalized item into the persisted shape', () => {
    const stored = toStoredItem({
      id: 42,
      name: 'Assault Body Armor',
      slot: 'body',
      slotLabel: 'Body',
      rarity: 'Common',
      stats: { quality: 12.5, damage: 5, accuracy: 6, armor: 47.22 },
      bonuses: [{ bonus: 'damage', value: 10 }],
      factionOwned: true
    });
    expect(stored).toEqual({
      id: 42,
      name: 'Assault Body Armor',
      slot: 'body',
      slotLabel: 'Body',
      rarity: 'Common',
      quality: 12.5,
      damage: 5,
      accuracy: 6,
      armor: 47.22,
      bonuses: [{ bonus: 'damage', value: 10 }],
      factionOwned: true
    });
  });

  test('returns null for a missing item', () => {
    expect(toStoredItem(null)).toBeNull();
    expect(toStoredItem(undefined)).toBeNull();
  });

  test('defaults bonuses to an empty array', () => {
    const stored = toStoredItem({ id: 1, name: 'Thing' });
    expect(stored.bonuses).toEqual([]);
    expect(stored.factionOwned).toBe(false);
  });
});

describe('totalArmorRating', () => {
  test('sums the armor ratings', () => {
    expect(totalArmorRating([{ armor: 46.26 }, { armor: 47.22 }, { armor: 6.5 }])).toBeCloseTo(99.98, 2);
  });

  test('treats missing ratings as zero', () => {
    expect(totalArmorRating([{ armor: 10 }, {}])).toBe(10);
  });

  test('returns 0 for an empty or invalid list', () => {
    expect(totalArmorRating([])).toBe(0);
    expect(totalArmorRating(null)).toBe(0);
  });
});

describe('buildMemberRow', () => {
  const member = { id: 777, name: 'Tester', position: 'Leadership' };

  test('records a member with no gear as no_key', () => {
    const row = buildMemberRow(member, { ok: false, status: 'no_key' });
    expect(row.playerId).toBe(777);
    expect(row.playerName).toBe('Tester');
    expect(row.position).toBe('Leadership');
    expect(row.status).toBe('no_key');
    expect(row.weapons.primary).toBeNull();
    expect(row.armor).toEqual([]);
    expect(row.armorRatingTotal).toBe(0);
  });

  test('groups weapons by slot and totals the armor', () => {
    const row = buildMemberRow(member, {
      ok: true,
      loadout: {
        weapons: {
          primary: { id: 1, name: 'Primary Gun', slot: 'primary', stats: { damage: 70, accuracy: 60 } },
          secondary: { id: 2, name: 'Sidearm', slot: 'secondary', stats: { damage: 30, accuracy: 50 } },
          melee: { id: 3, name: 'Axe', slot: 'melee', stats: { damage: 20 } },
          temporary: { id: 4, name: 'Pepper Spray', slot: 'temporary', stats: {} }
        },
        armor: [
          { id: 5, name: 'Body', slot: 'body', stats: { armor: 47.22, quality: 24.4 } },
          { id: 6, name: 'Helmet', slot: 'head', stats: { armor: 46.26, quality: 5.29 } }
        ],
        mostUsedWeapon: { id: 1, name: 'Primary Gun', slot: 'primary', stats: { damage: 70, accuracy: 60 } }
      }
    });

    expect(row.status).toBe('ok');
    expect(row.weapons.primary.name).toBe('Primary Gun');
    expect(row.weapons.secondary.name).toBe('Sidearm');
    expect(row.weapons.melee.name).toBe('Axe');
    expect(row.weapons.temporary.name).toBe('Pepper Spray');
    expect(row.armor).toHaveLength(2);
    expect(row.armorRatingTotal).toBeCloseTo(93.48, 2);
    expect(row.mostUsedWeapon.name).toBe('Primary Gun');
  });

  test('flags the weakest armor piece as the upgrade candidate', () => {
    const row = buildMemberRow(member, {
      ok: true,
      loadout: {
        weapons: {},
        armor: [
          { id: 5, name: 'Body', slot: 'body', stats: { armor: 47.22, quality: 24.4 } },
          { id: 6, name: 'Helmet', slot: 'head', stats: { armor: 46.26, quality: 5.29 } }
        ]
      }
    });
    expect(row.lowestQualityArmor.name).toBe('Helmet');
  });
});

describe('buildRecommendation', () => {
  test('picks the cheapest listing and computes stat deltas', () => {
    const rec = buildRecommendation(
      { name: 'Old Gun', damage: 70, accuracy: 60, quality: 10 },
      [
        { name: 'Cheap Better', damage: 75, accuracy: 62, quality: 11, price: 5000000, source: 'bazaar' },
        { name: 'Expensive Better', damage: 99, accuracy: 88, quality: 20, price: 90000000, source: 'market' }
      ],
      'weapons'
    );
    expect(rec.name).toBe('Cheap Better');
    expect(rec.price).toBe(5000000);
    expect(rec.damageDelta).toBe(5);
    expect(rec.accuracyDelta).toBe(2);
    expect(rec.qualityDelta).toBe(1);
    expect(rec.currentName).toBe('Old Gun');
  });

  test('returns null when there are no listings', () => {
    expect(buildRecommendation({ name: 'Old Gun' }, [], 'weapons')).toBeNull();
    expect(buildRecommendation({ name: 'Old Gun' }, null, 'weapons')).toBeNull();
  });

  test('returns null when there is no current item', () => {
    expect(buildRecommendation(null, [{ name: 'X', price: 1 }], 'weapons')).toBeNull();
  });

  test('nulls out deltas when the stats are not comparable', () => {
    const rec = buildRecommendation(
      { name: 'Old', damage: null, accuracy: 60 },
      [{ name: 'New', damage: 75, accuracy: 62, price: 1 }],
      'weapons'
    );
    expect(rec.damageDelta).toBeNull();
    expect(rec.accuracyDelta).toBe(2);
  });
});

describe('createPacer', () => {
  test('waits between calls to respect the rate budget', async () => {
    const pace = createPacer(20);
    const start = Date.now();
    await pace();
    await pace();
    await pace();
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });
});

describe('evaluateRecommendations', () => {
  const okRow = () => ({
    status: 'ok',
    mostUsedWeapon: { name: 'Primary Gun', slot: 'primary', damage: 70, accuracy: 60, quality: 10 },
    lowestQualityArmor: { name: 'Helmet', slot: 'head', armor: 46.26, quality: 5.29 },
    weapons: { primary: { name: 'Primary Gun' } }
  });

  test('attaches weapon and armor recommendations', async () => {
    const evaluateGear = jest.fn()
      .mockResolvedValueOnce({ ok: true, data: { results: [{ name: 'Better Gun', damage: 80, accuracy: 70, price: 1000 }] } })
      .mockResolvedValueOnce({ ok: true, data: { results: [{ name: 'Better Helmet', armor: 60, quality: 20, price: 2000 }] } });

    const row = okRow();
    await evaluateRecommendations([row], { evaluateGear, weav3rIntervalMs: 0 });

    expect(evaluateGear).toHaveBeenCalledTimes(2);
    expect(row.recommendations.weapon.name).toBe('Better Gun');
    expect(row.recommendations.armor.name).toBe('Better Helmet');
  });

  test('a weav3r failure never breaks the sweep', async () => {
    const evaluateGear = jest.fn().mockRejectedValue(new Error('weav3r down'));
    const row = okRow();
    await expect(evaluateRecommendations([row], { evaluateGear, weav3rIntervalMs: 0 })).resolves.toBeDefined();
    expect(row.recommendations?.weapon).toBeUndefined();
  });

  test('skips members whose gear could not be read', async () => {
    const evaluateGear = jest.fn();
    await evaluateRecommendations([{ status: 'no_key' }, { status: 'error' }], { evaluateGear, weav3rIntervalMs: 0 });
    expect(evaluateGear).not.toHaveBeenCalled();
  });

  test('respects the per-run lookup cap', async () => {
    const evaluateGear = jest.fn().mockResolvedValue({ ok: true, data: { results: [] } });
    const rows = [okRow(), okRow(), okRow()];
    await evaluateRecommendations(rows, { evaluateGear, weav3rIntervalMs: 0, maxLookups: 3 });
    expect(evaluateGear).toHaveBeenCalledTimes(3);
  });

  test('the per-run cap leaves room for two lookups per member', () => {
    // A cap below 2x the member count would silently drop recommendations for
    // the tail of a large faction. Guard that here.
    expect(MAX_WEAV3R_LOOKUPS_PER_RUN).toBeGreaterThanOrEqual(2 * 50);
  });
});

describe('takeMemberEquipmentSnapshot', () => {
  const gearOk = (name) => ({
    ok: true,
    loadout: {
      weapons: { primary: { id: 1, name, slot: 'primary', stats: { damage: 70, accuracy: 60 } } },
      armor: [{ id: 2, name: 'Body', slot: 'body', stats: { armor: 47, quality: 20 } }],
      mostUsedWeapon: { id: 1, name, slot: 'primary', stats: { damage: 70, accuracy: 60 } }
    }
  });

  test('one member failing does not abort the sweep', async () => {
    const fetchMembers = async () => ([
      { id: 1, name: 'Good', apiKey: 'k1' },
      { id: 2, name: 'Bad', apiKey: 'k2' },
      { id: 3, name: 'AlsoGood', apiKey: 'k3' }
    ]);
    const fetchGear = jest.fn(async (key) => {
      if (key === 'k2') throw new Error('boom');
      return gearOk('Gun');
    });

    const result = await takeMemberEquipmentSnapshot('test', {
      fetchMembers,
      fetchGear,
      fetchLoans: async () => [],
      evaluate: false
    });

    expect(result.success).toBe(true);
    expect(result.members).toBe(3);
    const doc = MemberEquipmentSnapshot.findOneAndUpdate.mock.calls[0][1];
    const statuses = doc.members.map(m => m.status).sort();
    expect(statuses).toEqual(['error', 'ok', 'ok']);
  });

  test('tags gear the faction has on loan to that member', async () => {
    const fetchMembers = async () => ([{ id: 1, name: 'Good', apiKey: 'k1' }]);
    const fetchGear = async () => gearOk('Assault Body Armor');

    await takeMemberEquipmentSnapshot('test', {
      fetchMembers,
      fetchGear,
      fetchLoans: async () => [{ playerId: 1, name: 'Assault Body Armor' }],
      evaluate: false
    });

    const doc = MemberEquipmentSnapshot.findOneAndUpdate.mock.calls[0][1];
    expect(doc.members[0].weapons.primary.factionOwned).toBe(true);
  });

  test('does not tag gear the faction owns but has not loaned to that member', async () => {
    const fetchMembers = async () => ([{ id: 1, name: 'Good', apiKey: 'k1' }]);
    const fetchGear = async () => gearOk('Assault Body Armor');

    await takeMemberEquipmentSnapshot('test', {
      fetchMembers,
      fetchGear,
      // The faction owns this item, but it is on loan to somebody else.
      fetchLoans: async () => [{ playerId: 999, name: 'Assault Body Armor' }],
      evaluate: false
    });

    const doc = MemberEquipmentSnapshot.findOneAndUpdate.mock.calls[0][1];
    expect(doc.members[0].weapons.primary.factionOwned).toBe(false);
  });

  test('records a member with no API key as no_key', async () => {
    const fetchMembers = async () => ([{ id: 1, name: 'NoKey', apiKey: null }]);
    const fetchGear = jest.fn(async () => ({ ok: false, status: 'no_key' }));

    await takeMemberEquipmentSnapshot('test', {
      fetchMembers,
      fetchGear,
      fetchLoans: async () => [],
      evaluate: false
    });

    const doc = MemberEquipmentSnapshot.findOneAndUpdate.mock.calls[0][1];
    expect(doc.members[0].status).toBe('no_key');
  });
});

describe('purgeMemberEquipment', () => {
  test('pulls the member from every stored snapshot', async () => {
    const removed = await purgeMemberEquipment(42);
    expect(MemberEquipmentSnapshot.updateMany).toHaveBeenCalled();
    const [filter, update] = MemberEquipmentSnapshot.updateMany.mock.calls[0];
    expect(update.$pull.members.playerId).toBe(42);
    expect(removed).toBe(0);
  });

  test('is a no-op without a player id', async () => {
    await purgeMemberEquipment(null);
    expect(MemberEquipmentSnapshot.updateMany).not.toHaveBeenCalled();
  });
});


describe('refreshMemberRecommendation', () => {
  const row = () => ({
    status: 'ok',
    mostUsedWeapon: { name: 'Primary Gun', slot: 'primary', damage: 70, accuracy: 60, quality: 10 },
    lowestQualityArmor: { name: 'Helmet', slot: 'head', armor: 46.26, quality: 5.29 },
    weapons: { primary: { name: 'Primary Gun' } }
  });

  test('re-checks a single member and returns the updated row', async () => {
    const evaluateGear = jest.fn()
      .mockResolvedValueOnce({ ok: true, data: { results: [{ name: 'Better Gun', damage: 80, accuracy: 70, price: 1000 }] } })
      .mockResolvedValueOnce({ ok: true, data: { results: [{ name: 'Better Helmet', armor: 60, quality: 20, price: 2000 }] } });

    const updated = await refreshMemberRecommendation(row(), { evaluateGear });
    expect(evaluateGear).toHaveBeenCalledTimes(2);
    expect(updated.recommendations.weapon.name).toBe('Better Gun');
    expect(updated.recommendations.armor.name).toBe('Better Helmet');
  });

  test('does not mutate the original row', async () => {
    const evaluateGear = jest.fn().mockResolvedValue({ ok: true, data: { results: [] } });
    const original = row();
    await refreshMemberRecommendation(original, { evaluateGear });
    expect(original.recommendations).toBeUndefined();
  });

  test('skips members whose gear could not be read', async () => {
    const evaluateGear = jest.fn();
    const result = await refreshMemberRecommendation({ status: 'no_key' }, { evaluateGear });
    expect(evaluateGear).not.toHaveBeenCalled();
    expect(result.status).toBe('no_key');
  });
});

describe('saveMemberRecommendation', () => {
  test('writes the recommendation back into the latest snapshot', async () => {
    MemberEquipmentSnapshot.findOne.mockReturnValue({
      sort: () => ({ select: () => ({ _id: 'snap1' }) })
    });

    const saved = await saveMemberRecommendation(42, {
      recommendations: { weapon: { name: 'Better Gun' } }
    });

    expect(saved).toBe(true);
    const [filter, update] = MemberEquipmentSnapshot.updateOne.mock.calls[0];
    expect(filter._id).toBe('snap1');
    expect(filter['members.playerId']).toBe(42);
    expect(update.$set['members.$.recommendations']).toEqual({ weapon: { name: 'Better Gun' } });
  });

  test('is a no-op without a player id', async () => {
    expect(await saveMemberRecommendation(null, { recommendations: {} })).toBe(false);
    expect(MemberEquipmentSnapshot.updateOne).not.toHaveBeenCalled();
  });

  test('returns false when there is no snapshot to update', async () => {
    MemberEquipmentSnapshot.findOne.mockReturnValue({
      sort: () => ({ select: () => null })
    });
    expect(await saveMemberRecommendation(42, { recommendations: {} })).toBe(false);
    expect(MemberEquipmentSnapshot.updateOne).not.toHaveBeenCalled();
  });
});
