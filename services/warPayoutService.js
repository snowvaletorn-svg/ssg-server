// ─── War payout pay table ─────────────────────────────────────────────────────
// Pure logic for the leadership payout calculator on the War page: splits a
// total distribution 20% to the faction / 80% to members. Growth first-war
// baselines come OUT of the pool BEFORE the per-hit value is decided (Y-method
// per the leadership spreadsheet): growth members are valued at the pre-growth
// value V0 = pool ÷ hit basis, only what they EARN is deducted, and the
// remainder is re-divided as the hit value — so any growth shortfall flows
// into the players' per-hit pool, never back to the faction.
// Member payouts are each member's exact share ROUNDED TO THE NEAREST DOLLAR
// individually — never a rounded rate × hits. The leftover is surfaced as
// `roundingDelta`; hit-tier discounts (tiered mode only) are `tierDiscount`
// (retained by the faction — the Xanax recoup). Parts always reconcile:
// pool = hit payouts + growth payouts + tierDiscount + roundingDelta.
// No MongoDB, no network — unit-tested in __tests__/warPayoutService.test.js.
//
// Growth qualification: role AT WAR START ('Team Growth'/'Recruit' via the
// shared roleGroupForPosition helper) + first-war eligibility (<=21 days in
// faction or a leadership override, no paid record — see growthEligibility).
// Growth benefit consumes the member's one war ever (GrowthBenefit ledger,
// annotated server-side as growthBenefitUsed / growthBenefitOverride).
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

// First-war growth baseline: worth the equivalent of 10 hits at the PRE-growth
// value per hit. Only the earned slice is deducted from the pool; whatever the
// loss tier withholds stays in the players' per-hit pool (leadership spec).
const GROWTH_BASELINE_HITS = 10;

// Growth loss bands — INCLUSIVE upper bounds (leadership spreadsheet spec:
// "under 10/12/15/18" implemented as 10 or fewer, 12 or fewer, …; verified
// against the R3VERSE @10 losses / GameMaker01 @15 losses test dataset).
const GROWTH_LOSS_BANDS = [
  { maxLosses: 10, multiplier: 1.00, label: '0–10 losses' },
  { maxLosses: 12, multiplier: 0.75, label: '11–12 losses' },
  { maxLosses: 15, multiplier: 0.50, label: '13–15 losses' },
  { maxLosses: 18, multiplier: 0.25, label: '16–18 losses' },
  { maxLosses: Infinity, multiplier: 0, label: '19+ losses (nothing)' }
];

// Loss-band multiplier for a growth member's received attacks (losses).
function lossMultiplier(losses) {
  const n = toCount(losses);
  const band = GROWTH_LOSS_BANDS.find(b => n <= b.maxLosses);
  return band ? band.multiplier : 0;
}

// First-war eligibility: <=21 days in faction AND not already paid, with a
// leadership `override` that beats BOTH the 21-day auto-check and a used
// record (that's how an exception buys one extra war). Unknown daysInFaction
// (member left mid-war / attack-only rows) is treated as auto-checked.
// Pure & unit-tested; the server annotates used/override from the ledger.
function growthEligibility({ daysInFaction = null, used = false, override = false } = {}) {
  if (override) return { eligible: true, reason: null };
  if (used) return { eligible: false, reason: 'used' };
  // Number(null) === 0, so guard the "unknown" case explicitly before coercing.
  if (daysInFaction == null || daysInFaction === '') return { eligible: false, reason: 'aged' };
  const days = Number(daysInFaction);
  if (!Number.isFinite(days)) return { eligible: false, reason: 'aged' };
  if (days > 21) return { eligible: false, reason: 'aged' };
  return { eligible: true, reason: null };
}

// Coerce a hit/assist/loss count to a safe non-negative integer.
function toCount(value) {
  const n = Math.trunc(Number(value) || 0);
  return n > 0 ? n : 0;
}

