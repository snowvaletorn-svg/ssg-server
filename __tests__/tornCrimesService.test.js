// Unit tests for the OC (organised crimes) service.
// Pure logic (transform + enrichment helpers) — no MongoDB, no network.
const {
  transformCrimeData,
  buildItemNameMap,
  resolveToolNames,
  resolveToolNamesForStorage,
  indexDefinitionsByName,
  applyDefinition
} = require('../services/tornCrimesService');

// Sample based on a real v2 faction/crimes API response (see crime_sample.json)
function sampleCrime(overrides = {}) {
  return {
    id: 1487585,
    previous_crime_id: null,
    name: 'Best of the Lot',
    difficulty: 2,
    status: 'Recruiting',
    created_at: 1775389539,
    planning_at: 1775421619,
    executed_at: null,
    ready_at: Math.floor(Date.now() / 1000) + 3600, // 1h from now (deterministic timeLeft)
    expired_at: Math.floor(Date.now() / 1000) + 86400,
    slots: [
      {
        position: 'Picklock',
        position_number: 1,
        item_requirement: { id: 1203, is_reusable: true, is_available: false },
        user: null,
        checkpoint_pass_rate: 91
      },
      {
        position: 'Car Thief',
        position_number: 1,
        item_requirement: null,
        user: { id: 2146080, joined_at: 1775423267, progress: 0 },
        checkpoint_pass_rate: 75
      },
      {
        position: 'Muscle',
        position_number: 1,
        item_requirement: null,
        user: { id: 3679686, joined_at: 1775421619, progress: 4.63 },
        checkpoint_pass_rate: 82
      },
      {
        position: 'Imitator',
        position_number: 1,
        item_requirement: { id: 1350, is_reusable: true, is_available: true },
        user: null,
        checkpoint_pass_rate: 90
      }
    ],
    rewards: null,
    ...overrides
  };
}

describe('transformCrimeData', () => {
  test('creates participants only for filled slots', () => {
    const result = transformCrimeData(sampleCrime());
    expect(result.crimeId).toBe(1487585);
    expect(result.crimeName).toBe('Best of the Lot');
    expect(result.participants).toHaveLength(2);
    expect(result.participants.map(p => p.playerId)).toEqual([2146080, 3679686]);
    expect(result.isComplete).toBe(false);
    expect(result.status).toBe('pending');
  });

  test('captures item requirements from filled slots', () => {
    const crime = sampleCrime();
    // Give the Muscle slot an item requirement + availability
    crime.slots[2].item_requirement = { id: 484, is_reusable: false, is_available: true };
    const result = transformCrimeData(crime);
    const muscle = result.participants.find(p => p.playerId === 3679686);
    expect(muscle.toolId).toBe(484);
    expect(muscle.toolAvailable).toBe(true);
    const carThief = result.participants.find(p => p.playerId === 2146080);
    expect(carThief.toolId).toBeNull();
    expect(carThief.toolAvailable).toBeNull();
  });

  test('maps checkpoint pass rates, including a 0 rate as failed', () => {
    const crime = sampleCrime();
    crime.slots[1].checkpoint_pass_rate = 0; // Car Thief fails hard
    crime.slots[2].checkpoint_pass_rate = 49; // Muscle just misses
    const result = transformCrimeData(crime);
    const carThief = result.participants.find(p => p.playerId === 2146080);
    const muscle = result.participants.find(p => p.playerId === 3679686);
    expect(carThief.checkpointPassRate).toBe(0);
    expect(carThief.checkpointStatus).toBe('failed');
    expect(muscle.checkpointPassRate).toBe(49);
    expect(muscle.checkpointStatus).toBe('failed');
  });

  test('missing pass rate stays pending', () => {
    const crime = sampleCrime();
    crime.slots[1].checkpoint_pass_rate = null;
    const result = transformCrimeData(crime);
    const carThief = result.participants.find(p => p.playerId === 2146080);
    expect(carThief.checkpointPassRate).toBeNull();
    expect(carThief.checkpointStatus).toBe('pending');
  });

  test('builds numbered role names for Thief/Looter positions', () => {
    const crime = sampleCrime();
    crime.slots[1].position = 'Thief';
    crime.slots[1].position_number = 2;
    const result = transformCrimeData(crime);
    const thief = result.participants.find(p => p.playerId === 2146080);
    expect(thief.role).toBe('Thief #2');
    // Non-numbered positions keep their plain name
    const muscle = result.participants.find(p => p.playerId === 3679686);
    expect(muscle.role).toBe('Muscle');
  });

  test('computes timeLeft until ready for unexecuted crimes', () => {
    const result = transformCrimeData(sampleCrime());
    expect(result.timeLeft).toBeGreaterThan(3500);
    expect(result.timeLeft).toBeLessThanOrEqual(3600);
  });

  test('maps API statuses to schema statuses', () => {
    expect(transformCrimeData(sampleCrime({ status: 'Succeeded' })).status).toBe('succeeded');
    expect(transformCrimeData(sampleCrime({ status: 'Succeeded' })).success).toBe(true);
    expect(transformCrimeData(sampleCrime({ status: 'Failed' })).status).toBe('failed');
    expect(transformCrimeData(sampleCrime({ status: 'Expired' })).status).toBe('expired');
    expect(transformCrimeData(sampleCrime({ status: 'Executing' })).status).toBe('pending');
    expect(transformCrimeData(sampleCrime({ status: 'Executing' })).success).toBeNull();
  });

  test('marks pending crimes expired when expired_at is in the past', () => {
    const result = transformCrimeData(sampleCrime({
      status: 'Recruiting',
      expired_at: Math.floor(Date.now() / 1000) - 60
    }));
    expect(result.status).toBe('expired');
    expect(result.success).toBe(false);
    expect(result.isComplete).toBe(true);
  });
});

