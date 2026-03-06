// ── Section Navigation ────────────────────────────────────────────────────────
function showSection(sectionId, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  if (el) el.classList.add('active');

  if (sectionId === 'torn') { fetchTornUser(); fetchHonors(); fetchCrimeExp(); }
  if (sectionId === 'faction') { fetchFaction(); }
  if (sectionId === 'travel') { fetchTravel(); fetchYataStock(); }
  if (sectionId === 'admin') { fetchAdminMembers(); }
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
          ${statTile(d.level, 'Level')}
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

  // Apply filter
  if (filter === 'earned') honorEntries = honorEntries.filter(([id]) => awarded.has(parseInt(id)));
  if (filter === 'unearned') honorEntries = honorEntries.filter(([id]) => !awarded.has(parseInt(id)));

  // Apply sort
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

// ── Faction Stats ─────────────────────────────────────────────────────────────
async function fetchFaction() {
  const container = document.getElementById('faction-data');
  container.innerHTML = '<div class="channel-loading">LOADING FACTION DATA...</div>';
  try {
    const res = await fetch('/api/torn/faction');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }

    // Also fetch member stats if admin
    let statsMap = {};
    try {
      const statsRes = await fetch('/api/admin/member-stats');
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        (statsData.stats || []).forEach(s => { statsMap[s.player_id] = s; });
      }
    } catch { }

    container.innerHTML = renderFaction(data, statsMap);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderFaction(d, statsMap = {}) {
  const basic = d.basic;
  const members = d.members || [];
  const hasStats = Object.keys(statsMap).length > 0;

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Minerva': 2, 'Leadership': 3,
    'Team Strategy': 4, 'Team Strength': 5, 'Team Growth': 6, 'Recruit': 7
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
      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${m.level || '—'}</td>
        <td>${m.position || '—'}</td>
        <td class="${statusClass}">${status}</td>
        <td>${m.days_in_faction ?? '—'}d</td>
        <td>${m.revive_setting || '—'}</td>
        ${hasStats ? `<td style="font-family:'Share Tech Mono',monospace;font-size:0.85rem;">${totalStats}</td>` : ''}
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
          </tr></thead>
          <tbody>${memberRows || '<tr><td colspan="7" class="muted" style="padding:1rem;">No member data</td></tr>'}</tbody>
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

// ── Admin Panel ───────────────────────────────────────────────────────────────
async function fetchAdminMembers() {
  const container = document.getElementById('admin-members-data');
  container.innerHTML = '<div class="channel-loading">LOADING MEMBER ACTIVITY...</div>';
  try {
    const res = await fetch('/api/admin/members');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderAdminMembers(data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderAdminMembers(data) {
  const factionMembers = data.factionMembers || [];
  const dbUsers = data.dbUsers || [];

  // Build lookup by Torn player ID
  const dbByTornId = {};
  dbUsers.forEach(u => {
    if (u.tornPlayerId) dbByTornId[u.tornPlayerId] = u;
  });

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Minerva': 2, 'Leadership': 3,
    'Team Strategy': 4, 'Team Strength': 5, 'Team Growth': 6, 'Recruit': 7
  };

  const rows = factionMembers
    .sort((a, b) => {
      const aO = positionOrder[a.position] ?? 99;
      const bO = positionOrder[b.position] ?? 99;
      return aO !== bO ? aO - bO : a.name.localeCompare(b.name);
    })
    .map(m => {
      const dbUser = dbByTornId[m.id];
      const hasKey = dbUser?.hasApiKey ? '✅ Yes' : '❌ No';
      const lastSeen = dbUser?.lastSeen
        ? new Date(dbUser.lastSeen).toLocaleString()
        : '—';
      const seenClass = !dbUser?.lastSeen ? 'color:#555;' :
        (Date.now() - new Date(dbUser.lastSeen) < 7 * 24 * 60 * 60 * 1000) ? 'color:#4caf50;' : 'color:#f0a500;';

      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${m.position || '—'}</td>
        <td>${hasKey}</td>
        <td style="${seenClass}font-size:0.85rem;">${lastSeen}</td>
      </tr>`;
    }).join('');

  const registeredCount = dbUsers.filter(u => u.hasApiKey).length;

  return `
    <div class="stats-grid" style="margin-bottom:1.5rem;">
      ${statTile(factionMembers.length, 'Faction Members')}
      ${statTile(dbUsers.length, 'Dashboard Users')}
      ${statTile(registeredCount, 'API Keys Saved')}
    </div>
    <div class="card">
      <div class="card-header">Member Activity</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr><th>Name</th><th>Position</th><th>API Key</th><th>Last Seen</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="muted" style="padding:1rem;">No data</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

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
          <img src="/images/apikeyimage.png" alt="API Key" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
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
          <img src="/images/honorstableimage.png" alt="Honor table" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Merits',
        content: `
          <p class="help-text">Shows your merit progress with a progress bar for each merit. Green = maxed, orange = in progress, dark = not started.</p>
          <img src="/images/meritstableimage.png" alt="Merit table" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">        `
      },
      {
        heading: 'Crime XP',
        content: `
          <p class="help-text">Shows your crime-related merit levels broken down by crime type.</p>
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
          <img src="/images/travelimage.png" alt="Travel and foreign stock" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Foreign Stock',
        content: `
          <p class="help-text">Shows available items at foreign destinations using live YATA data. Use this to plan profitable buying trips.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Select a country from the dropdown to filter to one destination, or leave as All Countries</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Use the Sort dropdown to sort by Type, Name, Quantity, or Cost</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">↻ Refresh Stock</strong> to get the latest data</div></div>
          <div class="help-callout">💡 Only items currently in stock (quantity > 0) are shown. The update time on each card shows how recently YATA refreshed that country's data.</div>
          <img src="/images/travelimage.png" alt="Travel and foreign stock" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
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
          <div class="help-callout warning">⚠️ You can only see training channels that your SSG role gives you access to. Growth members do not have access to Stats Training or Money Making Training.</div>
          <img src="/images/trainingimage.png" alt="Training resources" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Available Channels',
        content: `
          <div class="help-step"><div class="help-step-num">📊</div><div class="help-step-text"><strong style="color:#c0bcbc;">Stats Training</strong> — Advanced stat building guides. Available to Strategy and above.</div></div>
          <div class="help-step"><div class="help-step-num">💰</div><div class="help-step-text"><strong style="color:#c0bcbc;">Money Making Training</strong> — Guides on funding your stats growth. Available to Strategy and above.</div></div>
          <div class="help-step"><div class="help-step-num">⬆️</div><div class="help-step-text"><strong style="color:#c0bcbc;">Level Training</strong> — How to level up fast through attacks, crimes, and gym. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🔗</div><div class="help-step-text"><strong style="color:#c0bcbc;">Chains</strong> — Step-by-step guides how to do Chains. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🫆</div><div class="help-step-text"><strong style="color:#c0bcbc;">Crimes Training</strong> — Helpful guide for effective Crimes Training. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🗝️</div><div class="help-step-text"><strong style="color:#c0bcbc;">Organized Crimes Training</strong> — Guide for how to do Organized Crimes. Available to all members.</div></div>
        `
      } 
       
    ]
  },
  admin: {
    title: '🛡️ Admin',
    sections: [
      {
        heading: 'Member Dashboard Activity',
        content: `
          <p class="help-text">Shows all faction members from Torn alongside their dashboard usage. This helps leadership see who has set up their API key and when they last visited.</p>
          <div class="help-callout">💡 Last Seen is color coded: <span style="color:#4caf50;">Green = active in last 7 days</span>, <span style="color:#f0a500;">Orange = over 7 days ago</span>, <span style="color:#555;">Grey = never logged in</span></div>
          <img src="/images/adminimage.png" alt="Admin activity" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
        `
      },
      {
        heading: 'Member Total Stats',
        content: `
          <p class="help-text">Shows battle stats for all members who have saved their Torn API key. Members are ranked by total stats descending.</p>
          <div class="help-callout warning">⚠️ This fetches data from the Torn API for each member individually and may take a few seconds to load.</div>
          <div class="help-callout">💡 Only members who have saved their API key in the dashboard will appear here. Encourage all members to set up their key.</div>
          <img src="/images/adminmemberstableimage.png" alt="Admin members" style="width:100%;border-radius:6px;margin:0.75rem 0;border:1px solid #2a2828;">
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
  const bodyEl = document.getElementById('help-modal-body');
  const titleEl = document.getElementById('help-modal-title');

  const content = HELP_CONTENT[currentHelpSection];
  if (!content) return;

  titleEl.textContent = content.title + ' — Help';

  // Build tabs
  tabsEl.innerHTML = Object.entries(HELP_CONTENT).map(([key, val]) =>
    `<button class="help-tab ${key === currentHelpSection ? 'active' : ''}"
      onclick="switchHelpTab('${key}')">${val.title}</button>`
  ).join('');

  // Build body
  renderHelpBody(currentHelpSection);

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function switchHelpTab(section) {
  currentHelpSection = section;
  const content = HELP_CONTENT[section];
  if (!content) return;

  document.getElementById('help-modal-title').textContent = content.title + ' — Help';
  document.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.help-tab').forEach(t => {
    if (t.textContent === content.title) t.classList.add('active');
  });

  // Re-highlight active tab
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

// Close on Escape key
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

// ── Keep-alive ping ───────────────────────────────────────────────────────────
setInterval(() => {
  fetch('/api/ping').catch(() => { });
}, 14 * 60 * 1000 + 30 * 1000); // 14m 30s