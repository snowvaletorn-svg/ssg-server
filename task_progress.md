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