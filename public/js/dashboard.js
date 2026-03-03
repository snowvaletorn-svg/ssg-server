// ── Section Navigation ────────────────────────────────────────────────────────
function showSection(sectionId, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  if (el) el.classList.add('active');

  if (sectionId === 'torn') { fetchTornUser(); fetchCrimeExp(); }
  if (sectionId === 'faction') { fetchFaction(); }
  if (sectionId === 'travel') { fetchTravel(); fetchYataStock(); }
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
  // Filter to crime-related merits only
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

  if (crimeKeys.length === 0) {
    // Show all merits if no crime-specific ones found
    return renderAllMerits(merits);
  }

  const rows = crimeKeys.map(([key, val]) => `
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

function renderAllMerits(merits) {
  const rows = Object.entries(merits).map(([key, val]) => `
    <tr>
      <td>${formatMeritName(key)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${val}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <div class="card-header">All Merits</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr><th>Merit</th><th style="text-align:right;">Level</th></tr></thead>
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
    container.innerHTML = renderFaction(data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderFaction(d) {
  const basic = d.basic;
  const members = d.members || [];

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Leadership': 2,
    'Team Strategy': 3, 'Team Strength': 4, 'Team Growth': 5, 'Recruit': 6
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
      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${m.level || '—'}</td>
        <td>${m.position || '—'}</td>
        <td class="${statusClass}">${status}</td>
        <td>${m.days_in_faction ?? '—'}d</td>
        <td>${m.revive_setting || '—'}</td>
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
          <thead><tr><th>Name</th><th>Level</th><th>Position</th><th>Status</th><th>Days</th><th>Revive</th></tr></thead>
          <tbody>${memberRows || '<tr><td colspan="6" class="muted" style="padding:1rem;">No member data</td></tr>'}</tbody>
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
      // Build a map of item ID -> category
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
    // Fetch both in parallel
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
    mex: '🇲🇽 Mexico', cay: '🏝️ Cayman Islands', can: '🇨🇦 Canada',
    haw: '🌺 Hawaii', uni: '🇬🇧 United Kingdom', arg: '🇦🇷 Argentina',
    swi: '🇨🇭 Switzerland', jap: '🇯🇵 Japan', chi: '🇨🇳 China',
    uae: '🇦🇪 UAE', sou: '🇿🇦 South Africa'
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

    // Sort items
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
