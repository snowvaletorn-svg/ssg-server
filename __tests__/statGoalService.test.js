// Unit tests for the stat goal service (parsing, growth rates, ETA/pace).
// Pure logic — no MongoDB, no network.
const {
  VALID_STATS,
  STAT_KEYS,
  GROWTH_WINDOW_DAYS,
  parseStatInput,
  computeGrowthRates,
  computeGoalStatus,
  computeAllGoalStatuses
} = require('../services/statGoalService');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-01-10T12:00:00Z').getTime();

describe('parseStatInput', () => {
  test('parses plain integers', () => {
    expect(parseStatInput('12345')).toBe(12345);
    expect(parseStatInput(42)).toBe(42);
  });

  test('parses comma-separated numbers', () => {
    expect(parseStatInput('100,000,000')).toBe(100000000);
  });

  test('parses k/m/b suffixes', () => {
    expect(parseStatInput('500k')).toBe(500000);
    expect(parseStatInput('100m')).toBe(100000000);
    expect(parseStatInput('1.5b')).toBe(1500000000);
    expect(parseStatInput('2 M')).toBe(2000000);
    expect(parseStatInput('750M')).toBe(750000000);
  });

  test('rejects invalid input', () => {
    expect(parseStatInput('')).toBeNull();
    expect(parseStatInput('   ')).toBeNull();
    expect(parseStatInput(null)).toBeNull();
    expect(parseStatInput(undefined)).toBeNull();
    expect(parseStatInput('abc')).toBeNull();
    expect(parseStatInput('-5')).toBeNull();
    expect(parseStatInput('0')).toBeNull();
    expect(parseStatInput('10x')).toBeNull();
  });
});

function snap(timestamp, overrides = {}) {
  return {
    timestamp: new Date(timestamp),
    strength: 0, defense: 0, speed: 0, dexterity: 0, totalStats: 0,
    ...overrides
  };
}

