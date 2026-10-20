// Unit tests for the equipment service (Profile "Equipped Gear" card + the
// weav3r ranked-gear evaluation). axios is mocked — no network.
process.env.KEY_ENCRYPTION_KEY = process.env.KEY_ENCRYPTION_KEY || 'ab'.repeat(32);

jest.mock('axios');

const axios = require('axios');
const {
  getEquipmentLoadout,
  evaluateGear,
  buildLoadout,
  normalizeEquipmentItem,
  pickMostUsedWeapon,
  buildWeaponEvalParams,
  buildArmorEvalParams,
  normalizeRankedRows,
  clearCaches
} = require('../services/equipmentService');

// Live-shaped Torn v2/user/equipment payload: primary, secondary, melee,
// temporary weapons plus a body/head armor pair.
function equipmentPayload() {
  return {
    equipment: [
      { id: 399, name: 'ArmaLite M-15A4', type: 'Weapon', sub_type: 'Rifle', slot: 1,
        stats: { damage: 74.35, accuracy: 61.27, armor: null, quality: 106.22 },
        bonuses: [{ id: 46, title: 'Weaken', description: '23% weaken', value: 23 }],
        rarity: 'yellow', ammo: { id: 5, name: '5.56mm', quantity: 1326 },
        mods: [{ id: 23, name: 'Adjustable Trigger' }] },
      { id: 1153, name: 'China Lake', type: 'Weapon', sub_type: 'Heavy artillery', slot: 2,
        stats: { damage: 82.4, accuracy: 48.1, armor: null, quality: 125 },
        bonuses: [{ id: 81, title: 'Warlord', description: '15% respect', value: 15 }],
        rarity: 'yellow', ammo: null, mods: [] },
      { id: 101, name: 'Axe', type: 'Weapon', sub_type: 'Clubbing', slot: 3,
        stats: { damage: 40.51, accuracy: 56.29, armor: null, quality: 107.92 },
        bonuses: [], rarity: 'yellow', ammo: null, mods: [] },
      { id: 392, name: 'Pepper Spray', type: 'Weapon', sub_type: 'Temporary', slot: 5,
        stats: null, bonuses: [], rarity: null, ammo: null, mods: [] },
      { id: 666, name: 'Assault Body', type: 'Armor', slot: 4,
        stats: { damage: null, accuracy: null, armor: 47.22, quality: 24.44 },
        bonuses: [{ id: 17, title: 'Impenetrable', description: '22% reduction', value: 22 }],
        rarity: 'yellow', ammo: null, mods: [] },
      { id: 665, name: 'Assault Helmet', type: 'Armor', slot: 6,
        stats: { damage: null, accuracy: null, armor: 46.26, quality: 5.29 },
        bonuses: [], rarity: 'yellow', ammo: null, mods: [] }
    ]
  };
}

// Live-shaped weav3r ranked-weapons row (stats arrive as strings, bonuses keyed).
function rankedPayload() {
  return {
    total_count: 661,
    weapons: [
      { uid: '183', itemId: 398, itemName: 'SIG 552', weaponType: 'Primary', rarity: 'yellow',
        damage: '76.8', accuracy: '53.35', quality: '111.51',
        bonuses: { 0: { bonus: 'Focus', value: 15, description: '15% hit per miss' } },
        price: 69000000, marketPrice: 69000000, playerName: null, quantity: 1,
        source: 'market', itemImage: 'https://www.torn.com/images/items/398/large.png',
        lastUpdated: '2026-10-20T01:04:02Z' },
      { uid: '184', itemId: 397, itemName: 'AK-47', weaponType: 'Primary', rarity: 'yellow',
        damage: '80.1', accuracy: '50.0', quality: '120.0',
        bonuses: { 0: { bonus: 'Piercing', value: 10, description: '10% pierce' },
                   1: { bonus: 'Focus', value: 12, description: '12% hit per miss' } },
        price: 120000000, marketPrice: 118000000, playerName: 'Seller', quantity: 1,
        source: 'bazaar', itemImage: '', lastUpdated: '2026-10-20T01:04:02Z' }
    ]
  };
}

