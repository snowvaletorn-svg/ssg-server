// ── Section Navigation ────────────────────────────────────────────────────────
function showSection(sectionId, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  if (el) el.classList.add('active');
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

function loadChannel(channelId) {
  if (!channelId) return;
  currentChannelId = channelId;
  fetchMessages(channelId);
}

function refreshMessages() {
  if (currentChannelId) fetchMessages(currentChannelId);
}

let memberCache = {};

async function fetchMessages(channelId) {
  const feed = document.getElementById('channel-feed');
  feed.innerHTML = '<div class="channel-loading">LOADING MESSAGES...</div>';
  await fetchSSGMembers();
  if (Object.keys(memberCache).length > 0) return; // already cached
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

async function fetchSSGMembers() {
  console.log('fetchSSGMembers called, cache size:', Object.keys(memberCache).length);
  if (Object.keys(memberCache).length > 0) return;
  try {
    const res = await fetch('/api/discord/members');
    console.log('Members response status:', res.status);
    const data = await res.json();
    console.log('Members data length:', data.length);
    if (res.ok) {
      data.forEach(m => {
        memberCache[m.user.id] = m.nick || m.user.global_name || m.user.username;
        console.log(m.user.username, '→ nick:', m.nick);
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
  console.log('Found mention ID:', userId, '→ cache lookup:', memberCache[userId]);
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
  const stats = d.strength || d.speed || d.defense || d.dexterity
    ? `
      <div class="stats-grid">
        ${statTile(formatNum(d.strength), 'Strength')}
        ${statTile(formatNum(d.speed), 'Speed')}
        ${statTile(formatNum(d.defense), 'Defense')}
        ${statTile(formatNum(d.dexterity), 'Dexterity')}
        ${statTile(d.level, 'Level')}
        ${statTile(formatNum(d.networth), 'Net Worth')}
        ${statTile(d.age + 'd', 'Days Old')}
        ${statTile(formatNum(d.attacks_won), 'Attacks Won')}
      </div>`
    : '';

  return `
    <div class="card">
      <div class="card-header">
        ${d.name} [${d.player_id}]
        <span style="float:right;font-size:0.8rem;color:#555;">${d.faction?.faction_name || 'No Faction'}</span>
      </div>
      <div class="card-body">
        ${stats || '<p class="muted">No battle stats available. Your API key may need the "stats" access level.</p>'}
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:0.5rem;">
          ${infoBadge('Status', d.last_action?.status || 'Unknown')}
          ${infoBadge('Life', d.life ? `${d.life.current}/${d.life.maximum}` : 'N/A')}
          ${infoBadge('Rank', d.rank || 'N/A')}
          ${infoBadge('Position', d.faction?.position || 'N/A')}
        </div>
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
  const members = d.members ? Object.values(d.members) : [];
  const memberRows = members
    .sort((a, b) => (b.days_in_faction || 0) - (a.days_in_faction || 0))
    .map(m => {
      const statusClass = `status-${(m.last_action?.status || 'offline').toLowerCase()}`;
      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${m.level || '—'}</td>
        <td>${m.position || '—'}</td>
        <td class="${statusClass}">${m.last_action?.status || 'Offline'}</td>
        <td>${m.days_in_faction ?? '—'}d</td>
      </tr>`;
    }).join('');

  return `
    <div class="stats-grid" style="margin-bottom:1.5rem;">
      ${statTile(d.name, 'Faction')}
      ${statTile(members.length, 'Members')}
      ${statTile(formatNum(d.respect), 'Respect')}
      ${statTile(d.rank || '—', 'Rank')}
    </div>
    <div class="card">
      <div class="card-header">Member Roster</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr>
            <th>Name</th><th>Level</th><th>Position</th><th>Status</th><th>Days</th>
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
