# Snapshot Storage + Competition Page - Build Complete

## What Was Built

### Phase 1 - Data foundation
- `models/WeeklySnapshot.js`: memberStats rows now carry full `personalstats` (Mixed, optional). Weekly report/computeDiff untouched.
- `models/DailySnapshot.js` (NEW): separate collection, one doc per day (`daily_YYYY-MM-DD`).
- `services/snapshotService.js`: `fetchAllMemberStats` returns full personalstats + `totalStats`; added `mapWithConcurrency` (cap 10), `takeDailySnapshot` (idempotent upsert), `getLatestCompetitionSnapshot` (daily, fallback weekly).
- `services/schedulerService.js`: new cron `0 6 * * *` (daily 06:00 UTC) runs `takeDailySnapshot` silently.

### Phase 2 - Server API (server.js)
- `GET /api/competition/meta` (isAuthenticated + isFactionMember): stat catalog + member roster + isAdmin. Battle stats only in catalog for ownership/leadership.
- `GET /api/competition/data?stats=&members=` (isAuthenticated + isFactionMember): reads stored snapshot (NO live Torn calls). Server-side rejects battle stats for non-admins.
- `services/competitionService.js` (NEW): pure gating/catalog logic (BATTLE_STAT_KEYS, buildStatCatalog, filterRequestedStats, memberValuesFor).

### Phase 3 - UI
- `views/dashboard.ejs`: new "🏆 Competition" nav item + section (stat picker w/ search+groups, member picker all/choose, compare button, results).
- `public/js/dashboard.js`: competition client functions (loadCompetitionMeta, render pickers, runCompetitionCompare, renderCompetitionResults).
- `public/css/dashboard.css`: .competition-picker/.competition-group/.competition-bar styles.

### Phase 4 - Tests (all passing: 102 tests, 7 suites)
- `__tests__/competitionService.test.js`: battle-stat gating, catalog build, memberValuesFor (incl. legacy rows).
- `__tests__/snapshotService.test.js`: concurrency cap, widened pull, daily upsert idempotency, snapshot selection fallback.

### Battle-stat denylist (admin-only: ownership/leadership)
strength, defense, speed, dexterity, totalstats, manuallabor, intelligence, endurance, baserating

### Notes / assumptions
- Daily snapshot at 06:00 UTC; competition board is up to ~24h fresh (per user preference: daily > live).
- First snapshot must run before the page has data (404 until then).
- "Admin area access" = existing isLeadershipOrOwnership gate.

---

# SSG CAT Script - Build Complete

## What Was Built

### Backend (server.js additions)
- **3 MongoDB models**: CatUser, CatCall, CatStatus
- **9 API endpoints**:
  - `POST /api/cat/register` - User registration with Torn API key verification
  - `GET /api/cat/calls` - Get active calls (sorted by urgency)
  - `POST /api/cat/calls` - Create a call
  - `DELETE /api/cat/calls/:id` - Remove a call
  - `PUT /api/cat/calls/:id/timer` - Update hospital timer
  - `POST /api/cat/status` - Submit member status updates
  - `GET /api/cat/war-data` - Combined war data (calls + enemy stats + war info)
  - `GET /api/cat/script-version` - Version check
  - `GET /js/ssg-cat-script.user.js` - Serve the userscript for installation

### Userscript (`public/js/ssg-cat-script.user.js`)
- **Registration flow** - Prompts for Torn API key, verifies faction membership, stores auth token
- **Call buttons** - "📞 Call" button on enemy member rows
- **Call queue** - Sorted by hospital time remaining (shortest first)
- **Pulsing glow** - 🔴 Red pulsing "HIT NOW!" when target wakes up
- **Color-coded urgency** - Red (<5min), Orange (<15min), Green (>15min)
- **Caller tracking** - Shows who called each target
- **Delete button** - Caller can remove their own call
- **WebSocket interception** - Real-time hospital timer updates
- **Fetch interception** - War data and online status
- **Background polling** - Every 3 seconds syncs with server
- **Focus/buffer management** - Pauses when tab is inactive
- **TornPDA compatible** - Uses PDA_httpGet/PDA_httpMutation when available

### What's NOT included (as requested)
- ❌ No Discord integration
- ❌ No direct FF Scouter calls from browser (uses your server)
- ❌ No chain compliance tracking (future feature)

## Files Created/Modified

| File | Action |
|------|--------|
| `models/CatUser.js` | **NEW** - User registration model |
| `models/CatCall.js` | **NEW** - Call tracking model |
| `models/CatStatus.js` | **NEW** - Status update model (auto-purges after 2hrs) |
| `server.js` | **MODIFIED** - Added model imports + 9 CAT API routes |
| `public/js/ssg-cat-script.user.js` | **NEW** - The userscript for Tampermonkey/TornPDA |

## How to Install

1. **Deploy the server changes** to Render
2. **Install the userscript** by visiting:
   - `https://ssg-server.onrender.com/js/ssg-cat-script.user.js`
   - Or paste the code into a new Tampermonkey script
3. **First-time setup**: The script will prompt for your Torn API key
4. **Open Torn war page** - Call buttons appear on enemy members