beforeEach(() => {
  clearCaches();
  jest.clearAllMocks();
});

describe('equipmentService.buildLoadout', () => {
  test('groups weapons by slot and collects armor in slot order', () => {
    const l = buildLoadout(equipmentPayload());
    expect(l.weapons.primary.name).toBe('ArmaLite M-15A4');
    expect(l.weapons.secondary.name).toBe('China Lake');
    expect(l.weapons.melee.name).toBe('Axe');
    expect(l.weapons.temporary.name).toBe('Pepper Spray');
    expect(l.armor.map(a => a.name)).toEqual(['Assault Body', 'Assault Helmet']);
  });

  test('normalizes stats, bonuses, ammo and mods onto each item', () => {
    const l = buildLoadout(equipmentPayload());
    const p = l.weapons.primary;
    expect(p.stats.damage).toBe(74.35);
    expect(p.stats.accuracy).toBe(61.27);
    expect(p.stats.armor).toBeNull();
    expect(p.bonuses).toEqual([{ title: 'Weaken', value: 23, description: '23% weaken' }]);
    expect(p.ammo).toEqual({ name: '5.56mm', quantity: 1326 });
    expect(p.mods).toEqual(['Adjustable Trigger']);
    expect(p.slotLabel).toBe('Primary');
  });

  test('handles a temporary weapon with null stats safely', () => {
    const l = buildLoadout(equipmentPayload());
    expect(l.weapons.temporary.stats.damage).toBeNull();
    expect(l.weapons.temporary.stats.quality).toBeNull();
    expect(l.weapons.temporary.rarity).toBeNull();
  });

  test('tolerates missing/empty payloads', () => {
    expect(buildLoadout(null).weapons.primary).toBeNull();
    expect(buildLoadout({}).armor).toEqual([]);
    expect(buildLoadout({ equipment: [] }).weapons.melee).toBeNull();
  });
});

describe('equipmentService.normalizeEquipmentItem', () => {
  test('returns null for junk input', () => {
    expect(normalizeEquipmentItem(null)).toBeNull();
    expect(normalizeEquipmentItem('nope')).toBeNull();
  });

  test('maps unknown slots to a Slot N label', () => {
    const item = normalizeEquipmentItem({ id: 1, name: 'X', type: 'Armor', slot: 12, stats: null, bonuses: [], mods: [] });
    expect(item.slotLabel).toBe('Slot 12');
  });
});

describe('equipmentService.pickMostUsedWeapon', () => {
  const loadout = buildLoadout(equipmentPayload());

  test('picks the equipped weapon with the highest experience', () => {
    const exp = { weaponexp: [
      { exp: 1200, name: 'Axe' },
      { exp: 5000, name: 'China Lake' },
      { exp: 900, name: 'ArmaLite M-15A4' },
      { exp: 99999, name: 'Not Equipped' }
    ] };
    expect(pickMostUsedWeapon(loadout, exp).name).toBe('China Lake');
  });

  test('falls back to primary when weaponexp is empty or missing', () => {
    expect(pickMostUsedWeapon(loadout, { weaponexp: [] }).name).toBe('ArmaLite M-15A4');
    expect(pickMostUsedWeapon(loadout, null).name).toBe('ArmaLite M-15A4');
  });

  test('falls back primary → secondary when primary is unequipped', () => {
    const noPrimary = { weapons: { primary: null, secondary: loadout.weapons.secondary, melee: null, temporary: null }, armor: [], other: [] };
    expect(pickMostUsedWeapon(noPrimary, null).name).toBe('China Lake');
  });

  test('returns null with an empty loadout', () => {
    expect(pickMostUsedWeapon({ weapons: { primary: null, secondary: null, melee: null, temporary: null }, armor: [], other: [] }, null)).toBeNull();
  });
});