describe('computeGrowthRates', () => {
  test('returns zero rates with fewer than 2 snapshots', () => {
    expect(computeGrowthRates([], NOW).strength).toBe(0);
    expect(computeGrowthRates([snap(NOW - DAY)], NOW).strength).toBe(0);
    expect(computeGrowthRates(undefined, NOW).strength).toBe(0);
  });

  test('computes per-day growth between oldest and newest', () => {
    const rates = computeGrowthRates([
      snap(NOW - 4 * DAY, { strength: 100 }),
      snap(NOW, { strength: 200 })
    ], NOW);
    expect(rates.strength).toBeCloseTo(25, 5); // +100 over 4 days
    expect(rates.defense).toBe(0);
  });

  test('handles snapshots given in any order', () => {
    const rates = computeGrowthRates([
      snap(NOW, { dexterity: 500 }),
      snap(NOW - 2 * DAY, { dexterity: 300 })
    ], NOW);
    expect(rates.dexterity).toBeCloseTo(100, 5);
  });

  test('prefers the 30-day window when older snapshots exist', () => {
    const rates = computeGrowthRates([
      snap(NOW - 90 * DAY, { speed: 0 }),
      snap(NOW - 20 * DAY, { speed: 1000 }),
      snap(NOW, { speed: 2000 })
    ], NOW);
    // Window pair: (2000-1000)/20 days = 50/day — not (2000-0)/90.
    expect(rates.speed).toBeCloseTo(50, 5);
    expect(GROWTH_WINDOW_DAYS).toBe(30);
  });

  test('negative deltas (stat resets) are clamped to zero', () => {
    const rates = computeGrowthRates([
      snap(NOW - 2 * DAY, { strength: 500 }),
      snap(NOW, { strength: 100 })
    ], NOW);
    expect(rates.strength).toBe(0);
  });

describe('computeGoalStatus', () => {
  const rates = { strength: 1000, defense: 0, speed: 0, dexterity: 0, totalStats: 0 };

  test('no target date: pace none with an ETA when growth exists', () => {
    const status = computeGoalStatus(
      { stat: 'strength', targetValue: 20000 },
      10000, rates, NOW
    );
    expect(status.percent).toBe(50);
    expect(status.remaining).toBe(10000);
    expect(status.pace).toBe('none');
    expect(status.etaDate).not.toBeNull();
    // 10000 remaining / 1000 per day = 10 days
    expect(status.etaDate.getTime()).toBe(NOW + 10 * DAY);
  });

  test('no target date and no growth: pace unknown, no ETA', () => {
    const status = computeGoalStatus(
      { stat: 'defense', targetValue: 5000 },
      1000, rates, NOW
    );
    expect(status.pace).toBe('unknown');
    expect(status.etaDate).toBeNull();
  });

  test('on pace: actual rate beats required rate', () => {
    // Remaining 10000, 20 days left, rate 1000/day -> ETA in 10 days = 10 ahead
    const status = computeGoalStatus(
      { stat: 'strength', targetValue: 20000, targetDate: new Date(NOW + 20 * DAY) },
      10000, rates, NOW
    );
    expect(status.pace).toBe('on');
    expect(status.daysOff).toBeCloseTo(-10, 5);
  });

  test('behind pace: actual rate misses the deadline', () => {
    // Remaining 10000, 5 days left, rate 1000/day -> ETA in 10 days = 5 late
    const status = computeGoalStatus(
      { stat: 'strength', targetValue: 20000, targetDate: new Date(NOW + 5 * DAY) },
      10000, rates, NOW
    );
    expect(status.pace).toBe('off');
    expect(status.daysOff).toBeCloseTo(5, 5);
  });

  test('overdue when the date has passed and target unmet', () => {
    const status = computeGoalStatus(
      { stat: 'strength', targetValue: 20000, targetDate: new Date(NOW - DAY) },
      10000, rates, NOW
    );
    expect(status.pace).toBe('overdue');
    expect(status.complete).toBe(false);
  });

  test('complete goal short-circuits regardless of date', () => {
    const status = computeGoalStatus(
      { stat: 'strength', targetValue: 10000, targetDate: new Date(NOW - DAY) },
      15000, rates, NOW
    );
    expect(status.complete).toBe(true);
    expect(status.percent).toBe(100);
    expect(status.remaining).toBe(0);
    expect(status.pace).toBe('on');
  });

  test('percent is capped at 100', () => {
    const status = computeGoalStatus(
      { stat: 'strength', targetValue: 1000 },
      999999, rates, NOW
    );
    expect(status.percent).toBe(100);
  });

  test('pace unknown with a deadline but no growth data', () => {
    const status = computeGoalStatus(
      { stat: 'defense', targetValue: 5000, targetDate: new Date(NOW + 10 * DAY) },
      1000, rates, NOW
    );
    expect(status.pace).toBe('unknown');
    expect(status.etaDate).toBeNull();
  });

  test('handles missing current value gracefully', () => {
    const status = computeGoalStatus(
      { stat: 'speed', targetValue: 1000 },
      undefined, rates, NOW
    );
    expect(status.current).toBe(0);
    expect(status.percent).toBe(0);
  });
});

describe('computeAllGoalStatuses', () => {
  test('maps every goal and carries ids/dates through', () => {
    const goals = [
      { _id: 'a1', stat: 'strength', targetValue: 20000, targetDate: null, startValue: 5000, createdAt: NOW },
      { _id: 'b2', stat: 'defense', targetValue: 30000, targetDate: new Date(NOW + 10 * DAY), startValue: 0, createdAt: NOW }
    ];
    const current = { strength: 10000, defense: 10000, speed: 0, dexterity: 0, totalStats: 0 };
    const rates = { strength: 1000, defense: 2500, speed: 0, dexterity: 0, totalStats: 0 };

    const result = computeAllGoalStatuses(goals, current, rates, NOW);
    expect(result).toHaveLength(2);
    expect(result[0]._id).toBe('a1');
    expect(result[0].percent).toBe(50);
    expect(result[1].targetDate).toEqual(new Date(NOW + 10 * DAY));
    // defense: 20000 remaining, rate 2500/day -> ETA in 8 days, 2 days ahead
    expect(result[1].pace).toBe('on');
    expect(result[1].daysOff).toBeCloseTo(-2, 5);
  });

  test('returns [] for non-array input', () => {
    expect(computeAllGoalStatuses(null, {}, {}, NOW)).toEqual([]);
  });
});

describe('catalog', () => {
  test('VALID_STATS covers exactly the schema enum', () => {
    expect(Object.keys(VALID_STATS).sort()).toEqual(
      ['defense', 'dexterity', 'speed', 'strength', 'totalStats'].sort()
    );
    STAT_KEYS.forEach(k => expect(VALID_STATS[k]).toBeDefined());
  });
});


  test('identical timestamps produce zero rates', () => {
    const rates = computeGrowthRates([
      snap(NOW, { strength: 100 }),
      snap(NOW, { strength: 200 })
    ], NOW);
    expect(rates.strength).toBe(0);
  });
});
