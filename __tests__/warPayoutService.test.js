// Unit tests for the war payout pay table math (pure — no Mongo/network).
const { FACTION_CUT_RATE, computeWarPayout } = require('../services/warPayoutService');

function member(overrides = {}) {
  return { id: 1, name: 'Member', hits: 0, assists: 0, losses: 0, position: null, positionAtWarStart: null, ...overrides };
}

describe('faction cut and pool', () => {
  test('takes 20% for the faction and pools the other 80%', () => {
    const r = computeWarPayout({ total: 1000000, members: [member({ hits: 10 })] });
    expect(FACTION_CUT_RATE).toBe(0.20);
    expect(r.factionCut).toBe(200000);
    expect(r.pool).toBe(800000);
  });

  test('rounds the total and faction cut to the nearest dollar', () => {
    const r = computeWarPayout({ total: 999.6, members: [] });
    expect(r.total).toBe(1000);
    expect(r.factionCut).toBe(200); // round(199.92)
    expect(r.pool).toBe(800);
  });

  test('rejects negative or non-numeric totals', () => {
    const r = computeWarPayout({ total: -500, members: [] });
    expect(r.total).toBe(0);
    expect(r.factionCut).toBe(0);
    expect(r.pool).toBe(0);
  });

  test('parts always reconcile to the total (cut + distributed + rounding)', () => {
    const r = computeWarPayout({
      total: 777777,
      members: [member({ id: 1, hits: 7 }), member({ id: 2, hits: 3, assists: 4 })],
      includeAssists: true,
      growthFlatPay: 5000,
      growthLossThreshold: 3
    });
    expect(r.factionCut + r.distributed + r.roundingDelta).toBe(r.total);
  });
});

describe('per-hit value and payouts', () => {
  test('pays each member their exact share of the pool, rounded individually', () => {
    const r = computeWarPayout({
      total: 1000000,
      members: [member({ id: 1, name: 'Alice', hits: 10 }), member({ id: 2, name: 'Bob', hits: 5 })]
    });
    // 800000/15 = 53333.33… exact per hit; each member's SHARE is rounded last
    expect(r.totalBasis).toBe(15);
    expect(r.perHitValue).toBeCloseTo(800000 / 15, 6);
    expect(r.rows[0].payout).toBe(Math.round(10 * 800000 / 15)); // 533,333
    expect(r.rows[1].payout).toBe(Math.round(5 * 800000 / 15));  // 266,667
    expect(r.hitPayoutTotal).toBe(800000);
    expect(r.roundingDelta).toBe(0);
  });

  test('matches the leadership spreadsheet exactly for the $246M sample war', () => {
    // Same roster/hits as the spreadsheet: ROUND(hits × pool / 162) per member.
    const hits = [21, 0, 24, 9, 3, 2, 23, 5, 4, 0, 15, 20, 0, 24, 6, 0, 6, 0];
    const members = hits.map((h, i) => member({ id: i + 1, name: `M${i + 1}`, hits: h }));
    const r = computeWarPayout({ total: 246000000, members });
    expect(r.factionCut).toBe(49200000);
    expect(r.pool).toBe(196800000);
    expect(r.totalBasis).toBe(162);
    expect(r.hitPayoutTotal).toBe(196800000); // rounded shares sum to the exact pool
    expect(r.roundingDelta).toBe(0);
    expect(r.rows[0].payout).toBe(25511111);  // The_Rev_Skippy, 21 hits
    expect(r.rows[2].payout).toBe(29155556);  // Gryffie, 24 hits
    expect(r.rows[3].payout).toBe(10933333);  // Oruscar, 9 hits
    expect(r.rows[5].payout).toBe(2429630);   // DarklordGod, 2 hits
    expect(r.rows[6].payout).toBe(27940741);  // tarun_007, 23 hits
    expect(r.rows[10].payout).toBe(18222222); // Vilka, 15 hits
    expect(r.rows[13].payout).toBe(29155556); // Anjethewierd, 24 hits
    expect(r.rows[1].payout).toBe(0);         // Snowvale, 0 hits
  });

  test('assists are excluded from the basis by default', () => {
    const r = computeWarPayout({
      total: 1000000,
      members: [member({ hits: 10, assists: 5 })]
    });
    expect(r.includeAssists).toBe(false);
    expect(r.totalBasis).toBe(10);
    expect(r.rows[0].qualifying).toBe(10);
  });

  test('assists count at full value when includeAssists is on', () => {
    const r = computeWarPayout({
      total: 1000000,
      members: [member({ hits: 10, assists: 5 })],
      includeAssists: true
    });
    expect(r.totalBasis).toBe(15);
    expect(r.rows[0].qualifying).toBe(15);
    // Same pool, larger basis -> smaller per-hit share
    expect(r.perHitValue).toBeCloseTo(800000 / 15, 6);
  });

  test('zero basis yields zero per-hit value, never NaN/Infinity', () => {
    const r = computeWarPayout({ total: 1000000, members: [member({ assists: 5 })] });
    expect(r.perHitValue).toBe(0);
    expect(r.hitPayoutTotal).toBe(0);
    expect(Number.isFinite(r.perHitValue)).toBe(true);
  });

  test('coerces garbage counts to zero', () => {
    const r = computeWarPayout({
      total: 1000,
      members: [member({ hits: 'x', assists: null, losses: -3 })]
    });
    expect(r.rows[0].hits).toBe(0);
    expect(r.rows[0].assists).toBe(0);
    expect(r.rows[0].losses).toBe(0);
  });
});