describe('buildItemNameMap', () => {
  test('maps item ids to names', () => {
    const map = buildItemNameMap({
      1203: { name: 'Picklocks' },
      1350: { name: 'Police Badge' },
      9999: { name: 'Net' }
    });
    expect(map).toEqual({ 1203: 'Picklocks', 1350: 'Police Badge', 9999: 'Net' });
  });

  test('handles empty/missing catalogs and malformed entries', () => {
    expect(buildItemNameMap(undefined)).toEqual({});
    expect(buildItemNameMap(null)).toEqual({});
    expect(buildItemNameMap({ 1: null, 2: {}, 3: { name: 'X' } })).toEqual({ 3: 'X' });
  });
});

describe('resolveToolNames', () => {
  test('resolves exact item names from tool IDs', () => {
    const participants = [
      { toolId: 1203, tool: 'Picklocks' },
      { toolId: 484, tool: 'N/A' } // stale/hardcoded name gets replaced
    ];
    resolveToolNames(participants, { 1203: 'Picklocks', 484: 'Lockpick Set' });
    expect(participants[0].tool).toBe('Picklocks');
    expect(participants[1].tool).toBe('Lockpick Set'); // exact catalog name wins
  });

  test('keeps fallback name when item ID is unknown in catalog', () => {
    const participants = [{ toolId: 123456, tool: 'Mystery Tool' }];
    resolveToolNames(participants, { 1: 'X' });
    expect(participants[0].tool).toBe('Mystery Tool');
  });

  test("slots without item requirements show 'None' instead of 'N/A'", () => {
    const participants = [
      { toolId: null, tool: 'N/A' },
      { toolId: null, tool: '' },
      { toolId: null, tool: 'Custom Name' } // explicit fallback name is kept
    ];
    resolveToolNames(participants, {});
    expect(participants[0].tool).toBe('None');
    expect(participants[1].tool).toBe('None');
    expect(participants[2].tool).toBe('Custom Name');
  });

  test('tolerates a missing catalog (offline fallback)', () => {
    const participants = [{ toolId: 1203, tool: 'Picklocks' }];
    expect(resolveToolNames(participants, null)).toBe(participants);
    expect(participants[0].tool).toBe('Picklocks');
  });
});

describe('resolveToolNamesForStorage (persist-time)', () => {
  test('overwrites the ROLE_TOOLS guess with exact catalog names', () => {
    const participants = [
      { toolId: 484, tool: 'N/A' }, // ROLE_TOOLS had no entry for this position
      { toolId: 1203, tool: 'Picklocks' }
    ];
    resolveToolNamesForStorage(participants, { 484: 'Lockpick Set', 1203: 'Picklocks' });
    expect(participants[0].tool).toBe('Lockpick Set');
    expect(participants[1].tool).toBe('Picklocks');
  });

  test("keeps 'N/A' for slots without an item requirement (My Day gate)", () => {
    const participants = [{ toolId: null, tool: 'N/A' }];
    resolveToolNamesForStorage(participants, { 1: 'X' });
    expect(participants[0].tool).toBe('N/A'); // unlike the display variant's 'None'
  });

  test('keeps fallback names for item IDs unknown to the catalog', () => {
    const participants = [{ toolId: 123456, tool: 'Mystery Tool' }];
    resolveToolNamesForStorage(participants, { 1: 'X' });
    expect(participants[0].tool).toBe('Mystery Tool');
  });

  test('tolerates a missing catalog (refresh still succeeds)', () => {
    const participants = [{ toolId: 1203, tool: 'Picklocks' }];
    expect(resolveToolNamesForStorage(participants, null)).toBe(participants);
    expect(participants[0].tool).toBe('Picklocks');
  });
});

describe('indexDefinitionsByName + applyDefinition', () => {
  const defs = {
    1: { name: 'Best of the Lot', time: 24, members: 4, min_cash: 50000, max_cash: 250000, min_respect: 5, max_respect: 20 },
    2: { name: 'The Tax Grab', time: 48, members: 5, min_cash: 500000, max_cash: 1000000, min_respect: 10, max_respect: 40 }
  };

  test('indexes definitions case-insensitively by name', () => {
    const byName = indexDefinitionsByName(defs);
    expect(byName['best of the lot']).toBeDefined();
    expect(byName['the tax grab']).toBeDefined();
    expect(Object.keys(byName)).toHaveLength(2);
  });

  test('attaches canonical definition data to a crime', () => {
    const byName = indexDefinitionsByName(defs);
    const crime = applyDefinition({ crimeName: 'Best of the Lot' }, byName);
    expect(crime.definition).toEqual({
      timeHours: 24,
      members: 4,
      minCash: 50000,
      maxCash: 250000,
      minRespect: 5,
      maxRespect: 20
    });
  });

  test('matches crime names regardless of casing', () => {
    const byName = indexDefinitionsByName(defs);
    const crime = applyDefinition({ crimeName: 'the tax grab' }, byName);
    expect(crime.definition.timeHours).toBe(48);
    expect(crime.definition.maxCash).toBe(1000000);
  });

  test('leaves crimes without a known definition untouched', () => {
    const byName = indexDefinitionsByName(defs);
    const crime = applyDefinition({ crimeName: 'Unknown Heist' }, byName);
    expect(crime.definition).toBeUndefined();
  });

  test('tolerates empty definition sets', () => {
    const crime = applyDefinition({ crimeName: 'Anything' }, indexDefinitionsByName(undefined));
    expect(crime.definition).toBeUndefined();
  });
});
