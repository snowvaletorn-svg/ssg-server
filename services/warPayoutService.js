// ─── War payout pay table ─────────────────────────────────────────────────────
// Pure logic for the leadership payout calculator on the War page: splits a
// total distribution 20% to the faction / 80% to members, converts the member
// pool into an exact per-hit share, and adds flat Growth payouts drawn from
// the SAME pool (so growth pay reduces the per-hit share — leadership decision).
// Member payouts are each member's exact share ROUNDED TO THE NEAREST DOLLAR
// individually (the spreadsheet method) — never a rounded rate × hits, which
// drifts above the pool. The leftover from member-level rounding is surfaced
// as `roundingDelta` and attributed back to the faction so the parts always
// reconcile to the total. No MongoDB, no network — unit-tested in
// __tests__/warPayoutService.test.js.
//
// Growth qualification uses the member's role AT WAR START when provided
// (leadership policy: roles don't change during a war, and if they do, judge
// by war start), falling back to the current role. Growth = 'Team Growth' +
// 'Recruit', via the shared roleGroupForPosition helper used for permissions
// and lottery rolls — never a second copy of the role list.
//
// Assists: excluded from the payout basis by default; when `includeAssists`
// is on they count at FULL value (leadership decision), 1:1 with a hit.

const { roleGroupForPosition } = require('./competitionService');

const FACTION_CUT_RATE = 0.20;

// Coerce a hit/assist/loss count to a safe non-negative integer.
function toCount(value) {
  const n = Math.trunc(Number(value) || 0);
  return n > 0 ? n : 0;
}

// Compute the full payout table.
// Inputs: { total, members, includeAssists, growthFlatPay, growthLossThreshold }
//   members: [{ id, name, hits, assists, losses, position, positionAtWarStart }]
//   growthLossThreshold: null/''/non-numeric = growth payouts disabled.
// Returns summary fields + rows, or { error } when growth pay exceeds the pool.
function computeWarPayout({ total, members = [], includeAssists = false, growthFlatPay = 0, growthLossThreshold = null } = {}) {
  const payoutTotal = Math.max(0, Math.round(Number(total) || 0));
  const factionCut = Math.round(payoutTotal * FACTION_CUT_RATE);
  const pool = payoutTotal - factionCut;

  const flatPay = Math.max(0, Math.round(Number(growthFlatPay) || 0));
  const threshold = growthLossThreshold == null || growthLossThreshold === ''
    ? NaN
    : Math.trunc(Number(growthLossThreshold));
  const growthEnabled = Number.isFinite(threshold) && threshold >= 0;

  const rows = (Array.isArray(members) ? members : []).map(m => {
    const hits = toCount(m.hits);
    const assists = toCount(m.assists);
    const losses = toCount(m.losses);
    const position = m.positionAtWarStart || m.position || null;
    const isGrowthRole = roleGroupForPosition(position) === 'growth';
    const qualifiesForGrowth = isGrowthRole && growthEnabled && losses <= threshold;
    const qualifying = hits + (includeAssists ? assists : 0);
    return {
      id: m.id,
      name: m.name,
      hits,
      assists,
      losses,
      position,
      isGrowthRole,
      qualifiesForGrowth,
      qualifying,
      payout: 0
    };
  });

  const growthCount = rows.filter(r => r.qualifiesForGrowth).length;
  const growthTotal = flatPay * growthCount;

  if (growthTotal > pool) {
    return {
      error: `Growth payouts ($${growthTotal}) exceed the 80% member pool ($${pool}). Lower the growth amount or the total distribution.`,
      total: payoutTotal,
      factionCut,
      pool
    };
  }

  const hitPool = pool - growthTotal;
  const totalBasis = rows.reduce((sum, r) => sum + r.qualifying, 0);
  // Exact share per qualifying unit (pool ÷ basis). Each member's payout is
  // THEIR share rounded to the nearest dollar — not the rounded rate × hits
  // (leadership spreadsheet method: ROUND(hits × pool / totalHits)). Rounding
  // the rate first drifts above the pool; rounding shares last keeps the sum
  // at (or within a dollar or two of) the exact pool — surfaced as roundingDelta.
  const perHitValue = totalBasis > 0 ? hitPool / totalBasis : 0;
  rows.forEach(r => { r.payout = Math.round(r.qualifying * perHitValue); });

  const hitPayoutTotal = rows.reduce((sum, r) => sum + r.payout, 0);
  const distributed = hitPayoutTotal + growthTotal;
  const roundingDelta = pool - distributed;

  return {
    total: payoutTotal,
    factionCut,
    pool,
    includeAssists: !!includeAssists,
    growthEnabled,
    growthFlatPay: flatPay,
    growthLossThreshold: growthEnabled ? threshold : null,
    growthCount,
    growthTotal,
    hitPool,
    totalBasis,
    perHitValue,
    hitPayoutTotal,
    distributed,
    roundingDelta,
    rows
  };
}

module.exports = { FACTION_CUT_RATE, computeWarPayout };