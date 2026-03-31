// ── Section Navigation ────────────────────────────────────────────────────────
function showSection(sectionId, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  if (el) el.classList.add('active');

  if (sectionId === 'torn') { fetchTornUser(); }
  if (sectionId === 'faction') { fetchFaction(); fetchWarStats(); }
  if (sectionId === 'travel') { fetchTravel(); fetchYataStock(); }
  if (sectionId === 'admin') { fetchMemberOverview(); }
  if (sectionId === 'channels' && currentChannelId) fetchMessages(currentChannelId);
}

// ── Personal Torn API Key ─────────────────────────────────────────────────────
function showKeyForm() {
  document.getElementById('key-form').classList.remove('hidden');
}

async function saveTornKey() {
  const input = document.getElementById('torn-key-input');
  const statusEl = document.getElementById('key-status');
  const key = input.value.trim();

  if (!key) { statusEl.innerHTML = '<p style="color:#ff4444;">Please enter an API key.</p>'; return; }
  statusEl.innerHTML = '<p class="muted">Validating key...</p>';

  try {
    const res = await fetch('/api/torn/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    if (!res.ok) { statusEl.innerHTML = `<p style="color:#ff4444;">❌ ${data.error}</p>`; return; }
    statusEl.innerHTML = `<p class="success-text">✅ Key saved! Welcome, ${data.player.name} [${data.player.player_id}]</p>`;
    document.getElementById('key-form').classList.add('hidden');
    input.value = '';
  } catch (err) {
    statusEl.innerHTML = `<p style="color:#ff4444;">❌ Error: ${err.message}</p>`;
  }
}

// ── Faction API Key (Ownership only) ─────────────────────────────────────────
function showFactionKeyForm() {
  document.getElementById('faction-key-form').classList.remove('hidden');
}

async function saveFactionKey() {
  const input = document.getElementById('faction-key-input');
  const statusEl = document.getElementById('faction-key-status');
  const key = input.value.trim();

  if (!key) { statusEl.innerHTML = '<p style="color:#ff4444;">Please enter an API key.</p>'; return; }
  statusEl.innerHTML = '<p class="muted">Validating key...</p>';

  try {
    const res = await fetch('/api/torn/faction-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    if (!res.ok) { statusEl.innerHTML = `<p style="color:#ff4444;">❌ ${data.error}</p>`; return; }
    statusEl.innerHTML = `<p class="success-text">✅ Faction key saved! Faction: ${data.faction.name}</p>`;
    document.getElementById('faction-key-form').classList.add('hidden');
    input.value = '';
  } catch (err) {
    statusEl.innerHTML = `<p style="color:#ff4444;">❌ Error: ${err.message}</p>`;
  }
}

// ── Channel Feed ──────────────────────────────────────────────────────────────
let currentChannelId = null;
let memberCache = {};

function loadChannel(channelId) {
  if (!channelId) return;
  currentChannelId = channelId;
  fetchMessages(channelId);
}

function refreshMessages() {
  if (currentChannelId) fetchMessages(currentChannelId);
}

async function fetchSSGMembers() {
  if (Object.keys(memberCache).length > 0) return;
  try {
    const res = await fetch('/api/discord/members');
    const data = await res.json();
    if (res.ok) {
      data.forEach(m => {
        memberCache[m.user.id] = m.nick || m.user.global_name || m.user.username;
      });
    }
  } catch (err) {
    console.error('Could not fetch member list:', err);
  }
}

async function fetchMessages(channelId) {
  const feed = document.getElementById('channel-feed');
  feed.innerHTML = '<div class="channel-loading">LOADING MESSAGES...</div>';
  await fetchSSGMembers();
  try {
    const res = await fetch(`/api/discord/channel/${channelId}`);
    const data = await res.json();
    if (!res.ok) { feed.innerHTML = `<div class="channel-error">⚠️ ${data.error || 'Failed to load messages'}</div>`; return; }
    if (!data.length) { feed.innerHTML = '<div class="channel-placeholder"><span class="placeholder-icon">💬</span><p>No messages found</p></div>'; return; }
    feed.innerHTML = [...data].reverse().map(renderMessage).join('');
  } catch (err) {
    feed.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

function renderMessage(msg) {
  const author = msg.author;
  const avatarUrl = author.avatar ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png` : null;
  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" alt="${escapeHtml(author.username)}">`
    : `<span>${escapeHtml(author.username.charAt(0).toUpperCase())}</span>`;
  const timestamp = new Date(msg.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const content = formatContent(msg.content, msg.mentions);
  const displayName = memberCache[author.id] || author.global_name || author.username;

  return `
    <div class="message-item">
      <div class="msg-avatar">${avatarHtml}</div>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-author">${escapeHtml(displayName)}</span>
          <span class="msg-time">${timestamp}</span>
        </div>
        <div class="msg-content">${content}</div>
        ${msg.attachments?.length ? renderAttachments(msg.attachments) : ''}
      </div>
    </div>`;
}

function renderAttachments(attachments) {
  return attachments.map(att => {
    if (att.content_type?.startsWith('image/')) {
      return `<img src="${att.url}" alt="attachment" style="max-width:300px;max-height:200px;border-radius:4px;margin-top:0.4rem;display:block;">`;
    }
    return `<a href="${att.url}" target="_blank" rel="noopener" style="color:#3611b0;font-size:0.85rem;">📎 ${escapeHtml(att.filename)}</a>`;
  }).join('');
}

function formatContent(text, mentions) {
  if (!text) return '<em style="color:#444">No text content</em>';
  let out = escapeHtml(text);
  out = out.replace(/&lt;@!?(\d+)&gt;/g, (match, userId) => {
    const name = memberCache[userId] || mentions?.find(m => m.id === userId)?.global_name || userId;
    return `<span style="background:rgba(54,17,176,0.2);color:#a78df5;border-radius:3px;padding:0.1em 0.3em;font-weight:600;">@${name}</span>`;
  });
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
  out = out.replace(/`(.+?)`/g, '<code style="background:#1a1919;padding:0.1em 0.3em;border-radius:3px;font-family:\'Share Tech Mono\',monospace;font-size:0.85em;">$1</code>');
  out = out.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return out;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── Torn User Stats ───────────────────────────────────────────────────────────
async function fetchTornUser() {
  const container = document.getElementById('torn-user-data');
  container.innerHTML = '<div class="channel-loading">LOADING TORN DATA...</div>';
  try {
    const res = await fetch('/api/torn/user');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderTornUser(data);
    // Random delay 0-5 seconds before level progress to avoid simultaneous HOF calls
    const delay = Math.floor(Math.random() * 5000);
    setTimeout(() => fetchLevelProgress(data.level), delay);
    // Fetch addiction level
    fetchAddictionLevel();
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderTornUser(d) {
  const lifeBar = d.life ? `${d.life.current}/${d.life.maximum}` : 'N/A';
  const energyBar = d.energy ? `${d.energy.current}/${d.energy.maximum}` : 'N/A';
  const nerveBar = d.nerve ? `${d.nerve.current}/${d.nerve.maximum}` : 'N/A';
  const happyBar = d.happy ? `${d.happy.current}/${d.happy.maximum}` : 'N/A';
  const married = d.married?.spouse_name ? `💍 ${d.married.spouse_name}` : 'No';
  const job = d.job?.position && d.job?.company_name !== 'None'
    ? `${d.job.position} at ${d.job.company_name}` : d.job?.job || 'Unemployed';

  return `
    <div class="card">
      <div class="card-header">
        ${d.name} [${d.player_id}]
        <span style="float:right;font-size:0.8rem;color:#555;">${d.faction?.faction_name || 'No Faction'} — ${d.faction?.position || ''}</span>
      </div>
      <div class="card-body">
        <div class="stats-grid">
          ${statTile(`<span id="level-display">${d.level}</span>`, 'Level')}
          ${statTile(d.age + 'd', 'Days Old')}
          ${statTile(d.awards, 'Awards')}
          ${statTile(d.honor, 'Honor')}
          ${statTile(d.karma, 'Karma')}
          ${statTile(d.friends, 'Friends')}
        </div>
        <div style="margin-top:1.25rem;">
          <div class="badge-label">Bars</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Life', lifeBar)}
            ${infoBadge('Energy', energyBar)}
            ${infoBadge('Nerve', nerveBar)}
            ${infoBadge('Happy', happyBar)}
          </div>
        </div>
        <div style="margin-top:1.25rem;">
          <div class="badge-label">Info</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Status', d.status?.description || 'Unknown')}
            ${infoBadge('Last Action', d.last_action?.relative || 'Unknown')}
            ${infoBadge('Revivable', d.revivable === 1 ? '✅ Yes' : '❌ No')}
            ${infoBadge('Revive Setting', d.revive_setting || 'Unknown')}
            ${infoBadge('Job', job)}
            ${infoBadge('Married', married)}
            ${infoBadge('Property', d.property || 'None')}
            ${infoBadge('Rank', d.rank || 'N/A')}
            ${infoBadge('Donator', d.donator === 1 ? '✅ Yes' : '❌ No')}
            ${infoBadge('True Level', '<span id="true-level-display">Loading...</span>')}
            ${infoBadge('Addiction Level', '<span id="addiction-display">Loading...</span>')}
          </div>
        </div>
        ${d.competition?.name ? `
        <div style="margin-top:1.25rem;">
          <div class="badge-label">Competition</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Event', d.competition.name)}
            ${infoBadge('Status', d.competition.status)}
            ${infoBadge('HP', `${d.competition.current_hp}/${d.competition.max_hp}`)}
          </div>
        </div>` : ''}
        ${d.personalstats ? `
        <div style="margin-top:1.25rem;">
          <div class="badge-label">Battle Stats</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Strength', formatNum(d.personalstats.strength))}
            ${infoBadge('Defense', formatNum(d.personalstats.defense))}
            ${infoBadge('Speed', formatNum(d.personalstats.speed))}
            ${infoBadge('Dexterity', formatNum(d.personalstats.dexterity))}
            ${infoBadge('Total', formatNum(d.personalstats.totalstats))}
          </div>
        </div>` : ''}
      </div>
    </div>`;
}

async function fetchLevelProgress(currentLevel) {
  try {
    const res = await fetch('/api/torn/levelprogress');
    const data = await res.json();
    if (!res.ok || !data.display) return;

    // Update level tile
    const levelEl = document.getElementById('level-display');
    if (levelEl) {
      levelEl.textContent = data.display;
      levelEl.title = `${data.progress ?? '?'}% to level ${currentLevel + 1}`;
    }

    // Update true level badge
    const trueEl = document.getElementById('true-level-display');
    if (trueEl) {
      const trueLevel = parseFloat(data.display);
      const isHolding = trueLevel >= currentLevel + 1;
      const levelsHeld = Math.floor(trueLevel) - currentLevel;

      if (isHolding) {
        trueEl.innerHTML = `
          <span style="color:#f0a500;font-weight:600;">${data.display}</span>
          <span style="color:#e74c3c;font-size:0.75rem;margin-left:0.3rem;">
            ⚠️ Holding ${levelsHeld} level${levelsHeld !== 1 ? 's' : ''}
          </span>`;
      } else {
        trueEl.innerHTML = `<span style="color:#2ecc71;">${data.display}</span>`;
      }
    }
  } catch { /* silent fail */ }
}

// ── Addiction Level ──────────────────────────────────────────────────────────
async function fetchAddictionLevel() {
  // Check if we have cached data from today
  const today = new Date().toDateString();
  const cachedData = localStorage.getItem('addictionLevelCache');
  const cachedDate = localStorage.getItem('addictionLevelCacheDate');
  
  if (cachedData && cachedDate === today) {
    // Use cached data
    const data = JSON.parse(cachedData);
    updateAddictionDisplay(data);
    return;
  }

  try {
    const res = await fetch('/api/torn/addiction', { credentials: 'include' });
    const data = await res.json();
    if (!res.ok || data.display === undefined || data.display === null) {
      // Clear loading text on failure
      const addictionEl = document.getElementById('addiction-display');
      if (addictionEl) {
        addictionEl.innerHTML = '—';
        console.error ('Failed to fetch addiction level:', data.error || 'Unknown error');
      }
      return;
    }

    // Cache the data for today
    localStorage.setItem('addictionLevelCache', JSON.stringify(data));
    localStorage.setItem('addictionLevelCacheDate', today);

    // Update addiction level badge
    updateAddictionDisplay(data);
  } catch {
    // Clear loading text on error
    const addictionEl = document.getElementById('addiction-display');
    if (addictionEl) {
      addictionEl.innerHTML = '—';
      console.error('Failed to fetch addiction level: network or parse error');
    }
  }
}

function updateAddictionDisplay(data) {
  const addictionEl = document.getElementById('addiction-display');
  if (addictionEl) {
    const addictionLevel = parseInt(data.display);
    const color = addictionLevel > 0 ? '#ff4444' : '#2ecc71';
    const status = addictionLevel > 0 ? '⚠️ Addicted' : '✅ Clean';
    
    addictionEl.innerHTML = `
      <span style="color:${color};font-weight:600;">${data.display}</span>
      <span style="color:#888;font-size:0.75rem;margin-left:0.3rem;">${status}</span>`;
  }
}

// ── Honors, Merits & Awards ───────────────────────────────────────────────────
async function fetchHonors() {
  const container = document.getElementById('honors-data');
  container.innerHTML = '<div class="channel-loading">LOADING HONORS & MERITS...</div>';
  try {
    const res = await fetch('/api/torn/honors');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderHonors(data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

let honorsCache = null;

function renderHonors(data) {
  honorsCache = data;
  const filterEl = document.getElementById('honors-filter');
  const sortEl = document.getElementById('honors-sort');
  const filter = filterEl ? filterEl.value : 'all';
  const sort = sortEl ? sortEl.value : 'earned-first';
  renderHonorsTable(data, filter, sort);
}

function filterHonors() {
  if (honorsCache) renderHonors(honorsCache);
}

function renderHonorsTable(data, filter = 'all', sort = 'earned-first') {
  const container = document.getElementById('honors-table-container');
  const awarded = new Set(data.honors_awarded || []);
  const allHonors = data.all_honors || {};
  const merits = data.merits || {};

  const rarityOrder = {
    'Extremely Rare': 0, 'Very Rare': 1, 'Rare': 2,
    'Limited': 3, 'Uncommon': 4, 'Common': 5, 'Very Common': 6
  };
  const rarityColor = {
    'Very Common': '#888', 'Common': '#4caf50', 'Uncommon': '#4a90e2',
    'Limited': '#9b59b6', 'Rare': '#f0a500', 'Very Rare': '#e67e22',
    'Extremely Rare': '#e74c3c'
  };

  let honorEntries = Object.entries(allHonors).filter(([, h]) => h.type !== 1);
  const earned = honorEntries.filter(([id]) => awarded.has(parseInt(id)));
  const totalPct = honorEntries.length > 0 ? Math.round((earned.length / honorEntries.length) * 100) : 0;

  if (filter === 'earned') honorEntries = honorEntries.filter(([id]) => awarded.has(parseInt(id)));
  if (filter === 'unearned') honorEntries = honorEntries.filter(([id]) => !awarded.has(parseInt(id)));

  honorEntries.sort((a, b) => {
    const aE = awarded.has(parseInt(a[0]));
    const bE = awarded.has(parseInt(b[0]));
    const aRO = rarityOrder[a[1].rarity] ?? 99;
    const bRO = rarityOrder[b[1].rarity] ?? 99;
    switch (sort) {
      case 'earned-first': return aE !== bE ? (bE ? 1 : -1) : aRO - bRO;
      case 'unearned-first': return aE !== bE ? (aE ? 1 : -1) : aRO - bRO;
      case 'rarity-asc': return aRO !== bRO ? aRO - bRO : (a[1].name || '').localeCompare(b[1].name || '');
      case 'rarity-desc': return aRO !== bRO ? bRO - aRO : (a[1].name || '').localeCompare(b[1].name || '');
      case 'name': return (a[1].name || '').localeCompare(b[1].name || '');
      default: return 0;
    }
  });

  const honorRows = honorEntries.map(([id, honor]) => {
    const isEarned = awarded.has(parseInt(id));
    const color = rarityColor[honor.rarity] || '#888';
    return `<tr style="opacity:${isEarned ? '1' : '0.35'};">
      <td style="width:24px;">${isEarned ? '✅' : '⬜'}</td>
      <td>${escapeHtml(honor.name || 'Unknown')}</td>
      <td style="color:#888;font-size:0.8rem;">${escapeHtml(honor.description || '')}</td>
      <td style="text-align:center;"><span style="color:${color};font-size:0.78rem;">${honor.rarity || '—'}</span></td>
    </tr>`;
  }).join('');

  const meritRows = Object.entries(merits).map(([key, val]) => {
    const maxVal = 10;
    const pct = Math.min(Math.round((val / maxVal) * 100), 100);
    const color = val >= maxVal ? '#4caf50' : val > 0 ? '#f0a500' : '#444';
    return `<tr>
      <td>${formatMeritName(key)}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${val}/${maxVal}</td>
      <td style="width:120px;">
        <div style="background:#2a2828;border-radius:4px;height:8px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;"></div>
        </div>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        Honors & Awards
        <span style="float:right;font-size:0.8rem;color:#888;">${earned.length} / ${Object.entries(allHonors).filter(([, h]) => h.type !== 1).length} &nbsp;(${totalPct}%)</span>
      </div>
      <div style="background:#2a2828;border-radius:4px;height:8px;margin:0 1rem 1rem;overflow:hidden;">
        <div style="width:${totalPct}%;height:100%;background:#4caf50;border-radius:4px;"></div>
      </div>
      <div style="overflow-x:auto;max-height:500px;overflow-y:auto;">
        <table class="members-table">
          <thead><tr><th style="width:24px;"></th><th>Name</th><th>Description</th><th style="text-align:center;">Rarity</th></tr></thead>
          <tbody>${honorRows || '<tr><td colspan="4" class="muted" style="padding:1rem;">No data</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-header">Merits</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr><th>Merit</th><th style="text-align:center;">Progress</th><th style="width:120px;">Bar</th></tr></thead>
          <tbody>${meritRows || '<tr><td colspan="3" class="muted" style="padding:1rem;">No merit data</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Crime XP ──────────────────────────────────────────────────────────────────
async function fetchCrimeExp() {
  const container = document.getElementById('crime-exp-data');
  container.innerHTML = '<div class="channel-loading">LOADING CRIME XP...</div>';
  try {
    const res = await fetch('/api/torn/crimeexp');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderCrimeExp(data.merits || data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderCrimeExp(merits) {
  const crimeKeys = Object.entries(merits).filter(([key]) =>
    key.toLowerCase().includes('crime') ||
    key.toLowerCase().includes('theft') ||
    key.toLowerCase().includes('fraud') ||
    key.toLowerCase().includes('scam') ||
    key.toLowerCase().includes('bootlegging') ||
    key.toLowerCase().includes('graffiti') ||
    key.toLowerCase().includes('shoplift') ||
    key.toLowerCase().includes('pickpocket') ||
    key.toLowerCase().includes('card') ||
    key.toLowerCase().includes('counterfeiting') ||
    key.toLowerCase().includes('disposal') ||
    key.toLowerCase().includes('cracking') ||
    key.toLowerCase().includes('traffic') ||
    key.toLowerCase().includes('murder') ||
    key.toLowerCase().includes('assassination')
  );

  const rows = (crimeKeys.length > 0 ? crimeKeys : Object.entries(merits)).map(([key, val]) => `
    <tr>
      <td>${formatMeritName(key)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${val}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <div class="card-header">Crime Merits</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr><th>Crime Type</th><th style="text-align:right;">XP / Level</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function formatMeritName(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ═══════════════════════════════════════════════════════════════════════════════
// RACING STATS — dashboard.js additions
// Add these functions to your existing dashboard.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Track ID to Name lookup table ─────────────────────────────────────────────
// UPDATE THESE ONCE YOU HAVE CONFIRMED THE MAPPING FROM THE TRACK SELECT SCREEN
const TRACK_NAMES = {
  6: 'Uptown',
  7: 'Withdrawal',
  8: 'Underdog',
  9: 'Parkland',
  10: 'Docks',
  11: 'Commerce',
  12: 'Two Islands',
  15: 'Industrial',
  16: 'Vector',
  17: 'Mudpit',
  18: 'Hammerhead',
  19: 'Sewage',
  20: 'Meltdown',
  21: 'Speedway',
  23: 'Stone Park',
  24: 'Convict',
};

function getTrackName(id) {
  return TRACK_NAMES[id] || `Track ${id}`;
}

// ── Fetch Racing Stats ─────────────────────────────────────────────────────────
async function fetchRacingStats() {
  const container = document.getElementById('racing-stats-data');
  const limitEl = document.getElementById('racing-limit');
  const limit = Math.min(Math.max(parseInt(limitEl?.value) || 100, 1), 1000);

  container.innerHTML = '<div class="channel-loading">LOADING RACING STATS...</div>';

  try {
    const res = await fetch(`/api/torn/races?limit=${limit}`);
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }

    const result = renderRacingStats(data.races || [], data.player_id);
    container.innerHTML = result.html;

    // Correct the input box to show actual races participated in
    if (limitEl) { limitEl.value = result.totalRaces; }

  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

// ── Render Racing Stats ────────────────────────────────────────────────────────
function renderRacingStats(races, playerId) {
  if (!races.length) {
    return { html: '<div class="empty-state"><p class="muted">No race data found.</p></div>', totalRaces: 0 };
  }

  // ── Extract my results from each race ───────────────────────────────────────
  const myResults = races.map(race => {
    const myResult = race.results?.find(r => r.driver_id === playerId);
    if (!myResult) return null;
    return {
      race_id: race.id,
      title: race.title,
      track_id: race.track_id,
      track_name: getTrackName(race.track_id),
      laps: race.laps,
      participants: race.participants?.current || 0,
      date: race.schedule?.end ? new Date(race.schedule.end * 1000) : null,
      position: myResult.position,
      car_name: myResult.car_item_name,
      car_class: myResult.car_class,
      has_crashed: myResult.has_crashed,
      best_lap_time: myResult.best_lap_time,
      race_time: myResult.race_time,
    };
  }).filter(Boolean);

  if (!myResults.length) {
    return { html: '<div class="empty-state"><p class="muted">No personal results found in race data.</p></div>', totalRaces: 0 };
  }

  // ── Win/Loss Summary ─────────────────────────────────────────────────────────
  const totalRaces = myResults.length;
  const wins = myResults.filter(r => r.position === 1).length;
  const podiums = myResults.filter(r => r.position <= 3).length;
  const crashes = myResults.filter(r => r.has_crashed).length;
  const avgPosition = (myResults.reduce((s, r) => s + r.position, 0) / totalRaces).toFixed(1);
  const winRate = ((wins / totalRaces) * 100).toFixed(1);

  // ── Track Breakdown ──────────────────────────────────────────────────────────
  const trackMap = {};
  myResults.forEach(r => {
    if (!trackMap[r.track_id]) {
      trackMap[r.track_id] = { name: r.track_name, races: 0, wins: 0, podiums: 0, crashes: 0, positions: [], bestLap: null };
    }
    const t = trackMap[r.track_id];
    t.races++;
    if (r.position === 1) { t.wins++; }
    if (r.position <= 3) { t.podiums++; }
    if (r.has_crashed) { t.crashes++; }
    t.positions.push(r.position);
    if (r.best_lap_time && (!t.bestLap || r.best_lap_time < t.bestLap)) {
      t.bestLap = r.best_lap_time;
    }
  });

  const trackRows = Object.entries(trackMap)
    .sort((a, b) => b[1].races - a[1].races)
    .map(([id, t]) => {
      const avgPos = (t.positions.reduce((s, p) => s + p, 0) / t.positions.length).toFixed(1);
      const winPct = ((t.wins / t.races) * 100).toFixed(0);
      return `<tr>
        <td>${escapeHtml(t.name)}</td>
        <td style="text-align:center;">${t.races}</td>
        <td style="text-align:center;color:#f0c040;">${t.wins}</td>
        <td style="text-align:center;">${t.podiums}</td>
        <td style="text-align:center;">${avgPos}</td>
        <td style="text-align:center;">${winPct}%</td>
        <td style="text-align:center;">${t.crashes > 0 ? `<span style="color:#ff4444;">${t.crashes}</span>` : '0'}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${t.bestLap ? formatLapTime(t.bestLap) : '—'}</td>
      </tr>`;
    }).join('');

  // Car Performance
  const carMap = {};
  myResults.forEach(r => {
    const key = `${r.car_name}||${r.car_class}`;
    if (!carMap[key]) {
      carMap[key] = { name: r.car_name, cls: r.car_class, races: 0, wins: 0, podiums: 0, crashes: 0, positions: [], bestLap: null, winTracks: [] };
    }
    const c = carMap[key];
    c.races++;
    if (r.position === 1) {
      c.wins++;
      if (!c.winTracks.includes(r.track_name)) { c.winTracks.push(r.track_name); }
    }
    if (r.position <= 3) { c.podiums++; }
    if (r.has_crashed) { c.crashes++; }
    c.positions.push(r.position);
    if (r.best_lap_time && (!c.bestLap || r.best_lap_time < c.bestLap)) { c.bestLap = r.best_lap_time; }
  });

  const carRows = Object.entries(carMap)
    .sort((a, b) => b[1].races - a[1].races)
    .map(([key, c]) => {
      const avgPos = (c.positions.reduce((s, p) => s + p, 0) / c.positions.length).toFixed(1);
      const winPct = ((c.wins / c.races) * 100).toFixed(0);
      const winTracks = c.winTracks.length > 0 ? c.winTracks.join(', ') : '—';
      return `<tr>
        <td>${escapeHtml(c.name)}</td>
        <td style="text-align:center;">${c.cls}</td>
        <td style="text-align:center;">${c.races}</td>
        <td style="text-align:center;color:#f0c040;">${c.wins}</td>
        <td style="text-align:center;">${c.podiums}</td>
        <td style="text-align:center;">${avgPos}</td>
        <td style="text-align:center;">${winPct}%</td>
        <td style="text-align:center;">${c.crashes > 0 ? `<span style="color:#ff4444;">${c.crashes}</span>` : '0'}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${c.bestLap ? formatLapTime(c.bestLap) : '—'}</td>
        <td style="font-size:0.85rem;color:#888;">${escapeHtml(winTracks)}</td>
      </tr>`;
    }).join('');

  // ── Best Lap Times ───────────────────────────────────────────────────────────
  const bestLaps = myResults
    .filter(r => r.best_lap_time)
    .sort((a, b) => a.best_lap_time - b.best_lap_time)
    .slice(0, 10)
    .map(r => `<tr>
      <td>${escapeHtml(r.track_name)}</td>
      <td>${escapeHtml(r.car_name)}</td>
      <td style="text-align:center;">${r.car_class}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#44ff99;">${formatLapTime(r.best_lap_time)}</td>
      <td style="text-align:center;">${r.date ? r.date.toLocaleDateString() : '—'}</td>
    </tr>`).join('');

  // ── Crash History ────────────────────────────────────────────────────────────
  const crashList = myResults
    .filter(r => r.has_crashed)
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, 20)
    .map(r => `<tr>
      <td>${escapeHtml(r.track_name)}</td>
      <td>${escapeHtml(r.car_name)}</td>
      <td style="text-align:center;">${r.car_class}</td>
      <td style="text-align:center;">${r.position} / ${r.participants}</td>
      <td style="text-align:center;">${r.date ? r.date.toLocaleDateString() : '—'}</td>
    </tr>`).join('');

  const html = `
    <!-- Summary -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">🏎️ Racing Summary <span style="float:right;font-size:0.8rem;color:#555;">${totalRaces} races loaded</span></div>
      <div class="card-body">
        <div class="stats-grid">
          ${statTile(totalRaces, 'Races')}
          ${statTile(wins, 'Wins')}
          ${statTile(podiums, 'Podiums')}
          ${statTile(winRate + '%', 'Win Rate')}
          ${statTile(avgPosition, 'Avg Position')}
          ${statTile(crashes, 'Crashes')}
        </div>
      </div>
    </div>

    <!-- Track Breakdown -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">🗺️ Track Breakdown</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr>
            <th>Track</th>
            <th style="text-align:center;">Races</th>
            <th style="text-align:center;">Wins</th>
            <th style="text-align:center;">Podiums</th>
            <th style="text-align:center;">Avg Pos</th>
            <th style="text-align:center;">Win %</th>
            <th style="text-align:center;">Crashes</th>
            <th style="text-align:center;">Best Lap</th>
          </tr></thead>
          <tbody>${trackRows || '<tr><td colspan="8" class="muted" style="padding:1rem;">No data</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <!-- Car Performance -->
      <div class="badge-label" style="margin-bottom:0.5rem;">🚗 Car Performance</div>
      <div style="overflow-x:auto;margin-bottom:1.5rem;">
        <table class="members-table">
          <thead><tr>
            <th>Car</th>
            <th style="text-align:center;">Class</th>
            <th style="text-align:center;">Races</th>
            <th style="text-align:center;">Wins</th>
            <th style="text-align:center;">Podiums</th>
            <th style="text-align:center;">Avg Pos</th>
            <th style="text-align:center;">Win %</th>
            <th style="text-align:center;">Crashes</th>
            <th style="text-align:center;">Best Lap</th>
            <th>Win Tracks</th>
          </tr></thead>
          <tbody>${carRows || '<tr><td colspan="9" class="muted" style="padding:1rem;">No data</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <!-- Best Lap Times -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">⏱️ Top 10 Best Lap Times</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr>
            <th>Track</th>
            <th>Car</th>
            <th style="text-align:center;">Class</th>
            <th style="text-align:center;">Best Lap</th>
            <th style="text-align:center;">Date</th>
          </tr></thead>
          <tbody>${bestLaps || '<tr><td colspan="5" class="muted" style="padding:1rem;">No data</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <!-- Crash History -->
    <div class="card">
      <div class="card-header">💥 Crash History <span style="float:right;font-size:0.8rem;color:#555;">(last 20)</span></div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr>
            <th>Track</th>
            <th>Car</th>
            <th style="text-align:center;">Class</th>
            <th style="text-align:center;">Finished</th>
            <th style="text-align:center;">Date</th>
          </tr></thead>
          <tbody>${crashList || '<tr><td colspan="5" class="muted" style="padding:1rem;">No crashes recorded 🎉</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  return { html, totalRaces };
}

// ── Format lap time from seconds to MM:SS.ms ──────────────────────────────────
function formatLapTime(seconds) {
  if (!seconds) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(2).padStart(5, '0');
  return mins > 0 ? `${mins}:${secs}` : `${secs}s`;
}


// ── Faction Stats ─────────────────────────────────────────────────────────────
async function fetchFaction() {
  const container = document.getElementById('faction-data');
  container.innerHTML = '<div class="channel-loading">LOADING FACTION DATA...</div>';
  try {
    const requests = [
      fetch('/api/torn/faction'),
      fetch('/api/torn/faction-travel')
    ];
    if (IS_LEADERSHIP) requests.push(fetch('/api/admin/member-stats'));

    const [factionRes, travelRes, statsRes] = await Promise.allSettled(requests);

    const data = factionRes.status === 'fulfilled' ? await factionRes.value.json() : {};
    const travelData = travelRes.status === 'fulfilled' ? await travelRes.value.json() : {};
    const statsData = statsRes?.status === 'fulfilled' ? await statsRes.value.json() : {};

    if (!data.basic) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }

    const statsMap = {};
    if (IS_LEADERSHIP) {
      (statsData.stats || []).forEach(s => { statsMap[s.player_id] = s; });
    }

    const travelMap = {};
    (travelData.traveling || []).forEach(t => { travelMap[t.id] = t; });

    container.innerHTML = renderFaction(data, statsMap, travelMap);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderFaction(d, statsMap = {}, travelMap = {}) {
  const basic = d.basic;
  const members = d.members || [];
  const hasStats = Object.keys(statsMap).length > 0;

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'War Lord': 4,
    'Team Strategy': 5, 'Team Strength': 6, 'Team Growth': 7, 'Recruit': 8
  };

  const memberRows = members
    .sort((a, b) => {
      const aO = positionOrder[a.position] ?? 99;
      const bO = positionOrder[b.position] ?? 99;
      if (aO !== bO) return aO - bO;
      return (b.level || 0) - (a.level || 0);
    })
    .map(m => {
      const status = m.last_action?.status || 'Offline';
      const statusClass = `status-${status.toLowerCase()}`;
      const memberStats = statsMap[m.id];
      const totalStats = memberStats ? formatNum(memberStats.totalstats) : '—';

      const travelInfo = travelMap[m.id];
      let travelCell = '🏠 Torn';

      if (m.status?.state === 'Traveling') {
        const isReturning = m.status?.description?.toLowerCase().includes('returning');
        if (travelInfo?.travel?.time_left > 0) {
          travelCell = isReturning
            ? `🔄 ${formatTimeLeft(travelInfo.travel.time_left)}`
            : `✈️ ${formatTimeLeft(travelInfo.travel.time_left)}`;
        } else if (travelInfo?.travel) {
          travelCell = isReturning ? '🔄 Landing soon' : '🛬 Landing soon';
        } else {
          travelCell = isReturning ? '🔄 Returning' : '✈️ Traveling';
        }
      } else if (m.status?.state === 'Abroad') {
        travelCell = '🌍 Abroad';
      }

      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${m.level || '—'}</td>
        <td>${m.position || '—'}</td>
        <td class="${statusClass}">${status}</td>
        <td>${m.days_in_faction ?? '—'}d</td>
        <td>${m.revive_setting || '—'}</td>
        ${hasStats ? `<td style="font-family:'Share Tech Mono',monospace;font-size:0.85rem;">${totalStats}</td>` : ''}
        <td style="font-size:0.85rem;">${travelCell}</td>
      </tr>`;
    }).join('');

  return `
    <div class="stats-grid" style="margin-bottom:1.5rem;">
      ${statTile(basic.name, 'Faction')}
      ${statTile(basic.members, 'Members')}
      ${statTile(formatNum(basic.respect), 'Respect')}
      ${statTile(`${basic.rank.name} D${basic.rank.division}`, 'Rank')}
    </div>
    <div class="card">
      <div class="card-header">Member Roster</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr>
            <th>Name</th><th>Level</th><th>Position</th><th>Status</th><th>Days</th><th>Revive</th>
            ${hasStats ? '<th>Total Stats</th>' : ''}
            <th>Travel</th>
          </tr></thead>
          <tbody>${memberRows || '<tr><td colspan="8" class="muted" style="padding:1rem;">No member data</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Travel ────────────────────────────────────────────────────────────────────
async function fetchTravel() {
  const container = document.getElementById('travel-status');
  container.innerHTML = '<div class="channel-loading">LOADING TRAVEL STATUS...</div>';
  try {
    const res = await fetch('/api/torn/travel');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderTravelStatus(data.travel || data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderTravelStatus(t) {
  if (!t || t.destination === 'Torn') {
    return `
      <div class="card">
        <div class="card-body">
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Status', '🏠 In Torn')}
            ${infoBadge('Destination', 'Home')}
          </div>
        </div>
      </div>`;
  }

  const arrivalTime = t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : 'Unknown';
  const isReturning = t.destination === 'Torn';

  return `
    <div class="card">
      <div class="card-header">✈️ Currently Traveling</div>
      <div class="card-body">
        <div style="display:flex;gap:1rem;flex-wrap:wrap;">
          ${infoBadge('Destination', t.destination || 'Unknown')}
          ${infoBadge('Departure', t.departed || 'Unknown')}
          ${infoBadge('Arriving', arrivalTime)}
          ${infoBadge('Direction', isReturning ? '🏠 Returning' : '✈️ Departing')}
        </div>
      </div>
    </div>`;
}

function formatTimeLeft(seconds) {
  if (seconds <= 0) return '🛬 Landing soon';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── YATA Foreign Stock ────────────────────────────────────────────────────────
let yataStockCache = null;
let itemCatalogCache = null;

async function fetchItemCatalog() {
  if (itemCatalogCache) return itemCatalogCache;
  try {
    const res = await fetch('/api/torn/items');
    const data = await res.json();
    if (res.ok && data.items) {
      itemCatalogCache = {};
      Object.entries(data.items).forEach(([id, item]) => {
        itemCatalogCache[id] = item.type;
      });
    }
  } catch (err) {
    console.error('Could not fetch item catalog:', err);
  }
  return itemCatalogCache || {};
}

async function fetchYataStock() {
  const container = document.getElementById('yata-stock-data');
  container.innerHTML = '<div class="channel-loading">LOADING FOREIGN STOCK...</div>';
  try {
    const [stockRes, catalog] = await Promise.all([
      fetch('/api/yata/travel'),
      fetchItemCatalog()
    ]);
    const data = await stockRes.json();
    if (!stockRes.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    yataStockCache = { data, catalog };
    const selectedCountry = document.getElementById('travel-country-select').value;
    const selectedSort = document.getElementById('stock-sort').value;
    renderYataStock(data, catalog, selectedCountry, selectedSort);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function filterStockByCountry(countryCode) {
  if (yataStockCache) {
    const selectedSort = document.getElementById('stock-sort').value;
    renderYataStock(yataStockCache.data, yataStockCache.catalog, countryCode, selectedSort);
  } else {
    fetchYataStock();
  }
}

function sortStock() {
  if (yataStockCache) {
    const selectedCountry = document.getElementById('travel-country-select').value;
    const selectedSort = document.getElementById('stock-sort').value;
    renderYataStock(yataStockCache.data, yataStockCache.catalog, selectedCountry, selectedSort);
  }
}

function renderYataStock(data, catalog, filterCountry = '', sortBy = 'type') {
  const container = document.getElementById('yata-stock-data');

  const countryNames = {
    mex: 'Mexico', cay: 'Cayman Islands', can: 'Canada',
    haw: 'Hawaii', uni: 'United Kingdom', arg: 'Argentina',
    swi: 'Switzerland', jap: 'Japan', chi: 'China',
    uae: 'UAE', sou: 'South Africa'
  };

  const stockData = data.stocks || {};
  let entries = Object.entries(stockData);
  if (filterCountry) entries = entries.filter(([code]) => code === filterCountry);

  if (!entries.length) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">🛍️</span><p>No stock data available.</p></div>';
    return;
  }

  const html = entries.map(([code, country]) => {
    const name = countryNames[code] || code;
    const items = (country.stocks || []).filter(item => item.quantity > 0);
    const lastUpdate = country.update ? new Date(country.update * 1000).toLocaleTimeString() : 'Unknown';

    if (!items.length) return `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">${name} <span style="float:right;font-size:0.75rem;color:#555;">Updated: ${lastUpdate}</span></div>
        <div class="card-body"><p class="muted">No items in stock.</p></div>
      </div>`;

    const sorted = [...items].sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'quantity': return b.quantity - a.quantity;
        case 'cost': return b.cost - a.cost;
        case 'type':
        default: {
          const typeA = catalog?.[a.id] || 'ZZZ';
          const typeB = catalog?.[b.id] || 'ZZZ';
          if (typeA !== typeB) return typeA.localeCompare(typeB);
          return a.name.localeCompare(b.name);
        }
      }
    });

    const itemRows = sorted.map(item => {
      const category = catalog?.[item.id] || '—';
      return `<tr>
        <td>${item.name}</td>
        <td style="color:#888;font-size:0.85rem;">${category}</td>
        <td style="text-align:center;">${item.quantity.toLocaleString()}</td>
        <td style="text-align:right;font-family:'Share Tech Mono',monospace;">$${formatNum(item.cost)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">${name} <span style="float:right;font-size:0.75rem;color:#555;">Updated: ${lastUpdate}</span></div>
        <div style="overflow-x:auto;">
          <table class="members-table">
            <thead><tr><th>Item</th><th>Type</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Cost</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = html;
}

// ── War Stats ─────────────────────────────────────────────────────────────────
async function fetchWarStats() {
  const container = document.getElementById('war-stats-data');
  container.innerHTML = '<div class="channel-loading">LOADING WAR STATS...</div>';
  try {
    const res = await fetch('/api/torn/wars');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderWarStats(data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderWarStats(data) {
  const war = data.war;
  const memberHits = data.memberHits || [];

  if (!war) {
    return `<div class="card"><div class="card-body"><p class="muted">No active ranked war found.</p></div></div>`;
  }

  const ssgFaction = war.factions?.find(f => f.id === 53272);
  const enemyFaction = war.factions?.find(f => f.id !== 53272);
  const warStart = war.start ? new Date(war.start * 1000).toLocaleString() : '—';

  const hitRows = memberHits.map((m, i) => `
    <tr>
      <td style="color:#555;font-size:0.8rem;">${i + 1}</td>
      <td>${escapeHtml(m.name)}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${m.hits}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${m.respect.toFixed(2)}</td>
    </tr>`).join('');

  return `
    <div class="stats-grid" style="margin-bottom:1.5rem;">
      ${statTile(ssgFaction?.score ?? '—', 'SSG Score')}
      ${statTile(enemyFaction?.score ?? '—', `${enemyFaction?.name ?? 'Enemy'} Score`)}
      ${statTile(war.target || '—', 'Target Score')}
      ${statTile(data.totalWarAttacks, 'Total Hits')}
    </div>
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        ⚔️ vs ${escapeHtml(enemyFaction?.name || 'Unknown')}
        <span style="float:right;font-size:0.8rem;color:#888;">Started: ${warStart}</span>
      </div>
    </div>
    <div class="card">
      <div class="card-header">Member Hits</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr><th>#</th><th>Member</th><th style="text-align:center;">Hits</th><th style="text-align:right;">Respect Earned</th></tr></thead>
          <tbody>${hitRows || '<tr><td colspan="4" class="muted" style="padding:1rem;">No war hits found.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Admin Member Overview ─────────────────────────────────────────────────────
let overviewData = [];
let overviewSortCol = 'position';
let overviewSortAsc = true;

async function fetchMemberOverview() {
  const container = document.getElementById('admin-overview-data');
  container.innerHTML = '<div class="channel-loading">LOADING MEMBER OVERVIEW... (this may take a moment)</div>';
  try {
    const res = await fetch('/api/admin/member-overview');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    overviewData = data.members || [];
    renderMemberOverview();
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function sortOverview(col) {
  if (overviewSortCol === col) {
    overviewSortAsc = !overviewSortAsc;
  } else {
    overviewSortCol = col;
    overviewSortAsc = true;
  }
  renderMemberOverview();
}

function renderMemberOverview() {
  const container = document.getElementById('admin-overview-data');
  if (!overviewData.length) {
    container.innerHTML = '<div class="empty-state"><p class="muted">No member data found.</p></div>';
    return;
  }

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'War Lord': 4,
    'Team Strategy': 5, 'Team Strength': 6, 'Team Growth': 7, 'Recruit': 8
  };

  const sorted = [...overviewData].sort((a, b) => {
    let aVal, bVal;
    switch (overviewSortCol) {
      case 'name':
        aVal = a.name?.toLowerCase() || '';
        bVal = b.name?.toLowerCase() || '';
        break;
      case 'position':
        aVal = positionOrder[a.position] ?? 99;
        bVal = positionOrder[b.position] ?? 99;
        break;
      case 'property':
        aVal = a.property?.toLowerCase() || 'zzz';
        bVal = b.property?.toLowerCase() || 'zzz';
        break;
      case 'job':
        aVal = a.job?.company_name?.toLowerCase() || 'zzz';
        bVal = b.job?.company_name?.toLowerCase() || 'zzz';
        break;
      case 'energy':
        aVal = a.energy?.current ?? -1;
        bVal = b.energy?.current ?? -1;
        break;
      case 'medical':
        aVal = a.cooldowns?.medical ?? -1;
        bVal = b.cooldowns?.medical ?? -1;
        break;
      case 'lastaction':
        aVal = a.tornLastAction?.timestamp ?? a.last_action?.timestamp ?? 0;
        bVal = b.tornLastAction?.timestamp ?? b.last_action?.timestamp ?? 0;
        break;
      case 'lastseen':
        aVal = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
        bVal = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        break;
      default:
        aVal = a.name?.toLowerCase() || '';
        bVal = b.name?.toLowerCase() || '';
    }
    if (typeof aVal === 'string') {
      return overviewSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return overviewSortAsc ? aVal - bVal : bVal - aVal;
  });

  const arrow = col => overviewSortCol === col ? (overviewSortAsc ? ' ▲' : ' ▼') : '';

  const rows = sorted.map((m, i) => {
    const property = m.property || '—';

    const job = m.job
      ? `${escapeHtml(m.job.position)}<br><span style="color:#555;font-size:0.78rem;">${escapeHtml(m.job.company_name)}</span>`
      : '—';

    const energyDisplay = m.energy ? `${m.energy.current}/${m.energy.maximum}` : '—';
    const isDonator = m.energy?.maximum >= 150;
    const donatorBadge = m.energy
      ? `<span style="font-size:0.7rem;color:${isDonator ? '#f0a500' : '#555'};margin-left:0.3rem;">${isDonator ? '★' : '○'}</span>`
      : '';

    const drugCD = m.cooldowns
      ? (m.cooldowns.drug > 0
        ? `<span title="Drug cooldown: ${formatCooldown(m.cooldowns.drug)}" style="cursor:help;color:#e74c3c;">💊 ${formatCooldown(m.cooldowns.drug)}</span>`
        : `<span style="color:#2ecc71;">💊 Ready</span>`)
      : '—';

    const boosterCD = m.cooldowns
      ? (m.cooldowns.booster > 0
        ? `<span style="color:#e67e22;">⚡ ${formatCooldown(m.cooldowns.booster)}</span>`
        : `<span style="color:#2ecc71;">⚡ Ready</span>`)
      : '—';

    const energyCell = m.energy || m.cooldowns ? `
      <div>${energyDisplay}${donatorBadge}</div>
      <div style="font-size:0.78rem;margin-top:0.2rem;">${drugCD}</div>
      <div style="font-size:0.78rem;">${boosterCD}</div>
    ` : '—';

    const medicalCell = m.cooldowns
      ? (m.cooldowns.medical > 0
        ? `<span style="color:#e74c3c;">${formatCooldown(m.cooldowns.medical)}</span>`
        : `<span style="color:#2ecc71;">Ready</span>`)
      : '—';

    const lastActionTs = m.tornLastAction?.timestamp ?? m.last_action?.timestamp ?? null;
    const lastActionCell = lastActionTs ? formatLastAction(lastActionTs) : '—';
    const isStale = lastActionTs && (Date.now() / 1000 - lastActionTs) > 23 * 3600;
    const lastActionStyle = isStale ? 'color:#ff4444;font-weight:600;' : 'color:#a0a0a0;';

    const hasKey = m.hasApiKey ? '✅' : '❌';
    const keyUpdated = m.tornKeyUpdatedAt
      ? new Date(m.tornKeyUpdatedAt).toLocaleDateString()
      : m.lastSeen ? new Date(m.lastSeen).toLocaleDateString() : '—';
    const apiCell = `${hasKey}<br><span style="font-size:0.75rem;color:#555;">${keyUpdated}</span>`;

    const removeBtn = m.discordId
      ? `<button class="btn btn-small btn-danger" onclick="removeUser('${m.discordId}', '${escapeHtml(m.name)}')">Remove</button>`
      : '—';

    return `<tr>
      <td style="color:#555;font-size:0.8rem;text-align:center;">${i + 1}</td>
      <td>
        <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener"
          style="color:#a78df5;text-decoration:none;">${escapeHtml(m.name)}</a>
        <span style="color:#555;font-size:0.75rem;"> [${m.id}]</span>
      </td>
      <td style="font-size:0.85rem;">${m.position || '—'}</td>
      <td style="font-size:0.85rem;">${property}</td>
      <td style="font-size:0.85rem;">${job}</td>
      <td style="font-size:0.85rem;">${energyCell}</td>
      <td style="font-size:0.85rem;text-align:center;">${medicalCell}</td>
      <td style="font-size:0.85rem;${lastActionStyle}">${lastActionCell}</td>
      <td style="font-size:0.85rem;text-align:center;">${apiCell}</td>
      <td style="text-align:center;">${removeBtn}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="members-table overview-table">
        <thead>
          <tr>
            <th style="text-align:center;width:40px;">#</th>
            <th class="sortable" onclick="sortOverview('name')"       style="cursor:pointer;">Name${arrow('name')}</th>
            <th class="sortable" onclick="sortOverview('position')"   style="cursor:pointer;">Position${arrow('position')}</th>
            <th class="sortable" onclick="sortOverview('property')"   style="cursor:pointer;">Housing${arrow('property')}</th>
            <th class="sortable" onclick="sortOverview('job')"        style="cursor:pointer;">Job${arrow('job')}</th>
            <th class="sortable" onclick="sortOverview('energy')"     style="cursor:pointer;">Energy & Cooldowns${arrow('energy')}</th>
            <th class="sortable" onclick="sortOverview('medical')"    style="cursor:pointer;">Medical CD${arrow('medical')}</th>
            <th class="sortable" onclick="sortOverview('lastaction')" style="cursor:pointer;">Last Action${arrow('lastaction')}</th>
            <th class="sortable" onclick="sortOverview('lastseen')"   style="cursor:pointer;">API Key${arrow('lastseen')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:0.75rem;color:#444;margin-top:0.5rem;padding:0 0.5rem;">
      ★ = Donator &nbsp;|&nbsp; 💊 = Drug cooldown &nbsp;|&nbsp; ⚡ = Booster cooldown &nbsp;|&nbsp;
      <span style="color:#ff4444;">Red last action</span> = offline 23+ hours
    </p>`;
}

function formatCooldown(seconds) {
  if (!seconds || seconds <= 0) return 'Ready';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatLastAction(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60);
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(diff / 86400);

  if (diff < 3600) return `${minutes}m ago`;
  if (diff < 86400) return `${Math.round(hours)}h ago`;
  return `${days}d ago`;
}

function exportOverviewCSV() {
  if (!overviewData.length) {
    alert('No data to export. Please click Refresh first.');
    return;
  }

  const headers = [
    '#', 'Name', 'Torn ID', 'Position', 'Housing', 'Job Position',
    'Company', 'Energy', 'Max Energy', 'Donator',
    'Drug CD (seconds)', 'Booster CD (seconds)', 'Medical CD (seconds)',
    'Last Action', 'API Key Saved', 'Key Last Updated'
  ];

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'War Lord': 4,
    'Team Strategy': 5, 'Team Strength': 6, 'Team Growth': 7, 'Recruit': 8
  };

  const sorted = [...overviewData].sort((a, b) => {
    const aO = positionOrder[a.position] ?? 99;
    const bO = positionOrder[b.position] ?? 99;
    return aO !== bO ? aO - bO : a.name.localeCompare(b.name);
  });

  const rows = sorted.map((m, i) => {
    const lastActionTs = m.tornLastAction?.timestamp ?? m.last_action?.timestamp ?? null;
    const lastAction = lastActionTs ? formatLastAction(lastActionTs) : '—';
    const keyUpdated = m.tornKeyUpdatedAt ? new Date(m.tornKeyUpdatedAt).toLocaleDateString() : '—';

    return [
      i + 1,
      m.name,
      m.id,
      m.position || '—',
      m.property || '—',
      m.job?.position || '—',
      m.job?.company_name || '—',
      m.energy?.current ?? '—',
      m.energy?.maximum ?? '—',
      m.energy?.maximum >= 150 ? 'Yes' : 'No',
      m.cooldowns?.drug ?? '—',
      m.cooldowns?.booster ?? '—',
      m.cooldowns?.medical ?? '—',
      lastAction,
      m.hasApiKey ? 'Yes' : 'No',
      keyUpdated
    ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
  });

  const csv = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `SSG_Members_${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Member Total Stats ────────────────────────────────────────────────────────
async function fetchMemberStats() {
  const container = document.getElementById('admin-stats-data');
  container.innerHTML = '<div class="channel-loading">LOADING MEMBER STATS... (this may take a moment)</div>';
  try {
    const res = await fetch('/api/admin/member-stats');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderMemberStats(data.stats || []);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderMemberStats(stats) {
  if (!stats.length) {
    return '<div class="empty-state"><p class="muted">No members with saved API keys found.</p></div>';
  }

  const sorted = [...stats].sort((a, b) => (b.totalstats || 0) - (a.totalstats || 0));

  const rows = sorted.map((m, i) => `
    <tr>
      <td style="color:#555;font-size:0.8rem;">${i + 1}</td>
      <td>${escapeHtml(m.name)}</td>
      <td style="text-align:center;">${m.level || '—'}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNum(m.strength)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNum(m.defense)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNum(m.speed)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNum(m.dexterity)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;font-weight:600;">${formatNum(m.totalstats)}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <div class="card-header">Member Stats (${stats.length} members)</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr>
            <th>#</th><th>Name</th><th style="text-align:center;">Lvl</th>
            <th style="text-align:right;">STR</th>
            <th style="text-align:right;">DEF</th>
            <th style="text-align:right;">SPD</th>
            <th style="text-align:right;">DEX</th>
            <th style="text-align:right;">Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Remove User ───────────────────────────────────────────────────────────────
async function removeUser(discordId, name) {
  if (!confirm(`Are you sure you want to remove ${name} from the dashboard?\n\nThis will delete their record and API key. They will need to log in again to re-register.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/admin/user/${discordId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { alert(`❌ Error: ${data.error}`); return; }
    alert(`✅ ${data.removed} has been removed from the dashboard.`);
    fetchMemberOverview();
  } catch (err) {
    alert(`❌ Error: ${err.message}`);
  }
}

// ── Help Modal ────────────────────────────────────────────────────────────────
const HELP_CONTENT = {
  profile: {
    title: '👤 Profile',
    sections: [
      {
        heading: 'Your Profile',
        content: `
          <p class="help-text">The Profile page shows your Discord identity and SSG role assignments. This is also where you manage your Torn API key.</p>
          <img src="/images/profileimage.png" alt="Profile page" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Setting Up Your Torn API Key',
        content: `
          <div class="help-callout warning">⚠️ You must save a Torn API key to access Torn Stats, Faction, and Travel features.</div>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Go to <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" style="color:#a78df5;">torn.com → Preferences → API</a></div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Create a new key and set the access level to <strong style="color:#c0bcbc;">Full Access</strong></div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Copy the key and paste it into the Torn API Key field on your Profile page</div></div>
          <div class="help-step"><div class="help-step-num">4</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">Save Key</strong> — you'll see a confirmation with your Torn name</div></div>
          <div class="help-callout success">✅ Once saved, your key is stored securely and you won't need to enter it again.</div>
        `
      }
    ]
  },
  channels: {
    title: '💬 Channels',
    sections: [
      {
        heading: 'Viewing Discord Channels',
        content: `
          <p class="help-text">The Channels page lets you read recent messages from your accessible SSG Discord channels directly in the dashboard — no need to open Discord.</p>
          <img src="/images/channelsimage.png" alt="Channels feed" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'How To Use',
        content: `
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Select a channel from the dropdown at the top</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">The last 10 messages will load automatically</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">↻ Refresh</strong> to load the latest messages</div></div>
          <div class="help-callout">💡 You can only see channels that your SSG role gives you access to. Contact leadership if you think you're missing access.</div>
        `
      }
    ]
  },
  torn: {
    title: '🎮 Torn Stats',
    sections: [
      {
        heading: 'Your Torn Stats',
        content: `
          <p class="help-text">Displays your live Torn City player stats including level, bars, battle stats, and general info.</p>
          <div class="help-callout warning">⚠️ Requires a Full Access Torn API key saved in your Profile.</div>
          <img src="/images/tornstatsimage.png" alt="Torn stats" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Battle Stats',
        content: `
          <p class="help-text">Shows your Strength, Defense, Speed, Dexterity, and Total stats. These update in real time from the Torn API each time you click Refresh.</p>
        `
      },
      {
        heading: 'Honors & Awards',
        content: `
          <p class="help-text">Shows all Torn honors and your completion progress. Use the filter and sort dropdowns to find specific honors.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Use the <strong style="color:#c0bcbc;">Filter</strong> dropdown to show All, Earned only, or Not Earned</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Use the <strong style="color:#c0bcbc;">Sort</strong> dropdown to sort by rarity, name, or earned status</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">The progress bar at the top shows your overall completion percentage</div></div>
          <div class="help-callout">💡 Click <strong style="color:#c0bcbc;">Load</strong> to fetch your honors data. This loads on-demand to reduce API calls.</div>
        `
      },
      {
        heading: 'Merits',
        content: `
          <p class="help-text">Shows your merit progress with a progress bar for each merit. Green = maxed, orange = in progress, dark = not started.</p>
        `
      },
      {
        heading: 'Crime XP',
        content: `
          <p class="help-text">Shows your crime-related merit levels broken down by crime type. This includes all crime merits like theft, fraud, scams, bootlegging, and more.</p>
          <div class="help-callout">💡 Click <strong style="color:#c0bcbc;">Load</strong> to fetch your crime XP data. This loads on-demand to reduce API calls.</div>
        `
      },
      {
        heading: 'Racing Stats',
        content: `
          <p class="help-text">Shows your racing performance including wins, podiums, crashes, and detailed track breakdowns.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Set the number of races to analyze (1-1000) in the input field</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">Load</strong> to fetch your racing data</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Review your overall performance, track breakdown, car performance, and crash history</div></div>
          <div class="help-callout">💡 Data includes win rates, average positions, best lap times, and crash analysis.</div>
          <div class="help-callout">⚡ Lazy Loading: Racing stats load on-demand to reduce API calls and improve performance.</div>
        `
      }
    ]
  },
  faction: {
    title: '⚔️ Faction',
    sections: [
      {
        heading: 'Faction Overview',
        content: `
          <p class="help-text">Displays live SSG faction stats and the full member roster pulled directly from Torn.</p>
          <img src="/images/factionimage.png" alt="Faction roster" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Member Roster',
        content: `
          <p class="help-text">The roster shows each member's name, level, position, online status, days in faction, and revive setting. Members are sorted by position rank then level.</p>
          <div class="help-callout">💡 Status colors: <span style="color:#2ecc71;">Green = Online</span>, <span style="color:#444;">Grey = Offline</span>, <span style="color:#e67e22;">Orange = Hospital</span>, <span style="color:#ff4444;">Red = Jail</span>, <span style="color:#004cff;">Blue = Traveling</span></div>
        `
      },
      {
        heading: 'Travel Column',
        content: `
          <p class="help-text">The travel column indicates each member's current location and, if traveling, time left until arrival.</p>
          <ul style="color:#a0a0a0;font-size:0.9rem;line-height:2;padding-left:1.25rem;">
            <li>✈️ — traveling out</li>
            <li>🔄 — returning home</li>
            <li>🛬 — landing soon</li>
            <li>🏠 — in Torn</li>
            <li>🌍 — abroad</li>
          </ul>
          <div class="help-callout">💡 Time remaining only shown for members who have saved their API key.</div>
        `
      }
    ]
  },
  travel: {
    title: '✈️ Travel',
    sections: [
      {
        heading: 'Travel Status',
        content: `
          <p class="help-text">Shows your current travel status — whether you're in Torn, departing, or returning from abroad.</p>
          <img src="/images/travelimage.png" alt="Travel status" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      }
    ]
  },
  training: {
    title: '📚 Training',
    sections: [
      {
        heading: 'Training Resources',
        content: `
          <p class="help-text">The Training page gives you quick links to SSG's training channels in Discord. Click <strong style="color:#c0bcbc;">Open in Discord ↗</strong> on any card to jump directly to that channel.</p>
          <div class="help-callout warning">⚠️ You can only see training channels that your SSG role gives you access to.</div>
          <img src="/images/trainingimage.png" alt="Training resources" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Available Channels',
        content: `
          <div class="help-step"><div class="help-step-num">📊</div><div class="help-step-text"><strong style="color:#c0bcbc;">Stats Training</strong> — Advanced stat building guides. Available to Strategy and above.</div></div>
          <div class="help-step"><div class="help-step-num">💰</div><div class="help-step-text"><strong style="color:#c0bcbc;">Money Making Training</strong> — Guides on funding your stats growth. Available to Strategy and above.</div></div>
          <div class="help-step"><div class="help-step-num">⬆️</div><div class="help-step-text"><strong style="color:#c0bcbc;">Level Training</strong> — How to level up fast. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🔗</div><div class="help-step-text"><strong style="color:#c0bcbc;">Chains</strong> — How to do Chains. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🫆</div><div class="help-step-text"><strong style="color:#c0bcbc;">Crimes Training</strong> — Guide for Crimes. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🗝️</div><div class="help-step-text"><strong style="color:#c0bcbc;">Organized Crimes Training</strong> — Guide for OCs. Available to all members.</div></div>
        `
      }
    ]
  },
  bankRates: {
    title: '🏦 Bank Rates',
    sections: [
      {
        heading: 'Current Bank Interest Rates',
        content: `
          <p class="help-text">Shows the current interest rates for all bank time periods in Torn City. Rates are cached for 1 hour to reduce API calls.</p>
          <div class="help-callout">💡 Interest rates update periodically on Torn's servers. Click Refresh to get the latest rates.</div>
          <img src="/images/bankratesimage.png" alt="Bank rates" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Bank Calculator',
        content: `
          <p class="help-text">Use the calculator to see how much interest you'll earn by depositing money in the bank for different time periods.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Enter the amount you want to deposit in the input field</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">Calculate</strong> to see potential earnings for each time period</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Use <strong style="color:#c0bcbc;">Clear</strong> to reset the calculator</div></div>
          <div class="help-callout">💡 The calculator uses simple interest formula: Interest = Principal × Rate × Time</div>
          <div class="help-callout">💡 Rates are annual percentages. The calculator converts them to the appropriate time period.</div>
        `
      },
      {
        heading: 'API Key Setup Required',
        content: `
          <div class="help-callout warning">⚠️ Bank rates require a Torn API key with the "Bank" access level. Your current key does not have this permission.</div>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Go to <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" style="color:#a78df5;">torn.com → Preferences → API</a></div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Create a <strong style="color:#c0bcbc;">new API key</strong> (don't edit your existing one)</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Under <strong style="color:#c0bcbc;">"Access Levels"</strong>, select <strong style="color:#ff4444;">"Bank"</strong> (NOT "Full Access")</div></div>
          <div class="help-step"><div class="help-step-num">4</div><div class="help-step-text">Copy the new key and save it in your <strong style="color:#c0bcbc;">Profile</strong> section</div></div>
          <div class="help-callout">💡 You can have multiple API keys. Keep your current "Full Access" key for other features, and create a separate "Bank" key for this feature.</div>
          <div class="help-callout">💡 After saving the new key, refresh the Bank Rates page to see the data.</div>
        `
      }
    ]
  },
  admin: {
    title: '🛡️ Admin',
    sections: [
      {
        heading: 'Member Overview',
        content: `
          <p class="help-text">Shows all faction members with enriched data for those who have saved their API key — including housing, job, energy, cooldowns, and last action.</p>
          <div class="help-callout">💡 Click any column header to sort. Use Export CSV to download to Google Sheets.</div>
          <div class="help-callout warning">⚠️ This page makes API calls for every member with a saved key and may take several seconds to load.</div>
          <img src="/images/adminimage.png" alt="Admin overview" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Member Total Stats',
        content: `
          <p class="help-text">Shows battle stats for all members who have saved their Torn API key. Members are ranked by total stats descending.</p>
          <div class="help-callout">💡 Only members who have saved their API key in the dashboard will appear here.</div>
        `
      }
    ]
  }
};

let currentHelpSection = 'profile';

function openHelp(section) {
  currentHelpSection = section || 'profile';
  const modal = document.getElementById('help-modal');
  const tabsEl = document.getElementById('help-tabs');
  const titleEl = document.getElementById('help-modal-title');

  const content = HELP_CONTENT[currentHelpSection];
  if (!content) return;

  titleEl.textContent = content.title + ' — Help';

  tabsEl.innerHTML = Object.entries(HELP_CONTENT).map(([key, val]) =>
    `<button class="help-tab ${key === currentHelpSection ? 'active' : ''}"
      onclick="switchHelpTab('${key}')">${val.title}</button>`
  ).join('');

  renderHelpBody(currentHelpSection);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function switchHelpTab(section) {
  currentHelpSection = section;
  const content = HELP_CONTENT[section];
  if (!content) return;
  document.getElementById('help-modal-title').textContent = content.title + ' — Help';
  const tabs = document.querySelectorAll('.help-tab');
  tabs.forEach((t, i) => {
    const key = Object.keys(HELP_CONTENT)[i];
    t.classList.toggle('active', key === section);
  });
  renderHelpBody(section);
}

function renderHelpBody(section) {
  const content = HELP_CONTENT[section];
  const bodyEl = document.getElementById('help-modal-body');
  bodyEl.innerHTML = content.sections.map(s => `
    <div class="help-heading">${s.heading}</div>
    ${s.content}
  `).join('');
}

function closeHelp() {
  document.getElementById('help-modal').classList.remove('active');
  document.body.style.overflow = '';
}

function closeHelpOnBackdrop(e) {
  if (e.target === document.getElementById('help-modal')) closeHelp();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeHelp();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function statTile(value, label) {
  return `<div class="stat-tile"><div class="stat-value">${value ?? '—'}</div><div class="stat-label">${label}</div></div>`;
}

function infoBadge(label, value) {
  return `<div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.5rem 0.85rem;">
    <div style="font-size:0.7rem;color:#555;font-family:'Rajdhani',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">${label}</div>
    <div style="color:#c0bcbc;font-size:0.9rem;">${value}</div>
  </div>`;
}

function formatNum(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}



// ── Bank Rates ────────────────────────────────────────────────────────────────
async function fetchBankRates() {
  const container = document.getElementById('bank-rates-data');
  container.innerHTML = '<div class="channel-loading">LOADING BANK RATES...</div>';
  try {
    const res = await fetch('/api/torn/bank-rates');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    
    // Debug: Log the raw API response
    console.log('Bank Rates API Response:', data);
    console.log('Rates object:', data.rates);
    
    // Debug: Check if rates are all zero
    const rates = data.rates || {};
    const allZero = Object.values(rates).every(rate => rate === 0);
    if (allZero) {
      console.log('⚠️ All rates are zero - this indicates an API issue');
      console.log('Full API response for debugging:', data);
    }
    
    container.innerHTML = renderBankRates(data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderBankRates(data) {
  const rates = data.rates || {};
  const lastUpdated = data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'Unknown';
  
  const rateRows = [
    { period: '1 Week', key: '1_week', rate: rates['1_week'] },
    { period: '2 Weeks', key: '2_weeks', rate: rates['2_weeks'] },
    { period: '1 Month', key: '1_month', rate: rates['1_month'] },
    { period: '2 Months', key: '2_months', rate: rates['2_months'] },
    { period: '3 Months', key: '3_months', rate: rates['3_months'] }
  ];

  const rows = rateRows.map(r => {
    // API returns percentages directly, so just format them
    const percentage = r.rate.toFixed(2);
    return `
    <tr>
      <td>${r.period}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${percentage}%</td>
      <td style="text-align:right;color:#888;font-size:0.8rem;">${formatRateDescription(parseFloat(percentage))}</td>
    </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-header">Current Bank Interest Rates <span style="float:right;font-size:0.8rem;color:#555;">Updated: ${lastUpdated}</span></div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr><th>Time Period</th><th style="text-align:center;">Interest Rate</th><th style="text-align:right;">Description</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" class="muted" style="padding:1rem;">No rate data available</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function formatRateDescription(rate) {
  if (rate >= 10) return 'Excellent';
  if (rate >= 7) return 'Good';
  if (rate >= 5) return 'Decent';
  if (rate >= 3) return 'Low';
  return 'Very Low';
}

async function calculateBankEarnings() {
  const container = document.getElementById('bank-calculator-results');
  const amountInput = document.getElementById('bank-amount-input');
  const amount = parseFloat(amountInput.value);
  
  if (!amount || amount <= 0) {
    container.innerHTML = '<div class="channel-error">⚠️ Please enter a valid amount greater than 0.</div>';
    return;
  }

  // Get cached rates from the current display or fetch fresh
  const ratesContainer = document.getElementById('bank-rates-data');
  let rates = {};
  
  // Try to extract rates from the current display
  const rateCells = ratesContainer.querySelectorAll('td:nth-child(2)');
  if (rateCells.length >= 5) {
    rates = {
      '1_week': parseFloat(rateCells[0].textContent.replace('%', '')),
      '2_weeks': parseFloat(rateCells[1].textContent.replace('%', '')),
      '1_month': parseFloat(rateCells[2].textContent.replace('%', '')),
      '2_months': parseFloat(rateCells[3].textContent.replace('%', '')),
      '3_months': parseFloat(rateCells[4].textContent.replace('%', ''))
    };
  } else {
    // Fallback: fetch fresh rates
    try {
      const res = await fetch('/api/torn/bank-rates');
      const data = await res.json();
      rates = data.rates || {};
    } catch (err) {
      container.innerHTML = `<div class="channel-error">⚠️ Error fetching rates: ${err.message}</div>`;
      return;
    }
  }

  // Fetch merits to calculate bonus
  let meritsBonus = 0;
  try {
    const res = await fetch('/api/torn/honors');
    const data = await res.json();
    if (res.ok && data.merits) {
      meritsBonus = calculateMeritsBonus(data.merits);
    }
  } catch (err) {
    console.warn('Could not fetch merits for bonus calculation:', err);
  }

  displayCalculatorResults(amount, rates, meritsBonus);
}

function displayCalculatorResults(amount, rates, meritsBonus = 0) {
  const container = document.getElementById('bank-calculator-results');
  
  const results = [
    { period: '1 Week', key: '1_week', days: 7 },
    { period: '2 Weeks', key: '2_weeks', days: 14 },
    { period: '1 Month', key: '1_month', days: 30 },
    { period: '2 Months', key: '2_months', days: 60 },
    { period: '3 Months', key: '3_months', days: 90 }
  ];

  const rows = results.map(r => {
    const rate = rates[r.key] || 0;
    const earnings = calculateInterest(amount, rate, meritsBonus);
    const total = amount + earnings;
    return `
      <tr>
        <td>${r.period}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${rate}%</td>
        <td style="text-align:right;font-family:'Share Tech Mono',monospace;color:#4caf50;">+$${formatNum(earnings)}</td>
        <td style="text-align:right;font-family:'Share Tech Mono',monospace;">$${formatNum(total)}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-header">Bank Calculator Results <span style="float:right;font-size:0.8rem;color:#555;">Amount: $${formatNum(amount)}</span></div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr><th>Time Period</th><th style="text-align:center;">Rate</th><th style="text-align:right;">Earnings</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function calculateMeritsBonus(merits) {
  // Bank Interest merit: each level adds 1% bonus to the base rate
  // Max level 10 = +10% of the base rate
  const bankInterest = merits['Bank Interest'] || 0;
  return bankInterest * 1.0; // returns e.g. 10 for max level
}

function calculateInterest(principal, ratePercent, meritsBonus = 0) {
  // Torn bank rate is a flat rate applied directly to principal
  // e.g. 44.13% for 1 month means you earn principal * 0.4413
  // Merit bonus adds on top: Bank Interest at level 10 adds 10% of the base rate
  const baseInterest   = principal * (ratePercent / 100);
  const meritInterest  = baseInterest * (meritsBonus / 100);
  return Math.round(baseInterest + meritInterest);
}

function clearBankCalculator() {
  const container = document.getElementById('bank-calculator-results');
  const input = document.getElementById('bank-amount-input');
  
  input.value = '1000000';
  container.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">📊</span>
      <p>Enter an amount and click Calculate to see potential earnings.</p>
    </div>`;
}

// ── Keep-alive ping ───────────────────────────────────────────────────────────
setInterval(() => {
  fetch('/api/ping').catch(() => { });
}, 14 * 60 * 1000 + 30 * 1000);
