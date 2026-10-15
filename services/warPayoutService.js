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

// Pay structures: 'straight' = every qualifying hit pays 100% of the value per
// hit; 'tiered' = volume discounts per band, where tiered members are paid a
// percentage OF THE SAME fixed value per hit and the withheld difference stays
// with the faction (leadership policy: recoup the cost of free war Xanax
// invested in members who don't pull their weight).
const PAYOUT_STRUCTURES = ['straight', 'tiered'];

// Tier bands for tiered pay, evaluated on the member's qualifying count
// (hits + assists when the assists option is on — both cost the faction
// Xanax). Ordered descending; first band whose minHits the count meets wins.
const TIER_BANDS = [
  { minHits: 35, multiplier: 1.00, label: '35+ hits' },
  { minHits: 20, multiplier: 0.75, label: '20–34 hits' },
  { minHits: 10, multiplier: 0.50, label: '10–19 hits' },
  { minHits: 0, multiplier: 0.25, label: 'under 10 hits' }
];

// Multiplier for a member's qualifying count under the given structure.
// Straight (default/unknown) always returns 1 — identical to pre-tier math.
function tierMultiplier(count, structure) {
  if (structure !== 'tiered') return 1;
  const band = TIER_BANDS.find(b => count >= b.minHits);
  return band ? band.multiplier : 1;
}

// Coerce a hit/assist/loss count to a safe non-negative integer.
function toCount(value) {
  const n = Math.trunc(Number(value) || 0);
  return n > 0 ? n : 0;
}

// Compute the full payout table.
// Inputs: { total, members, includeAssists, growthFlatPay, growthLossThreshold, payoutStructure }
//   members: [{ id, name, hits, assists, losses, position, positionAtWarStart }]
//   growthLossThreshold: null/''/non-numeric = growth payouts disabled.
//   payoutStructure: 'straight' (default) | 'tiered' (invalid values -> straight).
// Returns summary fields + rows, or { error } when growth pay exceeds the pool.
function computeWarPayout({ total, members = [], includeAssists = false, growthFlatPay = 0, growthLossThreshold = null, payoutStructure = 'straight' } = {}) {
  const structure = PAYOUT_STRUCTURES.includes(payoutStructure) ? payoutStructure : 'straight';
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
    const multiplier = tierMultiplier(qualifying, structure);
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
      multiplier,
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
  const weightedBasis = rows.reduce((sum, r) => sum + r.qualifying * r.multiplier, 0);
  // Fixed value per hit (hitPool ÷ basis) in BOTH modes: tiered members are
  // paid a percentage OF this same value, so anything withheld from low-tier
  // members stays with the faction (recoups free-Xanax cost). Each member's
  // payout is THEIR share rounded to the nearest dollar — never a rounded
  // rate × hits (leadership spreadsheet method: ROUND(qualifying × pool / basis)).
  const perHitValue = totalBasis > 0 ? hitPool / totalBasis : 0;
  rows.forEach(r => { r.payout = Math.round(r.qualifying * r.multiplier * perHitValue); });

  const hitPayoutTotal = rows.reduce((sum, r) => sum + r.payout, 0);
  // Exact tiered total before member-level rounding. tierDiscount = the part
  // of the hit pool no tier member earns (0 in straight mode and on zero
  // basis); roundingDelta = the few dollars of member-level rounding drift.
  // Identity: hitPool = hitPayoutTotal + tierDiscount + roundingDelta.
  const exactPayoutTotal = totalBasis > 0 ? hitPool * weightedBasis / totalBasis : 0;
  const tierDiscount = totalBasis > 0 ? Math.round(hitPool - exactPayoutTotal) : 0;
  const roundingDelta = hitPool - hitPayoutTotal - tierDiscount;
  const distributed = hitPayoutTotal + growthTotal;

  return {
    total: payoutTotal,
    factionCut,
    pool,
    payoutStructure: structure,
    includeAssists: !!includeAssists,
    growthEnabled,
    growthFlatPay: flatPay,
    growthLossThreshold: growthEnabled ? threshold : null,
    growthCount,
    growthTotal,
    hitPool,
    totalBasis,
    weightedBasis,
    perHitValue,
    tierDiscount,
    tierBands: TIER_BANDS,
    hitPayoutTotal,
    distributed,
    roundingDelta,
    rows
  };
}

module.exports = { FACTION_CUT_RATE, PAYOUT_STRUCTURES, TIER_BANDS, tierMultiplier, computeWarPayout };