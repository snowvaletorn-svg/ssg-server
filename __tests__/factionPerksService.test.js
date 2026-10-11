const axios = require('axios');

const { fetchFactionPerks, normalizePerks, clearCache } = require('../services/factionPerksService');

const axiosGet = jest.spyOn(axios, 'get');

// Shape matches the real v2/faction/upgrades response (captured from SSG).
function makePayload(overrides = {}) {
  return {
    state: 'peace',
    ...overrides,
    upgrades: {
      core: {
        upgrades: [
          { id: 1, name: 'Weapon armory', ability: 'Unlocks weapon armory', level: 1, cost: 1000, unlocked_at: 1738363393 },
          { id: 2, name: 'Armor armory', ability: 'Unlocks armor armory', level: 1, cost: 1412, unlocked_at: 1738363441 }
        ]
      },
      peace: [
        {
          name: 'Excursion',
          order: 2,
          multiplier: 2,
          upgrades: [
            { id: 33, name: 'Travel capacity IV', ability: 'Increases maximum traveling capacity by 4', level: 4, cost: 2451, unlocked_at: 1787566451 }
          ]
        },
        {
          name: 'Steadfast',
          order: 1,
          multiplier: 1,
          upgrades: [
            { id: 38, name: 'Defense training VI', ability: 'Increases defense gym gains by 6%', level: 6, cost: 2451, unlocked_at: 1788231381 }
          ]
        }
      ],
      war: [
        {
          name: 'Suppression',
          order: 1,
          multiplier: 1,
          upgrades: [
            { id: 50, name: 'Chain count III', ability: 'Increases chain length', level: 3, cost: 900, unlocked_at: 1780000000 }
          ]
        }
      ],
      ...overrides
    }
  };
}

beforeEach(() => {
  axiosGet.mockReset();
  clearCache();
});

describe('normalizePerks', () => {
  test('builds Core first, then branches sorted by Torn order', () => {
    const perks = normalizePerks(makePayload());

    expect(perks.state).toBe('peace');
    expect(perks.stateLabel).toBe('Peace');
    expect(perks.cards.map(c => c.name)).toEqual(['Core', 'Steadfast', 'Excursion']);
    expect(perks.cards[0].upgrades).toHaveLength(2);
    expect(perks.cards[2].upgrades[0]).toEqual({
      name: 'Travel capacity IV',
      ability: 'Increases maximum traveling capacity by 4',
      level: 4
    });
  });

  test('war state uses the war branches', () => {
    const perks = normalizePerks(makePayload({ state: 'war' }));

    expect(perks.state).toBe('war');
    expect(perks.stateLabel).toBe('War');
    expect(perks.cards.map(c => c.name)).toEqual(['Core', 'Suppression']);
  });

  test('drops locked upgrades (level 0, no unlock timestamp)', () => {
    const payload = makePayload();
    payload.upgrades.peace[0].upgrades.push({
      id: 34, name: 'Locked perk', ability: 'Not bought yet', level: 0, cost: 500, unlocked_at: null
    });

    const perks = normalizePerks(payload);
    const excursion = perks.cards.find(c => c.name === 'Excursion');

    expect(excursion.upgrades.map(u => u.name)).toEqual(['Travel capacity IV']);
  });

  test('skips empty branches but keeps the rest', () => {
    const payload = makePayload();
    payload.upgrades.peace.push({ name: 'Voracity', order: 3, multiplier: 1, upgrades: [] });

    const perks = normalizePerks(payload);
    expect(perks.cards.map(c => c.name)).toEqual(['Core', 'Steadfast', 'Excursion']);
  });

  test('returns null for API errors, missing payloads, or nothing unlocked', () => {
    expect(normalizePerks(null)).toBeNull();
    expect(normalizePerks({ error: { code: 16, error: 'Access level of this key is not high enough' } })).toBeNull();
    expect(normalizePerks({ state: 'peace' })).toBeNull();
    expect(normalizePerks({ state: 'peace', upgrades: {} })).toBeNull();
  });

  test('never throws on malformed branch entries', () => {
    const payload = {
      state: 'peace',
      upgrades: {
        core: null,
        peace: [null, { name: 'Broken', order: 1 }, { name: 'Fine', order: 2, upgrades: [{ name: 'Ok', ability: 'x', level: 1 }] }]
      }
    };
    const perks = normalizePerks(payload);
    expect(perks.cards.map(c => c.name)).toEqual(['Fine']);
  });
});

describe('fetchFactionPerks', () => {
  test('fetches, normalizes and caches the result', async () => {
    axiosGet.mockResolvedValue({ data: makePayload() });

    const first = await fetchFactionPerks('test-key');
    const second = await fetchFactionPerks('test-key');

    expect(first.cards.map(c => c.name)).toEqual(['Core', 'Steadfast', 'Excursion']);
    expect(second).toBe(first);
    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(axiosGet).toHaveBeenCalledWith(
      'https://api.torn.com/v2/faction/upgrades',
      expect.objectContaining({ params: { key: 'test-key' }, timeout: 10000 })
    );
  });

  test('returns null and caches the failure when the API errors', async () => {
    axiosGet.mockRejectedValue(new Error('timeout of 10000ms exceeded'));

    const first = await fetchFactionPerks('test-key');
    const second = await fetchFactionPerks('test-key');

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });
});