describe('equipmentService eval query builders', () => {
  const loadout = buildLoadout(equipmentPayload());

  test('weapon eval: same slot class, strictly better damage AND accuracy, cheapest first', () => {
    const params = buildWeaponEvalParams(loadout.weapons.primary);
    expect(params).toEqual({
      tab: 'weapons', weaponType: 'primary',
      sortField: 'price', sortDirection: 'asc', limit: 25,
      minDamage: 75,   // floor(74.35) + 1
      minAccuracy: 62  // floor(61.27) + 1
    });
  });

  test('weapon eval: omits minAccuracy when accuracy is unknown', () => {
    const params = buildWeaponEvalParams({ slot: 1, stats: { damage: 50, accuracy: null } });
    expect(params.minDamage).toBe(51);
    expect(params.minAccuracy).toBeUndefined();
  });

  test('weapon eval: omits minDamage when damage is unknown', () => {
    const params = buildWeaponEvalParams({ slot: 1, stats: { damage: null, accuracy: 40 } });
    expect(params.minDamage).toBeUndefined();
    expect(params.minAccuracy).toBe(41);
  });

  test('weapon eval: secondary weapon uses its own stats for both floors', () => {
    const params = buildWeaponEvalParams(loadout.weapons.secondary);
    expect(params.weaponType).toBe('secondary');
    expect(params.minDamage).toBe(83);   // floor(82.4) + 1
    expect(params.minAccuracy).toBe(49); // floor(48.1) + 1
  });

  test('weapon eval: melee slot maps to melee weaponType', () => {
    expect(buildWeaponEvalParams(loadout.weapons.melee).weaponType).toBe('melee');
  });

  test('weapon eval: temporary/unknown slots cannot be evaluated', () => {
    expect(buildWeaponEvalParams(loadout.weapons.temporary)).toBeNull();
  });

  test('armor eval: same piece, quality floor, cheapest first', () => {
    const params = buildArmorEvalParams(loadout.armor[0]);
    expect(params).toEqual({
      tab: 'armor', armorPiece: 'Assault Body',
      sortField: 'price', sortDirection: 'asc', limit: 25,
      minQuality: 24.44
    });
  });

  test('armor eval: omits minQuality when quality unknown', () => {
    const params = buildArmorEvalParams({ name: 'Mystery Vest', stats: { quality: null } });
    expect(params.minQuality).toBeUndefined();
    expect(params.armorPiece).toBe('Mystery Vest');
  });

  test('armor eval: rejects items without a name', () => {
    expect(buildArmorEvalParams({ name: '', stats: {} })).toBeNull();
  });
});

describe('equipmentService.normalizeRankedRows', () => {
  test('parses string stats to numbers and bonus objects to an array', () => {
    const rows = normalizeRankedRows(rankedPayload());
    expect(rows).toHaveLength(2);
    expect(rows[0].damage).toBe(76.8);
    expect(rows[0].accuracy).toBe(53.35);
    expect(rows[0].quality).toBe(111.51);
    expect(rows[0].price).toBe(69000000);
    expect(rows[0].bonuses).toEqual([{ bonus: 'Focus', value: 15, description: '15% hit per miss' }]);
    expect(rows[1].bonuses).toHaveLength(2);
    expect(rows[1].seller).toBe('Seller');
    expect(rows[0].seller).toBeNull();
  });

  test('handles null stats (armor rows) and missing bonuses', () => {
    const rows = normalizeRankedRows({ weapons: [{ itemName: 'Vest', damage: null, accuracy: null, quality: '6.51', price: 100 }] });
    expect(rows[0].damage).toBeNull();
    expect(rows[0].quality).toBe(6.51);
    expect(rows[0].bonuses).toEqual([]);
  });

  test('tolerates empty payloads', () => {
    expect(normalizeRankedRows(null)).toEqual([]);
    expect(normalizeRankedRows({})).toEqual([]);
  });
});

