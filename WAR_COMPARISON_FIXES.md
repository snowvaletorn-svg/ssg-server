# War Target Comparison Report - Fix Summary

## Problem
The war comparison report was showing "X across everyone" (all ❌), meaning no SSG members could hit any enemy members. This was caused by several issues:

1. **FFScouter API response parsing**: The code only checked for `bs_estimate` field, but FFScouter may return stats under different field names
2. **Zero stats handling**: When enemy stats were 0 or undefined, the comparison logic didn't handle it properly
3. **Lack of debugging**: No visibility into what stats were actually being retrieved

## Changes Made

### 1. server.js - Enhanced FFScouter stats parsing (lines 2924-2933)
**Before:**
```javascript
const totalStats = stats.bs_estimate || 0;
```

**After:**
```javascript
const totalStats = 
  stats.bs_estimate ?? 
  stats.bss_estimate ?? 
  stats.total_stats ?? 
  stats.bs ?? 
  stats.totalBs ?? 
  stats.estimated_stats ?? 
  0;
```

This ensures the code can handle different field names that FFScouter might return.

### 2. server.js - Two hit matrices: current stats + Vicodin (+25%)

The report now builds **two** matrices instead of one, so members can see both what
they can hit right now and what the Vicodin boost unlocks.

**Before:**
```javascript
const canHit = member.totalStats >= (enemy.totalStats * 0.98);
return canHit ? '✅' : '❌';
```

**After (current stats — the emailed grid):**
```javascript
if (!enemy.totalStats || enemy.totalStats <= 0) {
  return '⚠'; // Warning symbol for undetermined
}
const canHit = member.totalStats >= (enemy.totalStats * 0.98);
return canHit ? '✅' : '❌';
```

**After (Vicodin matrix — new "Targets on a Vicodin" section):**
```javascript
const VICODIN_STAT_BONUS = 1.25; // SSS-style Vicodin: +25% battle stats
const vicodinMatrix = ssgMembers.map(member => {
  const boostedTotal = Math.round(member.totalStats * VICODIN_STAT_BONUS);
  const hits = enemyMembers.map(enemy => {
    if (!enemy.totalStats || enemy.totalStats <= 0) return '⚠';
    return boostedTotal >= (enemy.totalStats * 0.98) ? '✅' : '❌';
  });
  return { memberName: member.name, memberId: member.id,
           totalStats: member.totalStats, vicodinTotal: boostedTotal, hits };
});
```

Because the boost is applied to the **member's** side, a member on a Vicodin can hit
any enemy whose stats are up to `1 / 1.25 = 80%` of their own (before the 2% buffer),
versus `98%` while unboosted.

Now shows a warning symbol (⚠) when enemy stats are unknown/zero.

### 3. server.js - Added debug logging (lines 2974-2977)
```javascript
console.log('[WarComparison] SSG Members with stats:', ssgMembers.map(m => `${m.name}: ${m.totalStats}`).join(', '));
console.log('[WarComparison] Enemy Members with stats:', enemyMembers.map(e => `${e.name}: ${e.totalStats}`).join(', '));
console.log('[WarComparison] Hit matrix generated:', hitMatrix.length, 'members vs', enemyMembers.length, 'enemies');
```

This helps diagnose issues by showing actual stats values in the server console.

### 4. server.js - Table + API response now carry Vicodin data (lines 3020-3070)

The monospace grid's member column now reads `Name (current → onVicodin)`, e.g.
`BigGuy (2500000 → 3125000)`, so every row is self-explanatory. The JSON response
gained the fields the dashboard needs:

- `vicodinStatBonus` — `1.25`, so the UI never hard-codes the multiplier
- `members[]` — per-member `totalStats`, `vicodinTotal`, and the `hits` symbol row
- `enemies[]` — `id`, `name`, `totalStats` (index-aligned with each `hits` array)
- `viewerMemberId` / `viewerMemberName` — which row belongs to whoever is logged in

### 5. snapshotService.js - New "💊 Your Targets on a Vicodin" email section

`sendWarTargetComparison(tableText, enemyFactionName, data)` now accepts an optional
third argument: `{ hitMatrix, vicodinMatrix, enemyMembers }`. When supplied, the email
gains a per-member table:

| Member | Now | On Vicodin | Targets (on Vicodin) |
|---|---|---|---|
| BigGuy | 2.50M | 3.12M | EnemyWeak (900.0K) |

Targets that are **only** reachable thanks to the boost are marked with 💊 (HTML) or
`[VICODIN ONLY]` (plain text), followed by a count of members who gain new targets.
The function is backwards compatible — calling it with two arguments renders exactly
the old email.

### 6. snapshotService.js - Updated email template to handle warning symbols (lines 414-426)
Added proper handling for the ⚠ symbol in email HTML tables with yellow background coloring.

### 7. snapshotService.js - Updated email legends
Added explanation for the warning symbol in both HTML and plain text email versions:
- ⚠️ = Enemy stats unknown/zero (cannot determine)
The legend now clarifies that the grid shows **current** effective stats and that the
separate section covers the Vicodin scenario.

## How to Test

1. **Start the server** (if not already running)
2. **Navigate to the War section** in the dashboard
3. **Click "Output Comparison"** button (Ownership only)
4. **Check server console logs** for debug output showing:
   - SSG member stats
   - Enemy member stats
   - Hit matrix generation info (both the current-stats and Vicodin matrices)
5. **Check the generated output** - should show:
   - The `💊 Targets on a Vicodin` table with `Now` / `On Vicodin` / `Targets`
   - Your own row highlighted and tagged `(you)`
   - The current-stats grid behind the "Full current-stats grid" disclosure
6. **Check email** - should receive the grid plus the per-member Vicodin target list
7. **Verify the math**: a member with 1.0M stats should be listed as able to hit an enemy
   with 1.2M stats on a Vicodin (1.0M × 1.25 = 1.25M ≥ 1.2M × 0.98 = 1.176M), but not
   before taking one.

## Expected Behavior

**Current-stats grid (emailed):**
- ✅ (green): Member can hit enemy *right now* (current stats ≥ 98% of enemy stats)
- ❌ (red): Member cannot hit that enemy right now
- ⚠️ (yellow/amber): Enemy stats unknown or zero (cannot determine)

**💊 Targets on a Vicodin table:**
- `Now` column: the member's current effective battle stats
- `On Vicodin` column: current stats × 1.25 (SSS-style +25% bonus)
- `Targets` column: enemies hittable while boosted; 💊 marks targets that the boost
  alone puts in range, so a member knows whether a Vicodin is actually needed
- `+N unknown` means N enemies in the list have no usable stats

### Threshold reference (with the 2% safety buffer)

| Scenario | Member can hit enemies up to |
|---|---|
| No Vicodin | 98% of the member's own stats |
| On Vicodin (+25%) | 122.5% of the member's own stats |

Equivalently, a member on a Vicodin only needs `100% / 1.25 ≈ 80%` of an enemy's stats
(counting the buffer: `0.98 / 1.25 = 78.4%`).

If all enemies show ⚠, it means FFScouter stats are not being retrieved properly. Check:
1. FFScouter API key is configured in the Targets section
2. FFScouter key has proper permissions
3. Enemy faction members are in FFScouter's database

If all show ❌, check the server console logs to see the actual stats values being compared.
