// ── Section Navigation ────────────────────────────────────────────────────────
function showSection(sectionId, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  if (el) el.classList.add('active');

  // Auto-fetch data when switching sections
  if (sectionId === 'torn') fetchTornUser();
  if (sectionId === 'faction') fetchFaction();
  if (sectionId === 'channels' && currentChannelId) fetchMessages(currentChannelId);
}

// ── Torn API Key ──────────────────────────────────────────────────────────────
function showKeyForm() {
  document.getElementById('key-form').classList.remove('hidden');
}

async function saveTornKey() {
  const input = document.getElementById('torn-key-input');
  const statusEl = document.getElementById('key-status');
  const key = input.value.trim();

  if (!key) {
    statusEl.innerHTML = '<p style="color:#ff4444;">Please enter an API key.</p>';
    return;
  }

  statusEl.innerHTML = '<p class="muted">Validating key...</p>';

  try {
    const res = await fetch('/api/torn/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.innerHTML = `<p style="color:#ff4444;">❌ ${data.error}</p>`;
      return;
    }

    statusEl.innerHTML = `<p class="success-text">✅ Key saved! Welcome, ${data.player.name} [${data.player.player_id}]</p>`;
    document.getElementById('key-form').classList.add('hidden');
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
  await fetchSSGMembers(); // ← add this line
  try {
    const res = await fetch(`/api/discord/channel/${channelId}`);
    const data = await res.json();
    if (!res.ok) {
      feed.innerHTML = `<div class="channel-error">⚠️ ${data.error || 'Failed to load messages'}</div>`;
      return;
    }
    if (!data.length) {
      feed.innerHTML = '<div class="channel-placeholder"><span class="placeholder-icon">💬</span><p>No messages found</p></div>';
      return;
    }
    const messages = [...data].reverse();
    feed.innerHTML = messages.map(renderMessage).join('');
  } catch (err) {
    feed.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

function renderMessage(msg) {
  const author = msg.author;
  const avatarUrl = author.avatar
    ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png`
    : null;

  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" alt="${escapeHtml(author.username)}">`
    : `<span>${escapeHtml(author.username.charAt(0).toUpperCase())}</span>`;

  const timestamp = new Date(msg.timestamp).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const content = formatContent(msg.content, msg.mentions);

  // Use nickname from cache, fall back to global_name, then username
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
    </div>
  `;
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

  // Replace user mentions <@ID> with actual usernames
  out = out.replace(/&lt;@!?(\d+)&gt;/g, (match, userId) => {
    const name = memberCache[userId] || mentions?.find(m => m.id === userId)?.global_name || userId;
    return `<span style="background:rgba(54,17,176,0.2);color:#a78df5;border-radius:3px;padding:0.1em 0.3em;font-weight:600;">@${name}</span>`;
  });
  // Bold **text**
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Code `text`
  out = out.replace(/`(.+?)`/g, '<code style="background:#1a1919;padding:0.1em 0.3em;border-radius:3px;font-family:\'Share Tech Mono\',monospace;font-size:0.85em;">$1</code>');
  // Links
  out = out.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return out;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Torn User Stats ───────────────────────────────────────────────────────────
async function fetchTornUser() {
  const container = document.getElementById('torn-user-data');
  container.innerHTML = '<div class="channel-loading">LOADING TORN DATA...</div>';

  try {
    const res = await fetch('/api/torn/user');
    const data = await res.json();

    if (!res.ok) {
      container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`;
      return;
    }

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
  const revivable = d.revivable === 1 ? '✅ Yes' : '❌ No';
  const married = d.married?.spouse_name ? `💍 ${d.married.spouse_name}` : 'No';
  const job = d.job?.position && d.job?.company_name !== 'None'
    ? `${d.job.position} at ${d.job.company_name}`
    : d.job?.job || 'Unemployed';

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
          <div style="font-family:'Rajdhani',sans-serif;font-size:0.8rem;color:#555;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">Bars</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Life', lifeBar)}
            ${infoBadge('Energy', energyBar)}
            ${infoBadge('Nerve', nerveBar)}
            ${infoBadge('Happy', happyBar)}
          </div>
        </div>

        <div style="margin-top:1.25rem;">
          <div style="font-family:'Rajdhani',sans-serif;font-size:0.8rem;color:#555;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">Info</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Status', d.status?.description || 'Unknown')}
            ${infoBadge('Last Action', d.last_action?.relative || 'Unknown')}
            ${infoBadge('Revivable', d.revivable === 1 ? '✅ Yes' : '❌ No')}
            ${infoBadge('Revive Setting', d.revive_setting || 'Unknown')}
            ${infoBadge('Job', job)}
            ${infoBadge('Married', married)}
            ${infoBadge('Property', d.property || 'None')}
            ${infoBadge('Rank', d.rank || 'N/A')}
            ${infoBadge('Gender', d.gender || 'N/A')}
            ${infoBadge('Donator', d.donator === 1 ? '✅ Yes' : '❌ No')}
          </div>
        </div>

        ${d.competition?.name ? `
        <div style="margin-top:1.25rem;">
          <div style="font-family:'Rajdhani',sans-serif;font-size:0.8rem;color:#555;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">Competition</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Event', d.competition.name)}
            ${infoBadge('Status', d.competition.status)}
            ${infoBadge('HP', `${d.competition.current_hp}/${d.competition.max_hp}`)}
          </div>
        </div>` : ''}

      </div>
    </div>`;
}

function statTile(value, label) {
  return `<div class="stat-tile"><div class="stat-value">${value ?? '—'}</div><div class="stat-label">${label}</div></div>`;
}

function infoBadge(label, value) {
  return `<div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.5rem 0.85rem;">
    <div style="font-size:0.7rem;color:#555;font-family:'Rajdhani',sans-serif;text-transform:uppercase;letter-spacing:0.06em;">${label}</div>
    <div style="color:#c0bcbc;font-size:0.9rem;">${value}</div>
  </div>`;
}

// ── Faction Stats ─────────────────────────────────────────────────────────────
async function fetchFaction() {
  const container = document.getElementById('faction-data');
  container.innerHTML = '<div class="channel-loading">LOADING FACTION DATA...</div>';

  try {
    const res = await fetch('/api/torn/faction');
    const data = await res.json();

    if (!res.ok) {
      container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`;
      return;
    }

    container.innerHTML = renderFaction(data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderFaction(d) {
  const basic = d.basic;
  const members = d.members || [];
  const positionOrder = {
    'Leader': 0,
    'Co-leader': 1,
    'Leadership': 2,
    'Team Strategy': 3,
    'Team Strength': 4,
    'Team Growth': 5,
    'Recruit': 6
  };

  const memberRows = members
    .sort((a, b) => {
      const aOrder = positionOrder[a.position] ?? 99;
      const bOrder = positionOrder[b.position] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Secondary sort by name within same position
      return (b.level || 0) - (a.level || 0);
    })
    .map(m => {
      const status = m.last_action?.status || 'Offline';
      const statusClass = `status-${status.toLowerCase()}`;
      const reviveSetting = m.revive_setting || '—';
      return `<tr>
    <td>${escapeHtml(m.name)}</td>
    <td>${m.level || '—'}</td>
    <td>${m.position || '—'}</td>
    <td class="${statusClass}">${status}</td>
    <td>${m.days_in_faction ?? '—'}d</td>
    <td>${reviveSetting}</td>
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
          </tr></thead>
          <tbody>${memberRows || '<tr><td colspan="5" class="muted" style="padding:1rem;">No member data available</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatNum(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}
