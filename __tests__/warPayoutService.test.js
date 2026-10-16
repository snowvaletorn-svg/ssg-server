// Unit tests for the war payout pay table math (pure — no Mongo/network).
const {
  FACTION_CUT_RATE,
  lossMultiplier,
  growthEligibility,
  computeWarPayout
} = require('../services/warPayoutService');

function member(overrides = {}) {
  return {
    id: 1, name: 'Member', hits: 0, assists: 0, losses: 0,
    position: null, positionAtWarStart: null,
    daysInFaction: null, growthBenefitUsed: false, growthBenefitOverride: false,
    ...overrides
  };
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
      includeAssists: true
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

describe('growth baseline (first-war) pay', () => {
  test('growthEligibility: 21-day rule, used records, and overrides', () => {
    expect(growthEligibility({ daysInFaction: 21 })).toEqual({ eligible: true, reason: null }); // exactly 21 still eligible
    expect(growthEligibility({ daysInFaction: 22 }).reason).toBe('aged');
    expect(growthEligibility({ daysInFaction: null }).reason).toBe('aged');   // unknown -> auto-check
    expect(growthEligibility({ daysInFaction: 5, used: true }).reason).toBe('used');
    expect(growthEligibility({ daysInFaction: 30, override: true }).eligible).toBe(true);
    expect(growthEligibility({ daysInFaction: 30, used: true, override: true }).eligible).toBe(true); // one extra war
  });

  test('loss bands are inclusive: 10 -> 100%, 11–12 -> 75%, 13–15 -> 50%, 16–18 -> 25%, 19+ -> nothing', () => {
    expect(lossMultiplier(9)).toBe(1);
    expect(lossMultiplier(10)).toBe(1);
    expect(lossMultiplier(11)).toBe(0.75);
    expect(lossMultiplier(12)).toBe(0.75);
    expect(lossMultiplier(13)).toBe(0.5);
    expect(lossMultiplier(15)).toBe(0.5);
    expect(lossMultiplier(16)).toBe(0.25);
    expect(lossMultiplier(18)).toBe(0.25);
    expect(lossMultiplier(19)).toBe(0);
  });

  test('Y-method: baseline valued pre-growth, remainder re-divided for hit pay', () => {
    const members = [
      member({ id: 1, name: 'Grinder', hits: 40 }),
      member({ id: 2, name: 'Rookie', positionAtWarStart: 'Team Growth', daysInFaction: 5, losses: 0 })
    ];
    const r = computeWarPayout({ total: 1000, members });
    // pool 800; V0 = 800/40 = 20; growth = 10 × 1 × 20 = 200; hitPool 600; V = 15
    expect(r.growthBaselineValue).toBe(20);
    expect(r.rows[1].growthPay).toBe(200);
    expect(r.hitPool).toBe(600);
    expect(r.perHitValue).toBe(15);
    expect(r.rows[0].payout).toBe(600);
    expect(r.tierDiscount).toBe(0);
    expect(r.roundingDelta).toBe(0);
    expect(r.factionCut + r.distributed + r.tierDiscount + r.roundingDelta).toBe(r.total);
  });

  test('growth shortfall flows to the hit pool, never to the faction', () => {
    // Same roster, but Rookie loses 15 -> only 50% of the baseline is deducted.
    const members = [
      member({ id: 1, name: 'Grinder', hits: 40 }),
      member({ id: 2, name: 'Rookie', positionAtWarStart: 'Recruit', daysInFaction: 5, losses: 15 })
    ];
    const r = computeWarPayout({ total: 1000, members });
    // V0 = 20; growth = 10 × 0.5 × 20 = 100; hitPool 700; V = 17.5 (higher than full-baseline)
    expect(r.rows[1].growthPay).toBe(100);
    expect(r.perHitValue).toBe(17.5);
    expect(r.rows[0].payout).toBe(700);
    expect(r.tierDiscount).toBe(0);
    expect(r.hitPayoutTotal + r.growthTotal + r.tierDiscount + r.roundingDelta).toBe(r.pool);
  });

  test('19+ losses pays nothing and does not dilute the pool', () => {
    const members = [
      member({ id: 1, hits: 40 }),
      member({ id: 2, positionAtWarStart: 'Recruit', daysInFaction: 5, losses: 19 })
    ];
    const r = computeWarPayout({ total: 1000, members });
    expect(r.rows[1].growthPay).toBe(0);
    expect(r.growthPaidCount).toBe(0);
    expect(r.growthTotal).toBe(0);
    expect(r.perHitValue).toBe(20); // untouched: 800 / 40
  });

  test('used and aged members are excluded; overrides beat both', () => {
    const members = [
      member({ id: 1, hits: 40 }),
      member({ id: 2, positionAtWarStart: 'Team Growth', daysInFaction: 5, losses: 0, growthBenefitUsed: true }),
      member({ id: 3, positionAtWarStart: 'Team Growth', daysInFaction: 90, losses: 0 }),
      member({ id: 4, positionAtWarStart: 'Team Growth', daysInFaction: 90, losses: 0, growthBenefitOverride: true })
    ];
    const r = computeWarPayout({ total: 1000, members });
    expect(r.rows[1].growthReason).toBe('used');
    expect(r.rows[2].growthReason).toBe('aged');
    expect(r.rows[1].growthPay).toBe(0);
    expect(r.rows[2].growthPay).toBe(0);
    expect(r.rows[3].growthPay).toBeGreaterThan(0); // leadership exception
    expect(r.growthEligibleCount).toBe(1);
  });

  test('positionAtWarStart wins over the current position both ways', () => {
    const moved = computeWarPayout({
      total: 100000,
      members: [member({ position: 'Team Growth', positionAtWarStart: 'Team Strength', daysInFaction: 5, losses: 0 })]
    });
    expect(moved.growthEligibleCount).toBe(0); // Strength at war start -> not growth

    const promoted = computeWarPayout({
      total: 100000,
      members: [member({ position: 'Team Strength', positionAtWarStart: 'Recruit', daysInFaction: 5, losses: 0 })]
    });
    expect(promoted.growthEligibleCount).toBe(1); // Recruit at war start -> growth
  });

  test('growth members also earn hit pay for their own hits', () => {
    const r = computeWarPayout({
      total: 100000,
      members: [member({ hits: 40, positionAtWarStart: 'Team Growth', daysInFaction: 5, losses: 2 })]
    });
    // V0 = 80000/40 = 2000; growth = 10 × 1 × 2000 = 20000; hitPool 60000; V = 1500
    expect(r.rows[0].qualifying).toBe(40);
    expect(r.rows[0].growthPay).toBe(20000); // baseline
    expect(r.rows[0].payout).toBe(60000);    // plus hit pay for their own hits
  });

  test('zero hit basis splits the pool across the baselines', () => {
    const r = computeWarPayout({
      total: 1000,
      members: [member({ positionAtWarStart: 'Recruit', daysInFaction: 5, losses: 10 })]
    });
    // V0 = 800/10 = 80; growth takes the full pool; nothing left for hits
    expect(r.growthBaselineValue).toBe(80);
    expect(r.rows[0].growthPay).toBe(800);
    expect(r.hitPayoutTotal).toBe(0);
    expect(r.roundingDelta).toBe(0);
    expect(r.factionCut + r.distributed + r.tierDiscount + r.roundingDelta).toBe(1000);
  });

  test('baselines exceeding the pool return an error', () => {
    const r = computeWarPayout({
      total: 1000, // pool 800; V0 = 800/5 = 160; one baseline = 1600 > pool
      members: [member({ hits: 5 }), member({ positionAtWarStart: 'Recruit', daysInFaction: 5, losses: 0 })]
    });
    expect(r.error).toMatch(/exceed the 80% member pool/);
    expect(r.pool).toBe(800);
  });

  test('matches the leadership spreadsheet: $246M tiered war with two growth baselines', () => {
    const hits = [40, 35, 30, 29, 13, 2, 23, 18, 10, 19, 15, 20, 0, 24, 6, 0, 6, 0];
    const members = hits.map((h, i) => member({ id: i + 1, name: `M${i + 1}`, hits: h }));
    members.push(
      member({ id: 101, name: 'R3VERSE', losses: 10, positionAtWarStart: 'Team Growth', daysInFaction: 14 }),
      member({ id: 102, name: 'GameMaker01', losses: 15, positionAtWarStart: 'Team Growth', daysInFaction: 9 })
    );
    const r = computeWarPayout({ total: 246000000, members, payoutStructure: 'tiered' });
    expect(r.factionCut).toBe(49200000);
    expect(r.pool).toBe(196800000);
    expect(r.totalBasis).toBe(290);
    expect(r.growthBaselineValue).toBeCloseTo(196800000 / 290, 6);
    const byId = {};
    r.rows.forEach(row => { byId[row.id] = row; });
    expect(byId[101].growthPay).toBe(6786207); // R3VERSE: 10 losses -> 100% of 10 hits
    expect(byId[102].growthPay).toBe(3393103); // GameMaker01: 15 losses -> 50%
    expect(byId[1].payout).toBe(25740785);     // The_Rev_Skippy 40 @100%
    expect(byId[3].payout).toBe(14479191);     // Gryffie 30 @75%
    expect(byId[15].payout).toBe(965279);      // GrimTheKnight 6 @25%
    expect(byId[13].payout).toBe(0);           // Arc_Padilla 0 hits
    expect(r.hitPayoutTotal).toBe(135460879);
    expect(r.growthTotal).toBe(10179310);
    expect(r.tierDiscount).toBe(51159810);     // retained by faction
    expect(r.roundingDelta).toBe(1);
    expect(r.factionCut + r.distributed + r.tierDiscount + r.roundingDelta).toBe(246000000);
  });
});

describe('tiered pay structure', () => {
  test('applies band multipliers at the exact qualifying boundaries', () => {
    const counts = [9, 10, 19, 20, 34, 35, 100];
    const members = counts.map((h, i) => member({ id: i + 1, hits: h }));
    const r = computeWarPayout({ total: 100000, members, payoutStructure: 'tiered' });
    expect(r.payoutStructure).toBe('tiered');
    expect(r.rows.map(row => row.multiplier)).toEqual([0.25, 0.5, 0.5, 0.75, 0.75, 1, 1]);
    expect(r.tierBands.map(b => b.minHits)).toEqual([35, 20, 10, 0]);
  });

  test('straight mode: every hit at 100%, zero tier discount (pre-tier behavior intact)', () => {
    const members = [member({ id: 1, hits: 40 }), member({ id: 2, hits: 10 })];
    const r = computeWarPayout({ total: 1000, members });
    expect(r.payoutStructure).toBe('straight');
    expect(r.rows.every(row => row.multiplier === 1)).toBe(true);
    expect(r.tierDiscount).toBe(0);
    expect(r.hitPayoutTotal).toBe(800); // pool fully paid, remainder 0
    expect(r.roundingDelta).toBe(0);
  });

  test('tiered: fixed value per hit, low tier paid 50%, discount retained by faction', () => {
    const members = [member({ id: 1, name: 'Grinder', hits: 40 }), member({ id: 2, name: 'Casual', hits: 10 })];
    const r = computeWarPayout({ total: 1000, members, payoutStructure: 'tiered' });
    expect(r.perHitValue).toBe(16);          // SAME value as straight: 800 / 50
    expect(r.rows[0].multiplier).toBe(1);
    expect(r.rows[1].multiplier).toBe(0.5);
    expect(r.rows[0].payout).toBe(640);      // 40 × 16
    expect(r.rows[1].payout).toBe(80);       // 10 × 0.5 × 16
    expect(r.hitPayoutTotal).toBe(720);
    expect(r.tierDiscount).toBe(80);         // 800 − 720 stays with the faction
    expect(r.roundingDelta).toBe(0);
    // Identity: cut + payouts(+growth) + discount + rounding = total
    expect(r.factionCut + r.distributed + r.tierDiscount + r.roundingDelta).toBe(r.total);
  });

  test('identity holds across assorted tiered datasets', () => {
    const datasets = [
      { total: 999, hits: [35, 10, 1] },
      { total: 1234567, hits: [48, 22, 15, 9, 0, 33] },
      { total: 50000, hits: [3, 7, 12, 34, 36] }
    ];
    for (const d of datasets) {
      const members = d.hits.map((h, i) => member({ id: i + 1, hits: h }));
      const r = computeWarPayout({ total: d.total, members, payoutStructure: 'tiered' });
      expect(r.hitPayoutTotal + r.tierDiscount + r.roundingDelta).toBe(r.hitPool);
      expect(r.factionCut + r.distributed + r.tierDiscount + r.roundingDelta).toBe(r.total);
    }
  });

  test('growth baseline combines with tiered hits (Y-method)', () => {
    const members = [
      member({ id: 1, hits: 40 }),
      member({ id: 2, hits: 10, positionAtWarStart: 'Recruit', daysInFaction: 5, losses: 0 })
    ];
    const r = computeWarPayout({ total: 10000, members, payoutStructure: 'tiered' });
    // pool 8000; V0 = 8000/50 = 160; growth = 10 × 1 × 160 = 1600; hitPool 6400; V = 128
    expect(r.growthBaselineValue).toBe(160);
    expect(r.growthTotal).toBe(1600);
    expect(r.hitPool).toBe(6400);
    expect(r.perHitValue).toBe(128);
    expect(r.rows[0].payout).toBe(5120);     // 40 × 1.00 × 128
    expect(r.rows[1].payout).toBe(640);      // 10 × 0.50 × 128 (tiered hits)
    expect(r.rows[1].growthPay).toBe(1600);  // plus the first-war baseline
    expect(r.tierDiscount).toBe(640);        // (50 − 45) × 128 — hit tiers only
    expect(r.roundingDelta).toBe(0);
    expect(r.factionCut + r.distributed + r.tierDiscount + r.roundingDelta).toBe(10000);
  });

  test('assists count toward the band when included, not when excluded', () => {
    const members = [member({ hits: 9, assists: 5 })];
    const hitsOnly = computeWarPayout({ total: 10000, members, payoutStructure: 'tiered', includeAssists: false });
    expect(hitsOnly.rows[0].multiplier).toBe(0.25);   // 9 qualifying → under 10
    const withAssists = computeWarPayout({ total: 10000, members, payoutStructure: 'tiered', includeAssists: true });
    expect(withAssists.rows[0].qualifying).toBe(14);
    expect(withAssists.rows[0].multiplier).toBe(0.5);  // 14 qualifying → 10–19 band
  });

  test('unknown structure falls back to straight', () => {
    const r = computeWarPayout({ total: 1000, members: [member({ hits: 5 })], payoutStructure: 'banana' });
    expect(r.payoutStructure).toBe('straight');
    expect(r.rows[0].multiplier).toBe(1);
    expect(r.tierDiscount).toBe(0);
  });

  test('tiered with zero basis pays nothing and leaves the pool as rounding remainder', () => {
    const r = computeWarPayout({ total: 1000, members: [], payoutStructure: 'tiered' });
    expect(r.hitPayoutTotal).toBe(0);
    expect(r.tierDiscount).toBe(0);     // no members -> no tier discounts claimed
    expect(r.roundingDelta).toBe(800);
  });
});