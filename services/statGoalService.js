// ─── Stat Goals service ────────────────────────────────────────────────────────
// Pure logic for the "road to X" stat goals: parsing user input, computing
// growth rates from snapshot history, and goal progress / ETA / pace status.
// No MongoDB, no network — unit-tested in __tests__/statGoalService.test.js.

// The stats a member can set a goal for (must match the StatGoal schema enum).
const VALID_STATS = {
  strength:   { label: 'Strength',   emoji: '💪' },
  defense:    { label: 'Defense',    emoji: '🛡️' },
  speed:      { label: 'Speed',      emoji: '⚡' },
  dexterity:  { label: 'Dexterity',  emoji: '🌀' },
  totalStats: { label: 'Total Stats', emoji: '📊' }
};

// Progress values are always computed from these keys in a stable order.
const STAT_KEYS = ['strength', 'defense', 'speed', 'dexterity', 'totalStats'];

// Preferred window for growth-rate calculation: use the last 30 days when we
// have enough snapshots inside it, otherwise fall back to all available data.
const GROWTH_WINDOW_DAYS = 30;

/**
 * Parse a user-entered stat target into a positive integer.
 * Accepts plain numbers, comma separators, and k/m/b suffixes
 * (e.g. "100m" -> 100000000, "1.5b" -> 1500000000, "500k" -> 500000).
 * Returns null when the input cannot be parsed to a positive number.
 */
function parseStatInput(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase().replace(/,/g, '');
  if (!raw) return null;

  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (!isFinite(num) || num <= 0) return null;

  const multipliers = { k: 1e3, m: 1e6, b: 1e9 };
  const multiplier = match[2] ? multipliers[match[2]] : 1;

  const result = Math.round(num * multiplier);
  return result > 0 ? result : null;
}

/**
 * Compute per-day growth for each stat from a list of UserStatSnapshot docs.
 *
 * Uses the newest-vs-oldest pair inside GROWTH_WINDOW_DAYS when at least two
 * snapshots fall in that window; otherwise uses the overall newest/oldest pair.
 * Returns all-zero rates when fewer than 2 snapshots exist.
 */
function computeGrowthRates(snapshots, now = Date.now()) {
  const rates = { strength: 0, defense: 0, speed: 0, dexterity: 0, totalStats: 0 };
  if (!Array.isArray(snapshots) || snapshots.length < 2) return rates;

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const newest = sorted[sorted.length - 1];
  const oldest = sorted[0];

  // Prefer the windowed pair when there are ≥2 snapshots inside it.
  const windowStart = now - GROWTH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const inWindow = sorted.filter(s => new Date(s.timestamp).getTime() >= windowStart);
  const first = inWindow.length >= 2 ? inWindow[0] : oldest;
  const last = inWindow.length >= 2 ? inWindow[inWindow.length - 1] : newest;

  const msSpan = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();
  const daysSpan = msSpan / (24 * 60 * 60 * 1000);
  if (daysSpan <= 0) return rates;

  STAT_KEYS.forEach(k => {
    const delta = (Number(last[k]) || 0) - (Number(first[k]) || 0);
    // Ignore negative deltas (stat resets / account changes) for ETA purposes.
    rates[k] = delta > 0 ? delta / daysSpan : 0;
  });

  return rates;
}

/**
 * Compute the full status of a single goal.
 *
 * @param {Object} goal    - { stat, targetValue, targetDate, startValue }
 * @param {number} current - current value of the stat
 * @param {Object} rates   - per-day growth rates from computeGrowthRates
 * @param {number} now     - epoch ms
 * @returns {Object} status with percent, remaining, ratePerDay, etaDate,
 *          pace ('on' | 'off' | 'overdue' | 'none' | 'unknown') and daysOff.
 *          - pace 'none'    : goal has no target date (ETA only)
 *          - pace 'unknown' : not enough growth data to project
 */
function computeGoalStatus(goal, current, rates, now = Date.now()) {
  const target = Number(goal?.targetValue) || 0;
  const cur = Number(current) || 0;
  const rate = Number(rates?.[goal?.stat]) || 0;
  const hasTargetDate = !!goal?.targetDate;

  const remaining = Math.max(target - cur, 0);
  const percent = target > 0 ? Math.min((cur / target) * 100, 100) : 0;

  const status = {
    stat: goal?.stat,
    current: cur,
    target,
    remaining,
    percent: Math.round(percent * 10) / 10,
    ratePerDay: rate,
    etaDate: null,
    pace: 'none',
    daysOff: null,
    complete: remaining <= 0
  };

  if (status.complete) {
    // Reached the target — pace/ETA no longer matter.
    status.pace = hasTargetDate ? 'on' : 'none';
    return status;
  }

  // ETA from actual growth rate (only possible with a positive rate).
  if (rate > 0) {
    const etaMs = now + (remaining / rate) * 24 * 60 * 60 * 1000;
    status.etaDate = new Date(etaMs);
  }

  if (!hasTargetDate) {
    // No deadline: ETA only; 'unknown' when we can't project.
    status.pace = status.etaDate ? 'none' : 'unknown';
    return status;
  }

  // Deadline given: compare actual rate vs required rate.
  const targetMs = new Date(goal.targetDate).getTime();
  const msLeft = targetMs - now;
  const daysLeft = msLeft / (24 * 60 * 60 * 1000);

  if (msLeft <= 0) {
    status.pace = 'overdue';
    return status;
  }

  if (rate <= 0) {
    // No growth data — can't judge pace.
    status.pace = 'unknown';
    return status;
  }

  const requiredRate = remaining / daysLeft;
  const etaDays = remaining / rate;
  status.daysOff = Math.round((etaDays - daysLeft) * 10) / 10;
  status.pace = rate >= requiredRate ? 'on' : 'off';
  return status;
}

/**
 * Compute status for every goal against the latest known stat values.
 * `currentStats` is an object like { strength, defense, speed, dexterity, totalStats }.
 */
function computeAllGoalStatuses(goals, currentStats, rates, now = Date.now()) {
  if (!Array.isArray(goals)) return [];
  return goals.map(goal => ({
    ...computeGoalStatus(goal, currentStats?.[goal.stat], rates, now),
    _id: goal._id,
    targetDate: goal.targetDate || null,
    startValue: goal.startValue || 0,
    createdAt: goal.createdAt || null
  }));
}

module.exports = {
  VALID_STATS,
  STAT_KEYS,
  GROWTH_WINDOW_DAYS,
  parseStatInput,
  computeGrowthRates,
  computeGoalStatus,
  computeAllGoalStatuses
};

