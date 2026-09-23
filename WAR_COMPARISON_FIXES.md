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

### 2. server.js - Improved hit detection with warning symbols (lines 2955-2972)
**Before:**
```javascript
const canHit = member.totalStats >= (enemy.totalStats * 0.98);
return canHit ? '✅' : '❌';
```

**After:**
```javascript
if (!enemy.totalStats || enemy.totalStats <= 0) {
  return '⚠'; // Warning symbol for undetermined
}
const canHit = member.totalStats >= (enemy.totalStats * 0.98);
return canHit ? '✅' : '❌';
```

Now shows a warning symbol (⚠) when enemy stats are unknown/zero.

### 3. server.js - Added debug logging (lines 2974-2977)
```javascript
console.log('[WarComparison] SSG Members with stats:', ssgMembers.map(m => `${m.name}: ${m.totalStats}`).join(', '));
console.log('[WarComparison] Enemy Members with stats:', enemyMembers.map(e => `${e.name}: ${e.totalStats}`).join(', '));
console.log('[WarComparison] Hit matrix generated:', hitMatrix.length, 'members vs', enemyMembers.length, 'enemies');
```

This helps diagnose issues by showing actual stats values in the server console.

### 4. server.js - Enhanced table output with member stats (lines 2988-2997)
Now includes member stats in parentheses next to member names for easier debugging.

### 5. snapshotService.js - Updated email template to handle warning symbols (lines 414-426)
Added proper handling for the ⚠ symbol in email HTML tables with yellow background coloring.

### 6. snapshotService.js - Updated email legends (lines 461-462, 476)
Added explanation for the warning symbol in both HTML and plain text email versions:
- ⚠️ = Enemy stats unknown/zero (cannot determine)

## How to Test

1. **Start the server** (if not already running)
2. **Navigate to the War section** in the dashboard
3. **Click "Output Comparison"** button (Ownership only)
4. **Check server console logs** for debug output showing:
   - SSG member stats
   - Enemy member stats
   - Hit matrix generation info
5. **Check the generated table** - should now show proper ✅/❌/⚠ symbols
6. **Check email** - should receive formatted comparison with proper symbols

## Expected Behavior

- ✅ (green): Member can hit enemy (member stats ≥ 98% of enemy stats)
- ❌ (red): Member cannot hit enemy (member stats < 98% of enemy stats)
- ⚠️ (yellow/amber): Enemy stats unknown or zero (cannot determine)

If all enemies show ⚠, it means FFScouter stats are not being retrieved properly. Check:
1. FFScouter API key is configured in the Targets section
2. FFScouter key has proper permissions
3. Enemy faction members are in FFScouter's database

If all show ❌, check the server console logs to see the actual stats values being compared.