describe('growth payouts', () => {
  const growthAtWarStart = [
    member({ id: 1, name: 'GrowthKid', losses: 2, positionAtWarStart: 'Team Growth' }),
    member({ id: 2, name: 'Newbie', losses: 3, position: 'Recruit' }),            // war-start falls back to current
    member({ id: 3, name: 'StrongGuy', losses: 0, position: 'Team Strength' }),
    member({ id: 4, name: 'RiskyKid', losses: 4, position: 'Team Growth' })       // over threshold
  ];

  test('pays Team Growth and Recruit members at or under the loss threshold', () => {
    const r = computeWarPayout({ total: 100000, members: growthAtWarStart, growthFlatPay: 5000, growthLossThreshold: 3 });
    expect(r.growthEnabled).toBe(true);
    expect(r.growthCount).toBe(2); // GrowthKid (2 ≤ 3) + Newbie (3 ≤ 3); RiskyKid (4) out
    expect(r.growthTotal).toBe(10000);
  });

  test('growth pay comes OUT of the 80% pool and reduces the per-hit value', () => {
    const members = [member({ id: 1, hits: 10 }), member({ id: 2, losses: 0, positionAtWarStart: 'Recruit' })];
    const withoutGrowth = computeWarPayout({ total: 100000, members });
    const withGrowth = computeWarPayout({ total: 100000, members, growthFlatPay: 16000, growthLossThreshold: 0 });
    expect(withGrowth.growthTotal).toBe(16000);
    expect(withGrowth.hitPool).toBe(80000 - 16000);
    expect(withGrowth.perHitValue).toBeCloseTo(64000 / 10, 6);
    expect(withGrowth.perHitValue).toBeLessThan(withoutGrowth.perHitValue);
    // Reconciliation still holds
    expect(withGrowth.factionCut + withGrowth.distributed + withGrowth.roundingDelta).toBe(100000);
  });

  test('positionAtWarStart wins over the current position both ways', () => {
    const moved = computeWarPayout({
      total: 100000,
      members: [member({ position: 'Team Growth', positionAtWarStart: 'Team Strength', losses: 0 })],
      growthFlatPay: 1000,
      growthLossThreshold: 5
    });
    expect(moved.growthCount).toBe(0); // was Strength at war start -> not growth

    const promoted = computeWarPayout({
      total: 100000,
      members: [member({ position: 'Team Strength', positionAtWarStart: 'Recruit', losses: 0 })],
      growthFlatPay: 1000,
      growthLossThreshold: 5
    });
    expect(promoted.growthCount).toBe(1); // was Recruit at war start -> growth
  });

  test('no threshold (null/empty/non-numeric) disables growth payouts', () => {
    for (const threshold of [null, '', 'abc', undefined]) {
      const r = computeWarPayout({ total: 100000, members: growthAtWarStart, growthFlatPay: 5000, growthLossThreshold: threshold });
      expect(r.growthEnabled).toBe(false);
      expect(r.growthCount).toBe(0);
      expect(r.growthTotal).toBe(0);
    }
  });

  test('growth exceeding the pool returns an error', () => {
    const r = computeWarPayout({
      total: 1000, // pool = 800
      members: [member({ positionAtWarStart: 'Recruit', losses: 0 })],
      growthFlatPay: 999999,
      growthLossThreshold: 5
    });
    expect(r.error).toMatch(/exceed the 80% member pool/);
    expect(r.pool).toBe(800);
  });

  test('growth members can also earn hit pay (both columns)', () => {
    const r = computeWarPayout({
      total: 100000,
      members: [member({ hits: 10, positionAtWarStart: 'Team Growth', losses: 1 })],
      growthFlatPay: 5000,
      growthLossThreshold: 3
    });
    expect(r.rows[0].qualifying).toBe(10);
    expect(r.rows[0].payout).toBeGreaterThan(0);
    expect(r.rows[0].qualifiesForGrowth).toBe(true);
    expect(r.growthTotal).toBe(5000);
  });
});