describe('equipmentService.getEquipmentLoadout (network)', () => {
  test('fetches equipment + weaponexp and flags the most-used weapon', async () => {
    axios.get.mockResolvedValueOnce({ data: equipmentPayload() });
    axios.get.mockResolvedValueOnce({ data: { weaponexp: [{ exp: 5000, name: 'China Lake' }] } });
    const res = await getEquipmentLoadout('KEY123');
    expect(res.ok).toBe(true);
    expect(res.data.mostUsedWeapon.name).toBe('China Lake');
    expect(res.data.weapons.primary.name).toBe('ArmaLite M-15A4');
    expect(res.data.rankedPageUrl).toContain('weav3r.dev');
    expect(axios.get.mock.calls[0][0]).toBe('https://api.torn.com/v2/user/equipment');
    expect(axios.get.mock.calls[0][1].params.key).toBe('KEY123');
  });

  test('still succeeds when weaponexp fails (non-fatal)', async () => {
    axios.get.mockResolvedValueOnce({ data: equipmentPayload() });
    axios.get.mockRejectedValueOnce(new Error('timeout'));
    const res = await getEquipmentLoadout('KEY123');
    expect(res.ok).toBe(true);
    expect(res.data.mostUsedWeapon.name).toBe('ArmaLite M-15A4'); // primary fallback
  });

  test('surfaces Torn API errors', async () => {
    axios.get.mockResolvedValueOnce({ data: { error: { code: 2, error: 'Incorrect key' } } });
    const res = await getEquipmentLoadout('bad');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Incorrect key');
  });

  test('rejects an empty key without calling the API', async () => {
    const res = await getEquipmentLoadout('  ');
    expect(res.ok).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('equipmentService.evaluateGear (network)', () => {
  const loadout = buildLoadout(equipmentPayload());

  test('queries weav3r and normalizes results', async () => {
    axios.get.mockResolvedValueOnce({ data: rankedPayload() });
    const res = await evaluateGear('weapons', loadout.weapons.primary);
    expect(res.ok).toBe(true);
    expect(res.data.totalCount).toBe(661);
    expect(res.data.results).toHaveLength(2);
    expect(res.data.results[0].name).toBe('SIG 552');

    const [url, config] = axios.get.mock.calls[0];
    expect(url).toBe('https://weav3r.dev/api/ranked-weapons');
    expect(config.params.tab).toBe('weapons');
    expect(config.params.weaponType).toBe('primary');
    expect(config.params.minDamage).toBe(75);
    expect(config.params.sortField).toBe('price');
    expect(config.params.sortDirection).toBe('asc');
  });

  test('caches identical evaluations (single weav3r call)', async () => {
    axios.get.mockResolvedValue({ data: rankedPayload() });
    await evaluateGear('weapons', loadout.weapons.primary);
    await evaluateGear('weapons', loadout.weapons.primary);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('armor tab builds the armorPiece query', async () => {
    axios.get.mockResolvedValueOnce({ data: { total_count: 8, weapons: [] } });
    const res = await evaluateGear('armor', loadout.armor[0]);
    expect(res.ok).toBe(true);
    expect(axios.get.mock.calls[0][1].params.armorPiece).toBe('Assault Body');
    expect(axios.get.mock.calls[0][1].params.minQuality).toBe(24.44);
  });

  test('400 from weav3r returns a friendly error', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 400 } });
    const res = await evaluateGear('weapons', loadout.weapons.primary);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not match/i);
  });

  test('network failure returns a fallback error mentioning weav3r', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    const res = await evaluateGear('weapons', loadout.weapons.primary);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/weav3r\.dev/);
  });

  test('rejects unevaluable items and missing items', async () => {
    const temp = await evaluateGear('weapons', loadout.weapons.temporary);
    expect(temp.ok).toBe(false);
    const none = await evaluateGear('weapons', null);
    expect(none.ok).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