// Compute the full payout table.
// Inputs: { total, members, includeAssists, payoutStructure }
//   members: [{ id, name, hits, assists, losses, position, positionAtWarStart,
//               daysInFaction, growthBenefitUsed, growthBenefitOverride }]
//   payoutStructure: 'straight' (default) | 'tiered' (invalid values -> straight).
// The server annotates growthBenefitUsed/Override from the GrowthBenefit
// ledger (client-supplied flags are overwritten there) — this stays pure.
// Returns summary fields + rows, or { error } when baselines can't fit the pool.
function computeWarPayout({ total, members = [], includeAssists = false, payoutStructure = 'straight' } = {}) {
  const structure = PAYOUT_STRUCTURES.includes(payoutStructure) ? payoutStructure : 'straight';
  const payoutTotal = Math.max(0, Math.round(Number(total) || 0));
  const factionCut = Math.round(payoutTotal * FACTION_CUT_RATE);
  const pool = payoutTotal - factionCut;

  const rows = (Array.isArray(members) ? members : []).map(m => {
    const hits = toCount(m.hits);
    const assists = toCount(m.assists);
    const losses = toCount(m.losses);
    const position = m.positionAtWarStart || m.position || null;
    const isGrowthRole = roleGroupForPosition(position) === 'growth';
    const growth = growthEligibility({
      daysInFaction: m.daysInFaction,
      used: !!m.growthBenefitUsed,
      override: !!m.growthBenefitOverride
    });
    const growthEligible = isGrowthRole && growth.eligible;
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
      growthEligible,
      growthReason: isGrowthRole ? growth.reason : null,
      growthOverride: !!m.growthBenefitOverride,
      growthLossMultiplier: growthEligible ? lossMultiplier(losses) : 0,
      growthPay: 0,
      qualifying,
      multiplier,
      payout: 0
    };
  });

  const totalBasis = rows.reduce((sum, r) => sum + r.qualifying, 0);
  const weightedBasis = rows.reduce((sum, r) => sum + r.qualifying * r.multiplier, 0);
  const growthEligibleRows = rows.filter(r => r.growthEligible);

  // Y-method: value growth at the PRE-growth per-hit value, deduct only what
  // they earn, then re-divide the remainder for hit pay. Zero hit basis falls
  // back to splitting the pool across the baselines themselves.
  const growthBaselineValue = totalBasis > 0
    ? pool / totalBasis
    : (growthEligibleRows.length > 0 ? pool / (GROWTH_BASELINE_HITS * growthEligibleRows.length) : 0);
  rows.forEach(r => {
    r.growthPay = r.growthEligible ? Math.round(GROWTH_BASELINE_HITS * r.growthLossMultiplier * growthBaselineValue) : 0;
  });
  const growthEligibleCount = growthEligibleRows.length;
  const growthPaidCount = rows.filter(r => r.growthPay > 0).length;
  const growthTotal = rows.reduce((sum, r) => sum + r.growthPay, 0);

  if (growthTotal > pool) {
    return {
      error: `Growth baselines ($${growthTotal}) exceed the 80% member pool ($${pool}) — the roster's hit count is too small to fund ${growthEligibleCount} baseline(s). Check the roster or raise the total distribution.`,
      total: payoutTotal,
      factionCut,
      pool,
      payoutStructure: structure
    };
  }

  const hitPool = pool - growthTotal;
  // Fixed value per hit (hitPool ÷ basis) in BOTH modes: tiered members are
  // paid a percentage OF this same value, so anything withheld from low-tier
  // members stays with the faction (recoups free-Xanax cost). Each member's
  // payout is THEIR share rounded to the nearest dollar — never a rounded
  // rate × hits (leadership spreadsheet method).
  const perHitValue = totalBasis > 0 ? hitPool / totalBasis : 0;
  rows.forEach(r => { r.payout = Math.round(r.qualifying * r.multiplier * perHitValue); });

  const hitPayoutTotal = rows.reduce((sum, r) => sum + r.payout, 0);
  // Hit-tier discount only (growth shortfall is NOT retained — it flows to
  // the hit pool by construction). roundingDelta = member-level rounding
  // drift. Identity: pool = hitPayoutTotal + growthTotal + tierDiscount + roundingDelta.
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
    growthBaselineHits: GROWTH_BASELINE_HITS,
    growthBands: GROWTH_LOSS_BANDS,
    growthBaselineValue,
    growthEligibleCount,
    growthPaidCount,
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

module.exports = {
  FACTION_CUT_RATE,
  PAYOUT_STRUCTURES,
  TIER_BANDS,
  tierMultiplier,
  GROWTH_BASELINE_HITS,
  GROWTH_LOSS_BANDS,
  lossMultiplier,
  growthEligibility,
  computeWarPayout
};