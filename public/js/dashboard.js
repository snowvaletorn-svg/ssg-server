// ── Section Navigation ────────────────────────────────────────────────────────
function showSection(sectionId, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  if (el) el.classList.add('active');

  if (sectionId === 'torn') { fetchTornUser(); }
  if (sectionId === 'faction') { fetchFaction(); }
  if (sectionId === 'travel') { fetchTravel(); fetchYataStock(); }
  if (sectionId === 'admin') { fetchMemberOverview(); }
  if (sectionId === 'war') { fetchWarDataOverview(); fetchWarStats(); }
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
          </div>
        </div>
        ${d.personalstats ? `
        <div style="margin-top:1.25rem;">
          <div class="badge-label">Battle Stats</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Strength', formatNumFull(d.personalstats.strength))}
            ${infoBadge('Defense', formatNumFull(d.personalstats.defense))}
            ${infoBadge('Speed', formatNumFull(d.personalstats.speed))}
            ${infoBadge('Dexterity', formatNumFull(d.personalstats.dexterity))}
            ${infoBadge('Total', formatNumFull(d.personalstats.totalstats))}
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
  container.innerHTML = '<div class="channel-loading">LOADING CRIME RECORD...</div>';
  try {
    // Fetch both criminal record and skills in parallel
    const [recordRes, skillsRes] = await Promise.all([
      fetch('/api/torn/crimeexp'),
      fetch('/api/torn/crimeskills')
    ]);

    const recordData = await recordRes.json();
    const skillsData = await skillsRes.json();

    if (!recordRes.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${recordData.error}</div>`; return; }

    // The criminal record is directly in the response, not nested
    const criminalRecord = recordData.criminalrecord || recordData;

    // Skills might be nested in data.skills or data.merits
    const skills = skillsData.skills || skillsData.merits || {};

    console.log('Criminal Record:', criminalRecord);
    console.log('Skills:', skills);

    container.innerHTML = renderCrimeExp(criminalRecord, skills);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

// Crime to category mapping - handles the criminalrecord API format
// The criminalrecord API returns category-level counts (vandalism, theft, etc.)
const CRIME_CATEGORIES = {
  'vandalism': 'Vandalism',
  'Vandalism': 'Vandalism',
  'theft': 'Theft',
  'Theft': 'Theft',
  'counterfeiting': 'Counterfeiting',
  'Counterfeiting': 'Counterfeiting',
  'fraud': 'Fraud',
  'Fraud': 'Fraud',
  'illicitservices': 'Illicit Services',
  'Illicit Services': 'Illicit Services',
  'illicit_services': 'Illicit Services',
  'cybercrime': 'Cybercrime',
  'Cybercrime': 'Cybercrime',
  'extortion': 'Extortion',
  'Extortion': 'Extortion',
  'illegalproduction': 'Illegal Production',
  'Illegal Production': 'Illegal Production',
  'illegal_production': 'Illegal Production'
};

const CATEGORY_ORDER = [
  'Vandalism', 'Theft', 'Counterfeiting', 'Fraud',
  'Illicit Services', 'Cybercrime', 'Extortion', 'Illegal Production'
];

const CATEGORY_ICONS = {
  'Vandalism': '🎨',
  'Theft': '🦹',
  'Counterfeiting': '🏦',
  'Fraud': '🎭',
  'Illicit Services': '💼',
  'Cybercrime': '💻',
  'Extortion': '🔫',
  'Illegal Production': '🏭'
};

// ── Crime Skills ──────────────────────────────────────────────────────────────
async function fetchCrimeSkills() {
  const container = document.getElementById('crime-skills-data');
  container.innerHTML = '<div class="channel-loading">LOADING CRIME SKILLS...</div>';
  try {
    const res = await fetch('/api/torn/crimeskills');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }

    console.log('Crime Skills API Response:', data);
    console.log('Full data object keys:', Object.keys(data));
    console.log('Skills:', data.skills);
    console.log('Skills keys:', data.skills ? Object.keys(data.skills) : 'null');

    // The skills might be nested differently - try different paths
    const skills = data.skills || data.merits || {};
    container.innerHTML = renderCrimeSkills(skills);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

// Crime skills to category mapping - comprehensive list of all crime skills
const SKILL_CATEGORIES = {
  // Vandalism
  'graffiti': 'Vandalism',
  'Graffiti': 'Vandalism',
  // Theft
  'shoplifting': 'Theft',
  'Shoplifting': 'Theft',
  'pickpocketing': 'Theft',
  'Pickpocketing': 'Theft',
  'card_skimming': 'Theft',
  'card skimming': 'Theft',
  'Card Skimming': 'Theft',
  'burglary': 'Theft',
  'Burglary': 'Theft',
  'hustling': 'Theft',
  'Hustling': 'Theft',
  'search_for_cash': 'Theft',
  'search for cash': 'Theft',
  'Search for Cash': 'Theft',
  // Counterfeiting
  'counterfeiting': 'Counterfeiting',
  'Counterfeiting': 'Counterfeiting',
  'forgery': 'Counterfeiting',
  'Forgery': 'Counterfeiting',
  // Fraud
  'scamming': 'Fraud',
  'Scamming': 'Fraud',
  'fraud': 'Fraud',
  'Fraud': 'Fraud',
  // Illicit Services
  'illegal_services': 'Illicit Services',
  'illegal services': 'Illicit Services',
  'Illegal Services': 'Illicit Services',
  // Cybercrime
  'cracking': 'Cybercrime',
  'Cracking': 'Cybercrime',
  // Extortion
  'extortion': 'Extortion',
  'Extortion': 'Extortion',
  // Illegal Production
  'bootlegging': 'Illegal Production',
  'Bootlegging': 'Illegal Production',
  'disposal': 'Illegal Production',
  'Disposal': 'Illegal Production',
  'arson': 'Illegal Production',
  'Arson': 'Illegal Production'
};

const SKILL_CATEGORY_ICONS = {
  'Vandalism': '🎨',
  'Theft': '🦹',
  'Counterfeiting': '🏦',
  'Fraud': '🎭',
  'Illicit Services': '💼',
  'Cybercrime': '💻',
  'Extortion': '🔫',
  'Illegal Production': '🏭'
};

function renderCrimeSkills(skills) {
  // Filter for crime-related skills
  const crimeSkillEntries = Object.entries(skills).filter(([key]) => {
    const lowerKey = key.toLowerCase();
    return SKILL_CATEGORIES[lowerKey] || SKILL_CATEGORIES[key];
  });

  if (crimeSkillEntries.length === 0) {
    return `
      <div class="empty-state">
        <span class="empty-icon">⚡</span>
        <p>No crime skills found.</p>
        <p class="muted">You haven't unlocked any crime skills yet. Commit crimes to gain skill levels.</p>
      </div>`;
  }

  // Group by category
  const grouped = {};
  let totalSkillPoints = 0;

  crimeSkillEntries.forEach(([skill, level]) => {
    const lowerKey = skill.toLowerCase();
    const category = SKILL_CATEGORIES[lowerKey] || SKILL_CATEGORIES[skill];
    if (!category) return;

    if (!grouped[category]) {
      grouped[category] = { skills: [], totalLevel: 0 };
    }
    const skillLevel = parseInt(level) || 0;
    grouped[category].skills.push({ name: skill, level: skillLevel });
    grouped[category].totalLevel += skillLevel;
    totalSkillPoints += skillLevel;
  });

  // Sort skills within each category by level descending
  Object.values(grouped).forEach(cat => {
    cat.skills.sort((a, b) => b.level - a.level);
  });

  // Build HTML
  let html = `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        ⚡ Crime Skills Summary
        <span style="float:right;font-size:0.8rem;color:#555;">Total Skill Points: ${totalSkillPoints}</span>
      </div>
      <div class="card-body">
        <div class="stats-grid">
          ${statTile(Object.keys(grouped).length, 'Skill Categories')}
          ${statTile(crimeSkillEntries.length, 'Skills Unlocked')}
          ${statTile(totalSkillPoints, 'Total Level')}
        </div>
      </div>
    </div>`;

  // Render each category
  CATEGORY_ORDER.forEach(category => {
    if (!grouped[category]) return;

    const catData = grouped[category];
    const icon = SKILL_CATEGORY_ICONS[category] || '📁';

    let skillRows = catData.skills.map(skill => {
      const maxLevel = 10;
      const progress = skill.level / maxLevel;
      const color = skill.level >= maxLevel ? '#4caf50' : skill.level >= 5 ? '#f0a500' : '#4a90e2';

      return `
        <div style="margin-bottom:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
            <span style="font-size:0.85rem;color:#c0bcbc;">${skill.name}</span>
            <span style="font-size:0.75rem;color:#555;font-family:'Share Tech Mono',monospace;">Level ${skill.level}/${maxLevel}</span>
          </div>
          <div style="background:#2a2828;border-radius:4px;height:8px;overflow:hidden;position:relative;">
            <div style="width:${progress * 100}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
          </div>
        </div>`;
    }).join('');

    html += `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">
          ${icon} ${category}
          <span style="float:right;font-size:0.8rem;color:#555;">${catData.skills.length} skills · Level ${catData.totalLevel}</span>
        </div>
        <div class="card-body">
          ${skillRows}
        </div>
      </div>`;
  });

  return html;
}

function renderCrimeExp(criminalRecord, skills) {
  // Build a map of skill levels by normalized key
  // Skills is an array of {slug, name, level} objects
  const skillMap = {};
  if (skills && Array.isArray(skills)) {
    skills.forEach(skill => {
      const slug = skill.slug ? skill.slug.toLowerCase() : '';
      const name = skill.name ? skill.name.toLowerCase() : '';
      const level = parseFloat(skill.level) || 0;

      // Map by both slug and name for flexibility
      if (SKILL_CATEGORIES[slug] || SKILL_CATEGORIES[name]) {
        skillMap[slug] = Math.round(level); // Round to whole number
      }
    });
  } else if (skills && typeof skills === 'object') {
    // Fallback for object format
    Object.entries(skills).forEach(([key, level]) => {
      const lowerKey = key.toLowerCase();
      if (SKILL_CATEGORIES[lowerKey] || SKILL_CATEGORIES[key]) {
        skillMap[lowerKey] = parseInt(level) || 0;
      }
    });
  }

  // Define the offense categories and their associated skills
  const offenseCategories = {
    'Vandalism': {
      icon: '🎨',
      skills: ['graffiti', 'arson']
    },
    'Theft': {
      icon: '🦹',
      skills: ['search_for_cash', 'shoplifting', 'pickpocketing', 'burglary']
    },
    'Counterfeiting': {
      icon: '🏦',
      skills: ['bootlegging', 'forgery']
    },
    'Fraud': {
      icon: '🎭',
      skills: ['card_skimming', 'hustling', 'scamming']
    },
    'Illicit Services': {
      icon: '💼',
      skills: ['disposal']
    },
    'Cybercrime': {
      icon: '💻',
      skills: ['cracking']
    },
    'Extortion': {
      icon: '🔫',
      skills: ['extortion']
    },
    'Illegal Production': {
      icon: '🏭',
      skills: [] // This category may have skills added in the future
    }
  };

  // Check if there's any data
  const hasCriminalRecord = Object.keys(criminalRecord || {}).length > 0;
  const hasSkills = Object.keys(skillMap).length > 0;

  if (!hasCriminalRecord && !hasSkills) {
    return `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <p>No crime data found.</p>
        <p class="muted">You haven't committed any crimes or unlocked any crime skills yet.</p>
      </div>`;
  }

  // Build HTML
  let html = '';

  // Render each offense category
  CATEGORY_ORDER.forEach(category => {
    const categoryData = offenseCategories[category];
    if (!categoryData) return;

    const { icon, skills: categorySkills } = categoryData;

    // Get crime count from criminal record for this category
    let categoryCrimeCount = 0;
    Object.entries(criminalRecord || {}).forEach(([crime, count]) => {
      const crimeCategory = CRIME_CATEGORIES[crime];
      if (crimeCategory === category) {
        categoryCrimeCount += parseInt(count) || 0;
      }
    });

    // Build skill rows
    let skillRows = '';
    categorySkills.forEach(skillName => {
      const skillLevel = skillMap[skillName] || 0;
      const maxLevel = 100;
      const progress = skillLevel / maxLevel;
      const color = skillLevel >= 100 ? '#4caf50' : skillLevel >= 50 ? '#f0a500' : '#4a90e2';
      const formattedSkillName = skillName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      skillRows += `
        <div style="margin-bottom:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
            <span style="font-size:0.85rem;color:#c0bcbc;">${formattedSkillName}</span>
            <span style="font-size:0.75rem;color:#555;font-family:'Share Tech Mono',monospace;">${skillLevel}/${maxLevel}</span>
          </div>
          <div style="background:#2a2828;border-radius:4px;height:8px;overflow:hidden;position:relative;">
            <div style="width:${progress * 100}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
          </div>
        </div>`;
    });

    if (!skillRows && categoryCrimeCount === 0) return;

    html += `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">
          ${icon} ${category} Offenses
          <span style="float:right;font-size:0.8rem;color:#555;">${categoryCrimeCount.toLocaleString()} crimes committed</span>
        </div>
        <div class="card-body">
          ${skillRows || '<p class="muted" style="font-size:0.85rem;">No skills unlocked in this category yet.</p>'}
        </div>
      </div>`;
  });

  return html;
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
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'Warlord': 4,
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
      const totalStats = memberStats ? formatNumFull(memberStats.totalstats) : '—';

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

       const bloodTypeCell = IS_LEADERSHIP
         ? `<td class="faction-bloodtype" data-playerid="${m.id}">${IS_OWNER ? `<input type="text" value="${m.bloodType || ''}" placeholder="A+, B-, etc." style="width:65px;background:#1a1919;border:1px solid #333;color:#c0bcbc;border-radius:4px;padding:2px 4px;font-size:0.85rem;text-align:center;" disabled>` : (m.bloodType || '—')}</td>`
         : '';
       
       return `<tr>
         <td>${escapeHtml(m.name)}</td>
         <td>${m.level || '—'}</td>
         <td>${m.position || '—'}</td>
         <td class="${statusClass}">${status}</td>
         <td>${m.days_in_faction ?? '—'}d</td>
         <td>${m.revive_setting || '—'}</td>
         ${hasStats ? `<td style="font-family:'Share Tech Mono',monospace;font-size:0.85rem;">${totalStats}</td>` : ''}
         <td style="font-size:0.85rem;">${travelCell}</td>
         ${bloodTypeCell}
         <td class="faction-timezone" data-playerid="${m.id}">${IS_OWNER ? `<select style="width:85px;background:#1a1919;border:1px solid #333;color:#c0bcbc;border-radius:4px;padding:2px 4px;font-size:0.85rem;text-align:center;">
  <option value="">—</option>
  <option value="UTC-12" ${m.timeZone === 'UTC-12' ? 'selected' : ''}>UTC-12</option>
  <option value="UTC-11" ${m.timeZone === 'UTC-11' ? 'selected' : ''}>UTC-11</option>
  <option value="UTC-10" ${m.timeZone === 'UTC-10' ? 'selected' : ''}>UTC-10</option>
  <option value="UTC-9.5" ${m.timeZone === 'UTC-9.5' ? 'selected' : ''}>UTC-9.5</option>
  <option value="UTC-9" ${m.timeZone === 'UTC-9' ? 'selected' : ''}>UTC-9</option>
  <option value="UTC-8" ${m.timeZone === 'UTC-8' ? 'selected' : ''}>UTC-8</option>
  <option value="UTC-7" ${m.timeZone === 'UTC-7' ? 'selected' : ''}>UTC-7</option>
  <option value="UTC-6" ${m.timeZone === 'UTC-6' ? 'selected' : ''}>UTC-6</option>
  <option value="UTC-5" ${m.timeZone === 'UTC-5' ? 'selected' : ''}>UTC-5</option>
  <option value="UTC-4.5" ${m.timeZone === 'UTC-4.5' ? 'selected' : ''}>UTC-4.5</option>
  <option value="UTC-4" ${m.timeZone === 'UTC-4' ? 'selected' : ''}>UTC-4</option>
  <option value="UTC-3.5" ${m.timeZone === 'UTC-3.5' ? 'selected' : ''}>UTC-3.5</option>
  <option value="UTC-3" ${m.timeZone === 'UTC-3' ? 'selected' : ''}>UTC-3</option>
  <option value="UTC-2.5" ${m.timeZone === 'UTC-2.5' ? 'selected' : ''}>UTC-2.5</option>
  <option value="UTC-2" ${m.timeZone === 'UTC-2' ? 'selected' : ''}>UTC-2</option>
  <option value="UTC-1" ${m.timeZone === 'UTC-1' ? 'selected' : ''}>UTC-1</option>
  <option value="UTC±0" ${m.timeZone === 'UTC±0' ? 'selected' : ''}>UTC±0</option>
  <option value="UTC+1" ${m.timeZone === 'UTC+1' ? 'selected' : ''}>UTC+1</option>
  <option value="UTC+2" ${m.timeZone === 'UTC+2' ? 'selected' : ''}>UTC+2</option>
  <option value="UTC+3" ${m.timeZone === 'UTC+3' ? 'selected' : ''}>UTC+3</option>
  <option value="UTC+3.5" ${m.timeZone === 'UTC+3.5' ? 'selected' : ''}>UTC+3.5</option>
  <option value="UTC+4" ${m.timeZone === 'UTC+4' ? 'selected' : ''}>UTC+4</option>
  <option value="UTC+4.5" ${m.timeZone === 'UTC+4.5' ? 'selected' : ''}>UTC+4.5</option>
  <option value="UTC+5" ${m.timeZone === 'UTC+5' ? 'selected' : ''}>UTC+5</option>
  <option value="UTC+5.5" ${m.timeZone === 'UTC+5.5' ? 'selected' : ''}>UTC+5.5</option>
  <option value="UTC+5.75" ${m.timeZone === 'UTC+5.75' ? 'selected' : ''}>UTC+5.75</option>
  <option value="UTC+6" ${m.timeZone === 'UTC+6' ? 'selected' : ''}>UTC+6</option>
  <option value="UTC+6.5" ${m.timeZone === 'UTC+6.5' ? 'selected' : ''}>UTC+6.5</option>
  <option value="UTC+7" ${m.timeZone === 'UTC+7' ? 'selected' : ''}>UTC+7</option>
  <option value="UTC+8" ${m.timeZone === 'UTC+8' ? 'selected' : ''}>UTC+8</option>
  <option value="UTC+9" ${m.timeZone === 'UTC+9' ? 'selected' : ''}>UTC+9</option>
  <option value="UTC+9.5" ${m.timeZone === 'UTC+9.5' ? 'selected' : ''}>UTC+9.5</option>
  <option value="UTC+10" ${m.timeZone === 'UTC+10' ? 'selected' : ''}>UTC+10</option>
  <option value="UTC+10.5" ${m.timeZone === 'UTC+10.5' ? 'selected' : ''}>UTC+10.5</option>
  <option value="UTC+11" ${m.timeZone === 'UTC+11' ? 'selected' : ''}>UTC+11</option>
  <option value="UTC+11.5" ${m.timeZone === 'UTC+11.5' ? 'selected' : ''}>UTC+11.5</option>
  <option value="UTC+12" ${m.timeZone === 'UTC+12' ? 'selected' : ''}>UTC+12</option>
  <option value="UTC+12.75" ${m.timeZone === 'UTC+12.75' ? 'selected' : ''}>UTC+12.75</option>
  <option value="UTC+13" ${m.timeZone === 'UTC+13' ? 'selected' : ''}>UTC+13</option>
  <option value="UTC+14" ${m.timeZone === 'UTC+14' ? 'selected' : ''}>UTC+14</option>
</select>` : (m.timeZone || '—')}</td>
       </tr>`;
    }).join('');

  // Only show edit mode button if user is ownership
  const editModeButton = IS_OWNER
    ? `<button id="edit-faction-btn" class="btn btn-primary" onclick="toggleFactionEditMode()" style="float:right;margin:-2px 0;padding:4px 12px;font-size:0.85rem;">✏️ Edit Mode</button>`
    : '';

  return `
    <div class="stats-grid" style="margin-bottom:1.5rem;">
      ${statTile(basic.name, 'Faction')}
      ${statTile(basic.members, 'Members')}
      ${statTile(formatNum(basic.respect), 'Respect')}
      ${statTile(`${basic.rank.name} D${basic.rank.division}`, 'Rank')}
    </div>
    <div class="card">
      <div class="card-header">
        Member Roster
        ${editModeButton}
      </div>
      <div style="overflow-x:auto;">
        <table class="members-table" id="faction-members-table">
           <thead><tr>
             <th>Name</th><th>Level</th><th>Position</th><th>Status</th><th>Days</th><th>Revive</th>
             ${hasStats ? '<th>Total Stats</th>' : ''}
             <th>Travel</th>
             ${IS_LEADERSHIP ? '<th>Blood type</th>' : ''}
             <th>TimeZone</th>
           </tr></thead>
          <tbody>${memberRows || '<tr><td colspan="8" class="muted" style="padding:1rem;">No member data</td></tr>'}</tbody>
        </table>
      </div>
      ${IS_OWNER ? `<div id="faction-save-container" style="display:none;padding:1rem;text-align:right;border-top:1px solid #2a2828;">
        <button class="btn btn-success" onclick="saveFactionProfileChanges()" style="margin-right:0.5rem;">💾 Save Changes</button>
        <button class="btn btn-outline" onclick="cancelFactionEditMode()">✕ Cancel</button>
      </div>` : ''}
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
// ── War Data Overview ─────────────────────────────────────────────────────
let warDataOverview = [];
let warDataOverviewSortCol = 'position';
let warDataOverviewSortAsc = true;

async function fetchWarDataOverview() {
  const container = document.getElementById('war-overview-data');
  container.innerHTML = '<div class="channel-loading">LOADING WAR DATA OVERVIEW...</div>';
  try {
    const res = await fetch('/api/war/member-overview');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    warDataOverview = data.members || [];
    renderWarOverview();
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function sortWarDataOverview(col) {
  if (warDataOverviewSortCol === col) {
    warDataOverviewSortAsc = !warDataOverviewSortAsc;
  } else {
    warDataOverviewSortCol = col;
    warDataOverviewSortAsc = true;
  }
  renderWarOverview();
}

function renderWarOverview() {
  const container = document.getElementById('war-overview-data');
  if (!warDataOverview.length) {
    container.innerHTML = '<div class="empty-state"><p class="muted">No member data found.</p></div>';
    return;
  }

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'Warlord': 4,
    'Team Strategy': 5, 'Team Strength': 6, 'Team Growth': 7, 'Recruit': 8
  };

  const sorted = [...warDataOverview].sort((a, b) => {
    let aVal, bVal;
    switch (warDataOverviewSortCol) {
      case 'name':
        aVal = a.name?.toLowerCase() || '';
        bVal = b.name?.toLowerCase() || '';
        break;
      case 'position':
        aVal = positionOrder[a.position] ?? 99;
        bVal = positionOrder[b.position] ?? 99;
        break;
      case 'energy':
        aVal = a.energy?.current ?? -1;
        bVal = b.energy?.current ?? -1;
        break;
      case 'medical':
        aVal = a.cooldowns?.medical ?? -1;
        bVal = b.cooldowns?.medical ?? -1;
        break;
      default:
        aVal = a.name?.toLowerCase() || '';
        bVal = b.name?.toLowerCase() || '';
    }
    if (typeof aVal === 'string') {
      return warDataOverviewSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return warDataOverviewSortAsc ? aVal - bVal : bVal - aVal;
  });

  const arrow = col => warDataOverviewSortCol === col ? (warDataOverviewSortAsc ? ' ▲' : ' ▼') : '';

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

    return `<tr>
      <td style="color:#555;font-size:0.8rem;text-align:center;">${i + 1}</td>
      <td>
        <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener"
          style="color:#a78df5;text-decoration:none;">${escapeHtml(m.name)}</a>
        <span style="color:#555;font-size:0.75rem;"> [${m.id}]</span>
      </td>
      <td style="font-size:0.85rem;">${m.position || '—'}</td>
      <td style="font-size:0.85rem;">${energyCell}</td>
      <td style="font-size:0.85rem;text-align:center;">${medicalCell}</td>
      <td style="font-size:0.85rem;text-align:center;">${m.revive_setting || '—'}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="members-table overview-table">
        <thead>
          <tr>
            <th style="text-align:center;width:40px;">#</th>
            <th class="sortable" onclick="sortWarDataOverview('name')"       style="cursor:pointer;">Name${arrow('name')}</th>
            <th class="sortable" onclick="sortWarDataOverview('position')"   style="cursor:pointer;">Position${arrow('position')}</th>
            <th class="sortable" onclick="sortWarDataOverview('energy')"     style="cursor:pointer;">Energy & Cooldowns${arrow('energy')}</th>
            <th class="sortable" onclick="sortWarDataOverview('medical')"    style="cursor:pointer;">Medical CD${arrow('medical')}</th>
            <th>Revive</th>
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
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'Warlord': 4,
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
      case 'totalstats':
        aVal = a.totalstats ?? -1;
        bVal = b.totalstats ?? -1;
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

    // Job display - position on first line, company name wraps on second line
    const job = m.job
      ? `${escapeHtml(m.job.position)}<br><span style="color:#555;font-size:0.72rem;word-wrap:break-word;overflow-wrap:break-word;">${escapeHtml(m.job.company_name)}</span>`
      : '—';

    // Compact energy display
    const energyDisplay = m.energy ? `${m.energy.current}/${m.energy.maximum}` : '—';
    const isDonator = m.energy?.maximum >= 150;
    const donatorBadge = m.energy
      ? `<span style="font-size:0.65rem;color:${isDonator ? '#f0a500' : '#555'};margin-left:0.2rem;">${isDonator ? '★' : '○'}</span>`
      : '';

    const drugCD = m.cooldowns
      ? (m.cooldowns.drug > 0
        ? `<span title="Drug cooldown: ${formatCooldown(m.cooldowns.drug)}" style="cursor:help;color:#e74c3c;font-size:0.72rem;">💊${formatCooldown(m.cooldowns.drug)}</span>`
        : `<span style="color:#2ecc71;font-size:0.72rem;">💊OK</span>`)
      : '—';

    const boosterCD = m.cooldowns
      ? (m.cooldowns.booster > 0
        ? `<span style="color:#e67e22;font-size:0.72rem;">⚡${formatCooldown(m.cooldowns.booster)}</span>`
        : `<span style="color:#2ecc71;font-size:0.72rem;">⚡OK</span>`)
      : '—';

    const energyCell = m.energy || m.cooldowns ? `
        <div style="font-size:0.8rem;">${energyDisplay}${donatorBadge}</div>
        <div style="font-size:0.72rem;margin-top:0.15rem;">${drugCD} ${boosterCD}</div>
      ` : '—';

    const medicalCell = m.cooldowns
      ? (m.cooldowns.medical > 0
        ? `<span style="color:#e74c3c;font-size:0.75rem;">${formatCooldown(m.cooldowns.medical)}</span>`
        : `<span style="color:#2ecc71;font-size:0.75rem;">OK</span>`)
      : '—';

    const lastActionTs = m.tornLastAction?.timestamp ?? m.last_action?.timestamp ?? null;
    const lastActionCell = lastActionTs ? formatLastAction(lastActionTs) : '—';
    const isStale = lastActionTs && (Date.now() / 1000 - lastActionTs) > 23 * 3600;
    const lastActionStyle = isStale ? 'color:#ff4444;font-weight:600;font-size:0.75rem;' : 'color:#a0a0a0;font-size:0.75rem;';

    // Battle stats - more compact
    const hasStats = m.strength !== null && m.strength !== undefined;
    const statsCell = hasStats ? `
        <div style="font-family:'Share Tech Mono',monospace;font-size:0.72rem;line-height:1.35;white-space:nowrap;">
          <div><span style="color:#e74c3c;font-weight:600;">STR</span> ${formatNumFull(m.strength)}</div>
          <div><span style="color:#3498db;font-weight:600;">DEF</span> ${formatNumFull(m.defense)}</div>
          <div><span style="color:#2ecc71;font-weight:600;">SPD</span> ${formatNumFull(m.speed)}</div>
          <div><span style="color:#f39c12;font-weight:600;">DEX</span> ${formatNumFull(m.dexterity)}</div>
          <div style="border-top:1px solid #333;margin-top:1px;padding-top:1px;text-align:center;font-weight:600;color:#c0bcbc;">${formatNumFull(m.totalstats)}</div>
        </div>` : '<span style="color:#555;font-size:0.7rem;">—</span>';

    // Compact API key display
    const hasKey = m.hasApiKey ? '✅' : '❌';
    const keyUpdated = m.tornKeyUpdatedAt
      ? new Date(m.tornKeyUpdatedAt).toLocaleDateString()
      : m.lastSeen ? new Date(m.lastSeen).toLocaleDateString() : '—';
    const apiCell = `${hasKey}<br><span style="font-size:0.68rem;color:#555;">${keyUpdated}</span>`;

    const removeBtn = m.id
      ? `<button class="btn btn-small btn-danger" onclick="removeUser(${m.id}, '${escapeHtml(m.name)}')" style="padding:2px 6px;font-size:0.7rem;">✕</button>`
      : '—';

    return `<tr>
        <td style="color:#555;font-size:0.75rem;text-align:center;width:30px;">${i + 1}</td>
        <td style="max-width:150px;">
          <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener"
            style="color:#a78df5;text-decoration:none;font-size:0.82rem;">${escapeHtml(m.name)}</a>
          <span style="color:#555;font-size:0.68rem;"> [${m.id}]</span>
        </td>
        <td style="font-size:0.78rem;text-align:center;width:30px;">${m.level || '—'}</td>
        <td style="font-size:0.78rem;max-width:100px;overflow:hidden;text-overflow:ellipsis;">${m.position || '—'}</td>
        <td style="font-size:0.78rem;max-width:90px;overflow:hidden;text-overflow:ellipsis;">${property}</td>
        <td style="font-size:0.78rem;max-width:75px;">${job}</td>
        <td style="font-size:0.78rem;">${energyCell}</td>
        <td style="font-size:0.75rem;text-align:center;width:60px;">${medicalCell}</td>
        <td style="${lastActionStyle};white-space:nowrap;width:80px;">${lastActionCell}</td>
        <td style="font-size:0.78rem;">${statsCell}</td>
        <td style="font-size:0.75rem;text-align:center;width:50px;">${apiCell}</td>
        <td style="text-align:center;width:40px;">${removeBtn}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="members-table overview-table">
        <thead>
          <tr>
            <th style="text-align:center;width:40px;">#</th>
            <th class="sortable" onclick="sortOverview('name')"       style="cursor:pointer;">Name${arrow('name')}</th>
            <th style="text-align:center;">Lvl</th>
            <th class="sortable" onclick="sortOverview('position')"   style="cursor:pointer;">Position${arrow('position')}</th>
            <th class="sortable" onclick="sortOverview('property')"   style="cursor:pointer;">Housing${arrow('property')}</th>
            <th class="sortable" onclick="sortOverview('job')"        style="cursor:pointer;">Job${arrow('job')}</th>
            <th class="sortable" onclick="sortOverview('energy')"     style="cursor:pointer;">Energy & Cooldowns${arrow('energy')}</th>
            <th class="sortable" onclick="sortOverview('medical')"    style="cursor:pointer;">Medical CD${arrow('medical')}</th>
            <th class="sortable" onclick="sortOverview('lastaction')" style="cursor:pointer;">Last Action${arrow('lastaction')}</th>
            <th class="sortable" onclick="sortOverview('totalstats')" style="cursor:pointer;">Battle Stats${arrow('totalstats')}</th>
            <th class="sortable" onclick="sortOverview('lastseen')"   style="cursor:pointer;">API Key${arrow('lastseen')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:0.75rem;color:#444;margin-top:0.5rem;padding:0 0.5rem;">
      ★ = Donator &nbsp;|&nbsp; 💊 = Drug cooldown &nbsp;|&nbsp; ⚡ = Booster cooldown &nbsp;|&nbsp;
      <span style="color:#ff4444;">Red last action</span> = offline 23+ hours &nbsp;|&nbsp;
      Stats: <span style="color:#e74c3c;">STR</span> <span style="color:#3498db;">DEF</span> <span style="color:#2ecc71;">SPD</span> <span style="color:#f39c12;">DEX</span>
    </p>`;
}

// ─── Faction Loans ────────────────────────────────────────────────────────────
let loansData = [];

async function fetchFactionLoans() {
  const container = document.getElementById('admin-loans-data');
  container.innerHTML = '<div class="channel-loading">LOADING FACTION LOANS...</div>';
  try {
    const res = await fetch('/api/admin/faction-loans');

    // Check if response is JSON
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      container.innerHTML = `<div class="channel-error">⚠️ Server returned non-JSON response. Please ensure you're logged in and have leadership access.</div>`;
      return;
    }

    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    loansData = data.members || [];
    renderFactionLoans(loansData, data.totals, data.armoryItems || []);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderFactionLoans(members, totals, armoryItems) {
  const container = document.getElementById('admin-loans-data');

  if (!members.length) {
    container.innerHTML = '<div class="empty-state"><p class="muted">No member data found.</p></div>';
    return;
  }

  // Sort by position hierarchy then name (matching Member Overview table order)
  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'Warlord': 4,
    'Team Strategy': 5, 'Team Strength': 6, 'Team Growth': 7, 'Recruit': 8
  };

  const sorted = [...members].sort((a, b) => {
    const aO = positionOrder[a.position] ?? 99;
    const bO = positionOrder[b.position] ?? 99;
    if (aO !== bO) return aO - bO;
    return a.name.localeCompare(b.name);
  });

  const rows = sorted.map(m => {
    // Use word-wrap and smaller font to fit all columns on screen
    const primary = m.primary ? `<span title="${escapeHtml(m.primary)}" style="display:block;word-wrap:break-word;overflow-wrap:break-word;font-size:0.72rem;max-width:80px;">${escapeHtml(m.primary)}</span>` : '<span style="color:#555;font-size:0.72rem;">✕</span>';
    const secondary = m.secondary ? `<span title="${escapeHtml(m.secondary)}" style="display:block;word-wrap:break-word;overflow-wrap:break-word;font-size:0.72rem;max-width:70px;">${escapeHtml(m.secondary)}</span>` : '<span style="color:#555;font-size:0.72rem;">✕</span>';
    const melee = m.melee ? `<span title="${escapeHtml(m.melee)}" style="display:block;word-wrap:break-word;overflow-wrap:break-word;font-size:0.72rem;max-width:70px;">${escapeHtml(m.melee)}</span>` : '<span style="color:#555;font-size:0.72rem;">✕</span>';
    const head = m.head ? `<span title="${escapeHtml(m.head)}" style="display:block;word-wrap:break-word;overflow-wrap:break-word;font-size:0.72rem;max-width:70px;">${escapeHtml(m.head)}</span>` : '<span style="color:#555;font-size:0.72rem;">✕</span>';
    const body = m.body ? `<span title="${escapeHtml(m.body)}" style="display:block;word-wrap:break-word;overflow-wrap:break-word;font-size:0.72rem;max-width:70px;">${escapeHtml(m.body)}</span>` : '<span style="color:#555;font-size:0.72rem;">✕</span>';
    const gloves = m.gloves ? `<span title="${escapeHtml(m.gloves)}" style="display:block;word-wrap:break-word;overflow-wrap:break-word;font-size:0.72rem;max-width:60px;">${escapeHtml(m.gloves)}</span>` : '<span style="color:#555;font-size:0.72rem;">✕</span>';
    const pants = m.pants ? `<span title="${escapeHtml(m.pants)}" style="display:block;word-wrap:break-word;overflow-wrap:break-word;font-size:0.72rem;max-width:60px;">${escapeHtml(m.pants)}</span>` : '<span style="color:#555;font-size:0.72rem;">✕</span>';
    const boots = m.boots ? `<span title="${escapeHtml(m.boots)}" style="display:block;word-wrap:break-word;overflow-wrap:break-word;font-size:0.72rem;max-width:60px;">${escapeHtml(m.boots)}</span>` : '<span style="color:#555;font-size:0.72rem;">✕</span>';

    return `<tr style="vertical-align:top;">
      <td style="max-width:100px;">
        <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener"
          style="color:#a78df5;text-decoration:none;font-size:0.78rem;">${escapeHtml(m.name)}</a>
      </td>
      <td style="font-size:0.72rem;text-align:center;">${primary}</td>
      <td style="font-size:0.72rem;text-align:center;">${secondary}</td>
      <td style="font-size:0.72rem;text-align:center;">${melee}</td>
      <td style="font-size:0.72rem;text-align:center;">${head}</td>
      <td style="font-size:0.72rem;text-align:center;">${body}</td>
      <td style="font-size:0.72rem;text-align:center;">${gloves}</td>
      <td style="font-size:0.72rem;text-align:center;">${pants}</td>
      <td style="font-size:0.72rem;text-align:center;">${boots}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="members-table overview-table" style="table-layout:fixed;width:100%;">
        <thead>
          <tr>
            <th style="width:12%;">Member</th>
            <th style="text-align:center;width:11%;">Primary</th>
            <th style="text-align:center;width:11%;">Secondary</th>
            <th style="text-align:center;width:11%;">Melee</th>
            <th style="text-align:center;width:11%;">Head</th>
            <th style="text-align:center;width:11%;">Body</th>
            <th style="text-align:center;width:11%;">Gloves</th>
            <th style="text-align:center;width:11%;">Pants</th>
            <th style="text-align:center;width:11%;">Boots</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:1rem;">
      <div class="badge-label">📦 Armory Inventory</div>
      ${renderArmoryInventory(armoryItems || [])}
    </div>`;
}

function renderArmoryInventory(items) {
  if (!items.length) return '<p class="muted">No armory items found.</p>';

  // Sort by type then name
  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });

  const rows = sorted.map(item => {
    const loanedPct = item.total > 0 ? Math.round((item.loaned / item.total) * 100) : 0;
    const barColor = loanedPct >= 80 ? '#e74c3c' : loanedPct >= 50 ? '#f0a500' : '#2ecc71';

    return `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td style="text-align:center;">${item.type}</td>
      <td style="text-align:center;">${item.slot.toUpperCase()}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${item.total}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#e74c3c;">${item.loaned}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#2ecc71;">${item.available}</td>
      <td style="text-align:center;width:100px;">
        <div style="background:#2a2828;border-radius:4px;height:8px;overflow:hidden;">
          <div style="width:${loanedPct}%;height:100%;background:${barColor};border-radius:4px;"></div>
        </div>
        <span style="font-size:0.7rem;color:#555;">${loanedPct}%</span>
      </td>
    </tr>`;
  }).join('');

  return `
    <div style="overflow-x:auto;margin-top:0.5rem;">
      <table class="members-table" style="font-size:0.85rem;">
        <thead>
          <tr>
            <th>Item Name</th>
            <th style="text-align:center;">Type</th>
            <th style="text-align:center;">Slot</th>
            <th style="text-align:center;">Total</th>
            <th style="text-align:center;">Loaned</th>
            <th style="text-align:center;">Available</th>
            <th style="text-align:center;">Usage</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
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
    '#', 'Name', 'Torn ID', 'Level', 'Position', 'Housing', 'Job Position',
    'Company', 'Energy', 'Max Energy', 'Donator',
    'Drug CD (seconds)', 'Booster CD (seconds)', 'Medical CD (seconds)',
    'Last Action', 'Strength', 'Defense', 'Speed', 'Dexterity', 'Total Stats',
    'API Key Saved', 'Key Last Updated'
  ];

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'Warlord': 4,
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
      m.level || '—',
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
      m.strength ?? '—',
      m.defense ?? '—',
      m.speed ?? '—',
      m.dexterity ?? '—',
      m.totalstats ?? '—',
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
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNumFull(m.strength)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNumFull(m.defense)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNumFull(m.speed)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNumFull(m.dexterity)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;font-weight:600;">${formatNumFull(m.totalstats)}</td>
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
async function removeUser(tornId, name) {
  if (!confirm(`Are you sure you want to remove ${name} from the dashboard?\n\nThis will delete their account and API key. They will need to log in again to re-register.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/admin/user/${tornId}`, { method: 'DELETE' });
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
        heading: 'Crime Record',
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
  war: {
    title: '🪖 War',
    sections: [
      {
        heading: 'War Panel',
        content: `
          <p class="help-text">The War Panel is available to Leaders, Co-leaders, and Warlords. It provides real-time war statistics and member readiness data to help coordinate faction war efforts.</p>
          <div class="help-callout warning">⚠️ This section is only visible to Leadership and Warlord ranks.</div>
        `
      },
      {
        heading: 'War Data Overview',
        content: `
          <p class="help-text">Shows enriched member data specifically for war planning. Includes energy levels, medical cooldowns, drug/booster cooldowns, and last action timestamps.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">↻ Refresh</strong> to load the latest member data</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Click any column header to sort members by that attribute</div></div>
          <div class="help-callout">💡 <span style="color:#f0a500;">★</span> = Donator (150+ max energy) &nbsp;|&nbsp; 💊 = Drug cooldown &nbsp;|&nbsp; ⚡ = Booster cooldown</div>
          <div class="help-callout">💡 Members with <span style="color:#ff4444;">red last action</span> have been offline 23+ hours and may not be war-ready.</div>
        `
      },
      {
        heading: 'War Stats',
        content: `
          <p class="help-text">Displays current ranked war statistics including faction scores, total hits, and individual member contributions.</p>
          <div class="help-callout">💡 Click <strong style="color:#c0bcbc;">↻ Refresh</strong> to update war stats from the Torn API.</div>
          <div class="help-callout">💡 The hit list shows which members have contributed the most respect in the current war.</div>
        `
      }
    ]
  },
  oc: {
    title: '🗝️ OC Tracking',
    sections: [
      {
        heading: 'Organized Crime Tracking',
        content: `
          <p class="help-text">The OC Tracking section helps you monitor organized crime attempts, participant performance, and individual member OC history.</p>
          <div class="help-callout">💡 Data is pulled from the Torn faction API and updated when you click Refresh.</div>
        `
      },
      {
        heading: 'Recent Crimes',
        content: `
          <p class="help-text">Shows a list of recent organized crime attempts with details including participants, pass rates, money earned, and respect gained.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Use the <strong style="color:#c0bcbc;">time range dropdown</strong> to filter crimes by date (7 days to all time)</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Use the <strong style="color:#c0bcbc;">Status</strong> filter to show pending, succeeded, or failed crimes</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Use the <strong style="color:#c0bcbc;">Sort</strong> dropdown to order by date, money, or respect</div></div>
          <div class="help-step"><div class="help-step-num">4</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">↻ Refresh</strong> to pull the latest OC data from Torn</div></div>
          <div class="help-callout">💡 Each crime card shows the crime name, status, participant count, average pass rate, and a preview of participants with their roles and checkpoint pass rates.</div>
        `
      },
      {
        heading: 'Member History',
        content: `
          <p class="help-text">Click the <strong style="color:#c0bcbc;">📊 Member History</strong> button to view an individual member's OC participation history.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Select a member from the dropdown list</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">View History</strong> to see their OC record</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">View their role performance by crime and full participation history</div></div>
          <div class="help-callout">💡 The role performance section shows each member's best checkpoint pass rate for each role they've performed in different crimes.</div>
          <div class="help-callout">💡 Click <strong style="color:#c0bcbc;">↻ Refresh</strong> in the history view to pull the latest data before viewing.</div>
        `
      }
    ]
  },
  admin: {
    title: '🛡️ Admin',
    sections: [
      {
        heading: 'Admin Panel',
        content: `
          <p class="help-text">The Admin Panel is available to Leaders and Co-leaders. It provides comprehensive faction management tools including member oversight, inventory tracking, and financial records.</p>
          <div class="help-callout warning">⚠️ This section is only visible to Leadership ranks.</div>
        `
      },
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
        heading: 'Faction Loans',
        content: `
          <p class="help-text">Shows which members have faction armor and weapons loaned out. The armory inventory section displays total counts, loaned items, and available stock for each item type.</p>
          <div class="help-callout">💡 Usage bars show what percentage of each item type is currently loaned out.</div>
        `
      },
      {
        heading: 'Weapon & Armor Inventory',
        content: `
          <p class="help-text">Complete inventory of faction weapons and armor available in the armory. Shows total count, loaned items, and available stock for each item.</p>
          <div class="help-callout">💡 Click <strong style="color:#c0bcbc;">↻ Refresh</strong> to update inventory from the Torn API.</div>
        `
      },
      {
        heading: 'Medical Inventory',
        content: `
          <p class="help-text">Medical supplies available in the faction armory (rope, first aid kits, etc.). Shows total count, loaned items, available stock, and usage percentage.</p>
          <div class="help-callout">💡 Usage bars show what percentage of each item type is currently loaned out. Red = high usage (80%+), orange = moderate (50%+), green = low.</div>
        `
      },
      {
        heading: 'Drug Inventory',
        content: `
          <p class="help-text">Drugs available in the faction armory (Xans, Vicodin, etc.). Shows total count, loaned items, available stock, and usage percentage.</p>
          <div class="help-callout">💡 Usage bars show what percentage of each item type is currently loaned out.</div>
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

function formatNumFull(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

// ── Faction Edit Mode (Ownership only) ───────────────────────────────────────
function toggleFactionEditMode() {
  const btn = document.getElementById('edit-faction-btn');
  const saveContainer = document.getElementById('faction-save-container');
  const bloodTypeInputs = document.querySelectorAll('.faction-bloodtype input');
  const timeZoneInputs = document.querySelectorAll('.faction-timezone input');

  const isEditing = !saveContainer.style.display || saveContainer.style.display === 'none';
  
  if (isEditing) {
    btn.textContent = '❌ Cancel Edit';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-danger');
    saveContainer.style.display = 'block';
    
    bloodTypeInputs.forEach(input => input.disabled = false);
    timeZoneInputs.forEach(input => input.disabled = false);
  // Set styling for active selects
  document.querySelectorAll('.faction-timezone select').forEach(select => {
    select.style.background = '#2a2828';
    select.style.borderColor = '#444';
  });
  } else {
    cancelFactionEditMode();
  }
}

function cancelFactionEditMode() {
  const btn = document.getElementById('edit-faction-btn');
  const saveContainer = document.getElementById('faction-save-container');
  const bloodTypeInputs = document.querySelectorAll('.faction-bloodtype input');
  const timeZoneInputs = document.querySelectorAll('.faction-timezone input');

  btn.textContent = '✏️ Edit Mode';
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-primary');
  saveContainer.style.display = 'none';
  
  bloodTypeInputs.forEach(input => input.disabled = true);
  timeZoneInputs.forEach(input => input.disabled = true);
  // Reset styling for disabled selects
  document.querySelectorAll('.faction-timezone select').forEach(select => {
    select.style.background = '#1a1919';
    select.style.borderColor = '#333';
  });
  
  // Refresh to revert unsaved changes
  fetchFaction();
}

async function saveFactionProfileChanges() {
  const bloodTypeInputs = document.querySelectorAll('.faction-bloodtype input');
  const timeZoneInputs = document.querySelectorAll('.faction-timezone input');
  
  const updates = [];
  const playerIds = new Set();
  
  bloodTypeInputs.forEach(input => {
    const playerId = input.closest('[data-playerid]').dataset.playerid;
    playerIds.add(playerId);
  });
  
  playerIds.forEach(playerId => {
    const bloodType = document.querySelector(`.faction-bloodtype[data-playerid="${playerId}"] input`)?.value?.trim() || '';
    const timeZone = document.querySelector(`.faction-timezone[data-playerid="${playerId}"] select`)?.value?.trim() || '';
    
    updates.push({
      tornPlayerId: parseInt(playerId),
      bloodType: bloodType || null,
      timeZone: timeZone || null
    });
  });

  try {
    const res = await fetch('/api/admin/members/profiles', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      alert(`❌ Save failed: ${data.error}`);
      return;
    }
    
    alert(`✅ Successfully saved ${data.modified} profile(s)!`);
    cancelFactionEditMode();
    
  } catch (err) {
    alert(`❌ Error saving changes: ${err.message}`);
  }
}

// Examples:
// 123456789 -> "123,456,789"
// 1000      -> "1,000"



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
  const baseRates = data.baseRates || {};
  const bankInvestmentMerit = data.bankInvestmentMerit || 0;
  const meritBonus = data.meritBonus || 0;
  const lastUpdated = data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'Unknown';

  const rateRows = [
    { period: '1 Week', key: '1_week', rate: rates['1_week'], baseRate: baseRates['1_week'] },
    { period: '2 Weeks', key: '2_weeks', rate: rates['2_weeks'], baseRate: baseRates['2_weeks'] },
    { period: '1 Month', key: '1_month', rate: rates['1_month'], baseRate: baseRates['1_month'] },
    { period: '2 Months', key: '2_months', rate: rates['2_months'], baseRate: baseRates['2_months'] },
    { period: '3 Months', key: '3_months', rate: rates['3_months'], baseRate: baseRates['3_months'] }
  ];

  const rows = rateRows.map(r => {
    const percentage = (r.rate || 0).toFixed(2);
    const basePercentage = r.baseRate !== undefined ? (r.baseRate || 0).toFixed(2) : null;
    return `
    <tr>
      <td>${r.period}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">
        ${percentage}%
        ${bankInvestmentMerit > 0 && basePercentage !== null ? `<span style="font-size:0.7rem;color:#888;display:block;">(Base: ${basePercentage}%)</span>` : ''}
      </td>
      <td style="text-align:right;color:#888;font-size:0.8rem;">${formatRateDescription(parseFloat(percentage))}</td>
    </tr>`;
  }).join('');

  const meritInfo = bankInvestmentMerit > 0
    ? `<span style="float:left;font-size:0.75rem;color:#4caf50;margin-right:10px;">🏆 Bank Investment Merit: Level ${bankInvestmentMerit} (+${meritBonus}%)</span>`
    : '<span style="float:left;font-size:0.75rem;color:#888;margin-right:10px;">No Bank Investment Merit</span>';

  return `
    <div class="card">
      <div class="card-header">
        ${meritInfo}
        <span style="float:right;font-size:0.8rem;color:#555;">Updated: ${lastUpdated}</span>
      </div>
      <div style="overflow-x:auto; width:100%;">
        <table class="members-table">
          <thead>
            <tr>
              <th>Time Period</th>
              <th style="text-align:center;">Interest Rate</th>
              <th style="text-align:center;">Description</th>
            </tr>
          </thead>
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
  // Remove any currency formatting (commas, $ signs) before parsing
  const rawValue = amountInput.value.replace(/[$,]/g, '');
  const amount = parseFloat(rawValue);

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
  // Calculate period interest: (Amount * APR) * (Days / 365)
  const earnings = Math.floor((amount * (rate / 100)) * (r.days / 365));
  const total = amount + earnings;

  return `
    <tr>
      <td>${r.period}</td>
      <td style="text-align:center;">${rate}%</td>
      <td style="text-align:right;color:#4caf50;">+$${formatNum(earnings)}</td>
      <td style="text-align:right;">$${formatNum(total)}</td>
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
  const baseInterest = principal * (ratePercent / 100);
  const meritInterest = baseInterest * (meritsBonus / 100);
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

// ═══════════════════════════════════════════════════════════════════════════════
// TRAVEL PROFITS
// ═══════════════════════════════════════════════════════════════════════════════

let travelProfitsCache = null;

async function fetchTravelProfits() {
  const container = document.getElementById('travel-profits-data');
  container.innerHTML = '<div class="channel-loading">LOADING TRAVEL PROFITS...</div>';
  try {
    const res = await fetch('/api/travel-profits');
    const data = await res.json();
    if (!res.ok) {
      let errorMsg = `<div class="channel-error">⚠️ ${data.error}</div>`;
      if (data.help) {
        errorMsg += `<div class="channel-error" style="margin-top:0.5rem;padding:0.75rem;background:#1a1919;border:1px solid #333;border-radius:4px;font-size:0.85rem;">
          <strong style="color:#f0a500;">How to fix:</strong><br>
          ${data.help}<br><br>
          <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" style="color:#a78df5;">Go to API Key Settings →</a>
        </div>`;
      }
      container.innerHTML = errorMsg;
      return;
    }
    travelProfitsCache = data;
    renderTravelProfits();
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderTravelProfits() {
  const container = document.getElementById('travel-profits-data');

  if (!travelProfitsCache || !travelProfitsCache.profits || !travelProfitsCache.profits.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💰</span>
        <p>No profitable items found.</p>
        <p class="muted">Items may not be available or market prices may not exceed foreign costs.</p>
      </div>`;
    return;
  }

  // Get travel method from radio buttons
  const travelMethod = document.querySelector('input[name="travelMethod"]:checked')?.value || 'standard';

  // Get quantity from input (default 25, min 5, max 29)
  const quantityInput = document.getElementById('profit-quantity');
  let quantity = parseInt(quantityInput?.value) || 25;
  quantity = Math.max(5, Math.min(29, quantity));

  // Get item types from checkboxes
  const typePlushie = document.getElementById('type-plushie')?.checked ?? true;
  const typeFlower = document.getElementById('type-flower')?.checked ?? true;
  const typeDrug = document.getElementById('type-drug')?.checked ?? true;
  const typeOther = document.getElementById('type-other')?.checked ?? false;

  const sortBy = document.getElementById('profit-sort')?.value || 'profitPerRun';

  let profits = [...travelProfitsCache.profits];

  // Filter by item type using checkboxes
  profits = profits.filter(p => {
    const type = p.type.toLowerCase();
    // Normalize type to singular form for comparison
    const normalizedType = type.endsWith('s') ? type.slice(0, -1) : type;

    if (normalizedType === 'plushie' && typePlushie) return true;
    if (normalizedType === 'flower' && typeFlower) return true;
    if (normalizedType === 'drug' && typeDrug) return true;
    if (!['plushie', 'flower', 'drug'].includes(normalizedType) && typeOther) return true;

    return false;
  });

  // Sort
  switch (sortBy) {
    case 'profit':
      profits.sort((a, b) => b.profit - a.profit);
      break;
    case 'profitPercent':
      profits.sort((a, b) => b.profitPercent - a.profitPercent);
      break;
    case 'country':
      profits.sort((a, b) => a.country.localeCompare(b.country));
      break;
    case 'profitPerRun':
    default:
      // Sort by profit per run (profit per item × quantity)
      profits.sort((a, b) => (b.profit * quantity) - (a.profit * quantity));
      break;
  }

  // Group by country
  const grouped = {};
  profits.forEach(p => {
    if (!grouped[p.country]) grouped[p.country] = [];
    grouped[p.country].push(p);
  });

  const summary = travelProfitsCache.summary || {};

  // Find the best profit per run (highest profit × quantity)
  const bestRun = profits.length > 0 ? profits.reduce((best, current) => {
    const bestProfit = best.profit * quantity;
    const currentProfit = current.profit * quantity;
    return currentProfit > bestProfit ? current : best;
  }) : null;

  let html = `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        💰 Travel Profits Summary
        <span style="float:right;font-size:0.8rem;color:#555;">
          ${profits.length} items across ${Object.keys(grouped).length} countries
        </span>
      </div>
      <div class="card-body">
        <div class="stats-grid">
          ${bestRun ? statTile('+' + formatNum(bestRun.profit * quantity), 'Best Profit/Run') : statTile('—', 'Best Profit/Run')}
          ${bestRun ? statTile(getCountryName(bestRun.country), 'Best Country') : statTile('—', 'Best Country')}
          ${bestRun ? statTile(escapeHtml(bestRun.name), 'Best Item') : statTile('—', 'Best Item')}
          ${statTile(travelMethod === 'standard' ? '✈️ Standard' : travelMethod === 'airstrip' ? '🛫 Airstrip' : '🚀 Private', 'Travel Method')}
        </div>
      </div>
    </div>`;

  Object.entries(grouped).forEach(([country, items]) => {
    const countryTotal = items.reduce((sum, p) => sum + (p.profit * quantity), 0);
    const travelTime = items[0].travelTimes[travelMethod];

    const rows = items.map(item => {
      const profitPerRun = item.profit * quantity;

      // Format best leave time display (to arrive at restock time)
      let restockDisplay = '<span style="color:#555;">—</span>';

      if (item.minutesUntilLeave !== null && item.minutesUntilLeave !== undefined) {
        const minsUntilLeave = item.minutesUntilLeave;
        const leaveTime = item.bestLeaveTime || '—';

        if (minsUntilLeave <= 0) {
          // Should leave now to arrive at restock
          restockDisplay = `<span style="color:#4caf50;font-weight:600;">Leave Now!<br><small>Restock: ${leaveTime}</small></span>`;
        } else if (minsUntilLeave < 60) {
          // Leave in X minutes
          restockDisplay = `<span style="color:#219653;">In ${minsUntilLeave}m<br><small>Leave at ${leaveTime}</small></span>`;
        } else {
          const h = Math.floor(minsUntilLeave / 60);
          const m = minsUntilLeave % 60;
          restockDisplay = `<span style="color:#219653;">In ${h}h ${m}m<br><small>Leave at ${leaveTime}</small></span>`;
        }
      } else if (item.estimatedRestockIn !== null && item.estimatedRestockIn !== undefined) {
        // Fallback: just show restock countdown
        const mins = item.estimatedRestockIn;
        if (mins <= 0) {
          restockDisplay = '<span style="color:#4caf50;font-weight:600;">Restocking Now</span>';
        } else if (mins < 60) {
          restockDisplay = `<span style="color:#f0a500;">~${mins}m to restock</span>`;
        } else {
          const h = Math.floor(mins / 60);
          restockDisplay = `<span style="color:#ff9800;">~${h}h to restock</span>`;
        }
      }

      return `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td style="color:#888;font-size:0.85rem;">${escapeHtml(item.type)}</td>
          <td style="text-align:center;">${item.quantity.toLocaleString()}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;">$${formatNum(item.buyPrice)}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;">$${formatNum(item.marketValue)}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;color:#4caf50;">+$${formatNum(item.profit)}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${item.profitPercent.toFixed(1)}%</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;color:#f0a500;">+$${formatNum(profitPerRun)}</td>
          <!-- <td style="text-align:center;font-size:0.85rem;">${restockDisplay}</td> -->
        </tr>`;
    }).join('');

    html += `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">
          🌍 ${getCountryName(country)}
          <span style="float:right;font-size:0.75rem;color:#555;">
            Travel: ~${travelTime}min | Total: $${formatNum(countryTotal)}
          </span>
        </div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
          <table class="members-table" style="min-width:700px;">
            <thead>
              <tr>
                <th style="white-space:nowrap;">Item</th>
                <th style="white-space:nowrap;">Type</th>
                <th style="text-align:center;white-space:nowrap;">Avail</th>
                <th style="text-align:right;white-space:nowrap;">Buy</th>
                <th style="text-align:right;white-space:nowrap;">Market</th>
                <th style="text-align:right;white-space:nowrap;">Profit</th>
                <th style="text-align:right;white-space:nowrap;">%</th>
                <th style="text-align:right;white-space:nowrap;">Run</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

function getCountryName(code) {
  const names = {
    mex: 'Mexico', cay: 'Cayman Islands', can: 'Canada',
    haw: 'Hawaii', uni: 'United Kingdom', arg: 'Argentina',
    swi: 'Switzerland', jap: 'Japan', chi: 'China',
    uae: 'UAE', sou: 'South Africa'
  };
  return names[code] || code;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORGANIZED CRIME TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

let ocCrimesCache = [];

// Override showSection to include OC handling
const _originalShowSection = window.showSection;
window.showSection = function (sectionId, el) {
  _originalShowSection(sectionId, el);
  if (sectionId === 'oc') {
    // Only show existing data on section switch, don't auto-refresh
    // User must click Refresh button to get new data
    if (ocCrimesCache.length === 0) {
      // If no data cached yet, fetch from our API (which returns stored data)
      fetchStoredCrimes();
    }
  }
};

// ─── Fetch stored crimes (without triggering API refresh) ─────────────────────
async function fetchStoredCrimes() {
  const container = document.getElementById('oc-crimes-data');
  const daysSelect = document.getElementById('oc-days-back');
  const daysValue = daysSelect ? daysSelect.value : '30';

  container.innerHTML = '<div class="channel-loading">LOADING OC DATA...</div>';

  try {
    const params = new URLSearchParams();
    if (daysValue !== 'all') {
      params.append('daysBack', daysValue);
    }

    // Just fetch stored data, don't refresh
    const res = await fetch('/api/oc/crimes?' + params.toString());
    const data = await res.json();

    if (!res.ok) {
      container.innerHTML = `<div class="channel-error">⚠️ ${data.error || 'Failed to load OC data'}</div>`;
      return;
    }

    ocCrimesCache = data;
    renderCrimes();
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

// ─── Refresh OC Crimes ─────────────────────────────────────────────────────────
async function refreshCrimes() {
  const container = document.getElementById('oc-crimes-data');
  const daysSelect = document.getElementById('oc-days-back');
  const daysValue = daysSelect ? daysSelect.value : '30';

  container.innerHTML = '<div class="channel-loading">LOADING OC DATA...</div>';

  try {
    const params = new URLSearchParams();
    if (daysValue !== 'all') {
      params.append('daysBack', daysValue);
    }

    // First refresh from API
    const refreshRes = await fetch('/api/oc/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daysBack: daysValue === 'all' ? undefined : parseInt(daysValue) })
    });

    // Then fetch the crimes list
    const res = await fetch('/api/oc/crimes?' + params.toString());
    const data = await res.json();

    if (!res.ok) {
      container.innerHTML = `<div class="channel-error">⚠️ ${data.error || 'Failed to load OC data'}</div>`;
      return;
    }

    ocCrimesCache = data;
    renderCrimes();
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

// ─── Filter & Sort Crimes ──────────────────────────────────────────────────────
function filterCrimes() {
  renderCrimes();
}

function renderCrimes() {
  const container = document.getElementById('oc-crimes-data');
  const statusFilter = document.getElementById('oc-status-filter')?.value || 'all';
  const sortValue = document.getElementById('oc-sort')?.value || 'timeStarted-desc';

  let crimes = [...ocCrimesCache];

  // Apply status filter
  if (statusFilter !== 'all') {
    crimes = crimes.filter(c => c.status === statusFilter);
  }

  // Apply sorting
  const [sortKey, sortOrder] = sortValue.split('-');
  crimes.sort((a, b) => {
    let aVal = a[sortKey];
    let bVal = b[sortKey];

    if (sortKey === 'timeStarted') {
      aVal = aVal ? new Date(aVal).getTime() : 0;
      bVal = bVal ? new Date(bVal).getTime() : 0;
    }

    if (aVal == null) aVal = 0;
    if (bVal == null) bVal = 0;

    return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
  });

  if (crimes.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">🗝️</span><p>No crimes found matching your filters.</p></div>';
    return;
  }

  container.innerHTML = crimes.map(crime => renderCrimeCard(crime)).join('');
}

// ─── Render Single Crime Card ──────────────────────────────────────────────────
function renderCrimeCard(crime) {
  const statusIcon = {
    'pending': '⏳',
    'succeeded': '✅',
    'failed': '❌'
  }[crime.status] || '⏳';

  const statusColor = {
    'pending': '#f0a500',
    'succeeded': '#4caf50',
    'failed': '#ff4444'
  }[crime.status] || '#888';

  const startDate = crime.timeStarted ? new Date(crime.timeStarted).toLocaleString() : 'N/A';
  const completedDate = crime.timeCompleted ? new Date(crime.timeCompleted).toLocaleString() : 'N/A';
  const timeLeft = crime.timeLeft ? formatTimeLeft(crime.timeLeft) : '';

  const avgPassRate = crime.averagePassRate !== undefined ? crime.averagePassRate + '%' : 'N/A';
  const participantCount = crime.participantCount || (crime.participants ? crime.participants.length : 0);

  // Status badge
  const statusBadge = `<span style="color:${statusColor};font-weight:600;">${statusIcon} ${crime.status.toUpperCase()}</span>`;

  // Participants preview - show Member, Role, Tool, Pass Rate
  const participantsPreview = (crime.participants || []).slice(0, 5).map(p => {
    const name = p.playerName || `Player ${p.playerId}`;
    const role = p.role || 'Unknown';
    const tool = p.tool || 'N/A';
    const passRate = p.checkpointPassRate !== null ? p.checkpointPassRate + '%' : '—';
    const passStatus = p.checkpointStatus === 'passed' ? '✅' : p.checkpointStatus === 'failed' ? '❌' : '⏳';
    return `<tr>
      <td>${escapeHtml(name)}</td>
      <td style="color:#888;font-size:0.85rem;">${escapeHtml(role)}</td>
      <td style="color:#888;font-size:0.85rem;">${escapeHtml(tool)}</td>
      <td style="text-align:center;">${passRate} ${passStatus}</td>
    </tr>`;
  }).join('');

  const moreParticipants = (crime.participants || []).length > 5
    ? `<tr><td colspan="4" class="muted" style="text-align:center;padding:0.5rem;">...and ${(crime.participants || []).length - 5} more</td></tr>`
    : '';

  return `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
        <div>
          ${statusBadge}
          <span style="margin-left:0.75rem;font-size:1rem;">🗝️ ${escapeHtml(crime.crimeName)}</span>
        </div>
        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
          <span style="font-size:0.8rem;color:#555;">${participantCount} participants</span>
          <span style="font-size:0.8rem;color:#555;">Avg Pass: ${avgPassRate}</span>
        </div>
      </div>
      <div class="card-body">
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:1rem;">
          ${infoBadge('Started', startDate)}
          ${crime.timeReady ? infoBadge('Ready', new Date(crime.timeReady).toLocaleString()) : ''}
          ${crime.timeCompleted ? infoBadge('Completed', completedDate) : ''}
          ${timeLeft ? infoBadge('Time Left', timeLeft) : ''}
          ${crime.moneyGain ? infoBadge('Money', '$' + crime.moneyGain.toLocaleString()) : ''}
          ${crime.respectGain ? infoBadge('Respect', '+' + crime.respectGain.toLocaleString()) : ''}
        </div>
        
        <div style="margin-top:1rem;">
          <div class="badge-label">Participants</div>
          <div style="overflow-x:auto;">
            <table class="members-table" style="width:100%;">
              <thead><tr>
                <th>Member</th>
                <th>Role</th>
                <th>Tool</th>
                <th style="text-align:center;">Pass Rate</th>
              </tr></thead>
              <tbody>${participantsPreview}
                ${moreParticipants}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function formatTimeLeft(seconds) {
  if (seconds <= 0) return 'Expired';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Show Crime Details Modal ──────────────────────────────────────────────────
async function showCrimeDetails(crimeId) {
  const modal = document.getElementById('oc-participant-modal');
  const title = document.getElementById('participant-modal-title');
  const body = document.getElementById('participant-modal-body');

  body.innerHTML = '<div class="channel-loading">LOADING...</div>';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/oc/crimes/${crimeId}`);
    const crime = await res.json();

    if (!res.ok) {
      body.innerHTML = `<div class="channel-error">⚠️ ${crime.error}</div>`;
      return;
    }

    title.textContent = `🗝️ ${crime.crimeName} - Participants`;

    // Render full participant list with ability to update checkpoint rates
    const participantRows = (crime.participants || []).map((p, index) => {
      const statusColor = p.status?.color === 'green' ? '#4caf50' : p.status?.color === 'red' ? '#ff4444' : '#4a90e2';
      const name = p.playerName || `Player ${p.playerId}`;
      const role = p.role || 'Unknown';
      const passRate = p.checkpointPassRate !== null ? p.checkpointPassRate : '';
      const checkpointStatus = p.checkpointStatus || 'pending';

      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td style="color:#888;font-size:0.85rem;">${escapeHtml(role)}</td>
          <td><span style="color:${statusColor};">${p.status?.state || 'Unknown'}</span></td>
          <td style="text-align:center;">
            <input type="number" min="0" max="100" 
              value="${passRate}" 
              placeholder="—"
              id="checkpoint-${p.playerId}"
              style="width:60px;background:#1a1919;border:1px solid #333;color:#c0bcbc;border-radius:4px;padding:2px 4px;font-size:0.85rem;text-align:center;"
              onchange="updateCheckpointStatus(this, ${p.playerId})" />
            <span id="status-${p.playerId}" style="margin-left:4px;font-size:0.75rem;">
              ${checkpointStatus === 'passed' ? '✅' : checkpointStatus === 'failed' ? '❌' : '—'}
            </span>
          </td>
        </tr>`;
    }).join('');

    body.innerHTML = `
      <div style="margin-bottom:1rem;">
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
          ${infoBadge('Status', crime.status.toUpperCase())}
          ${infoBadge('Started', crime.timeStarted ? new Date(crime.timeStarted).toLocaleString() : 'N/A')}
          ${infoBadge('Completed', crime.timeCompleted ? new Date(crime.timeCompleted).toLocaleString() : 'Pending')}
          ${crime.moneyGain ? infoBadge('Money', '$' + crime.moneyGain.toLocaleString()) : ''}
          ${crime.respectGain ? infoBadge('Respect', '+' + crime.respectGain.toLocaleString()) : ''}
          ${infoBadge('Participants', crime.participants.length)}
          ${crime.averagePassRate !== undefined ? infoBadge('Avg Pass Rate', crime.averagePassRate + '%') : ''}
        </div>
      </div>
      <div class="badge-label">All Participants</div>
      <p class="muted" style="font-size:0.75rem;margin-bottom:0.5rem;">Enter checkpoint pass rate (0-100%) for each participant. Rates ≥50% are marked as passed.</p>
      <div style="overflow-x:auto;max-height:400px;overflow-y:auto;">
        <table class="members-table" style="width:100%;">
          <thead><tr>
            <th>Name</th>
            <th>Role</th>
            <th style="text-align:center;">Status</th>
            <th style="text-align:center;">Pass Rate %</th>
          </tr></thead>
          <tbody>${participantRows}</tbody>
        </table>
      </div>
      <div style="margin-top:1rem;text-align:right;">
        <button class="btn btn-primary" onclick="saveAllCheckpoints(${crimeId})">💾 Save All Checkpoints</button>
      </div>`;
  } catch (err) {
    body.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

// ─── Update checkpoint status visual ───────────────────────────────────────────
function updateCheckpointStatus(input, playerId) {
  const val = parseInt(input.value);
  const statusEl = document.getElementById(`status-${playerId}`);
  if (isNaN(val)) {
    statusEl.textContent = '—';
  } else if (val >= 50) {
    statusEl.textContent = '✅';
  } else {
    statusEl.textContent = '❌';
  }
}

// ─── Save all checkpoints ──────────────────────────────────────────────────────
async function saveAllCheckpoints(crimeId) {
  const crime = ocCrimesCache.find(c => c.crimeId === crimeId);
  if (!crime) return;

  const participantRates = {};
  (crime.participants || []).forEach(p => {
    const input = document.getElementById(`checkpoint-${p.playerId}`);
    if (input && input.value !== '') {
      participantRates[p.playerId] = parseInt(input.value);
    }
  });

  if (Object.keys(participantRates).length === 0) {
    alert('Please enter at least one checkpoint pass rate.');
    return;
  }

  try {
    const res = await fetch(`/api/oc/crimes/${crimeId}/checkpoints`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantRates })
    });

    const result = await res.json();
    if (res.ok) {
      alert('✅ Checkpoint rates saved successfully!');
      // Refresh the crime list
      refreshCrimes();
    } else {
      alert('❌ ' + (result.error || 'Failed to save'));
    }
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
}

// ─── Open Participant History Widget ───────────────────────────────────────────
async function openParticipantHistoryWidget() {
  const modal = document.getElementById('oc-participant-modal');
  const title = document.getElementById('participant-modal-title');
  const body = document.getElementById('participant-modal-body');

  title.textContent = '📊 Member OC History';

  // Build dropdown of all unique participants from cached crimes
  const participantMap = new Map();
  ocCrimesCache.forEach(crime => {
    (crime.participants || []).forEach(p => {
      if (p.playerId && p.playerName) {
        participantMap.set(p.playerId, p.playerName);
      }
    });
  });

  const participants = Array.from(participantMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));

  const options = participants.map(([id, name]) =>
    `<option value="${id}">${escapeHtml(name)}</option>`
  ).join('');

  body.innerHTML = `
    <div style="margin-bottom:1rem;">
      <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;">Select a member to view their OC history:</label>
      <select id="participant-history-select" style="width:100%;padding:0.5rem;background:#1a1919;border:1px solid #333;color:#c0bcbc;border-radius:4px;font-size:0.9rem;">
        <option value="">— Select a member —</option>
        ${options}
      </select>
      <button class="btn btn-primary" style="margin-top:0.75rem;" onclick="loadParticipantHistoryFromWidget()">View History</button>
    </div>
    <div id="participant-history-results"></div>`;

  modal.style.display = 'flex';
}

// ─── Load Participant History from Widget ──────────────────────────────────────
async function loadParticipantHistoryFromWidget() {
  const select = document.getElementById('participant-history-select');
  const playerId = select.value;
  if (!playerId) {
    alert('Please select a member.');
    return;
  }

  const playerName = select.options[select.selectedIndex].text;
  viewParticipantHistory(parseInt(playerId), playerName);
}

// ─── Close participant modal ───────────────────────────────────────────────────
function closeParticipantModal(event) {
  if (event.target === event.currentTarget) {
    event.currentTarget.style.display = 'none';
  }
}

// ─── Refresh Participant History ───────────────────────────────────────────────
async function refreshParticipantHistory(playerId, playerName) {
  // First refresh the OC crimes from API
  const container = document.getElementById('oc-crimes-data');
  const daysSelect = document.getElementById('oc-days-back');
  const daysValue = daysSelect ? daysSelect.value : '30';

  try {
    const params = new URLSearchParams();
    if (daysValue !== 'all') {
      params.append('daysBack', daysValue);
    }

    // Refresh from API
    await fetch('/api/oc/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daysBack: daysValue === 'all' ? undefined : parseInt(daysValue) })
    });

    // Then fetch updated crimes
    const res = await fetch('/api/oc/crimes?' + params.toString());
    const data = await res.json();

    if (res.ok) {
      ocCrimesCache = data;
      // Re-build the participant map from refreshed data
      const participantMap = new Map();
      ocCrimesCache.forEach(crime => {
        (crime.participants || []).forEach(p => {
          if (p.playerId && p.playerName) {
            participantMap.set(p.playerId, p.playerName);
          }
        });
      });

      // Now view the participant history with refreshed data
      viewParticipantHistory(playerId, playerName);
    }
  } catch (err) {
    alert('❌ Error refreshing: ' + err.message);
  }
}

// ─── View participant history ──────────────────────────────────────────────────
async function viewParticipantHistory(playerId, playerName) {
  try {
    const res = await fetch(`/api/oc/participants/${playerId}`);
    const data = await res.json();

    if (!res.ok) {
      alert('❌ ' + (data.error || 'Failed to load history'));
      return;
    }

    const history = data.history || [];

    // Build role-based statistics grouped by crime name
    const crimeRoles = {};
    const crimeOrder = [];

    history.forEach(h => {
      const crimeName = h.crimeName;
      if (!crimeRoles[crimeName]) {
        crimeRoles[crimeName] = {};
        crimeOrder.push(crimeName);
      }

      // Get the role from the crime participants
      const crime = ocCrimesCache.find(c => c.crimeId === h.crimeId);
      if (crime) {
        const participant = crime.participants.find(p => p.playerId === playerId);
        if (participant && participant.role) {
          const role = participant.role;
          const passRate = h.checkpointPassRate;

          if (!crimeRoles[crimeName][role] || (passRate !== null && passRate > (crimeRoles[crimeName][role].best || -1))) {
            crimeRoles[crimeName][role] = {
              best: passRate,
              count: (crimeRoles[crimeName][role]?.count || 0) + 1
            };
          }
        }
      }
    });

    // Build role display for each crime
    let roleStatsHtml = '';
    crimeOrder.forEach(crimeName => {
      const roles = crimeRoles[crimeName];
      const roleEntries = Object.entries(roles);

      if (roleEntries.length === 0) return;

      const roleBoxes = roleEntries.map(([role, data]) => {
        const displayRate = data.best !== null ? data.best + '%' : '—';
        const countInfo = data.count > 1 ? `<br><small style="color:#555;">(${data.count}x)</small>` : '';
        return `<div style="text-align:center;padding:0.5rem;background:#1a1919;border:1px solid #2a2828;border-radius:4px;">
          <div style="font-size:0.75rem;color:#555;margin-bottom:0.25rem;">${escapeHtml(role)}</div>
          <div style="font-size:1.1rem;color:#c0bcbc;font-family:'Share Tech Mono',monospace;">${displayRate}${countInfo}</div>
        </div>`;
      }).join('');

      roleStatsHtml += `
        <div class="card" style="margin-bottom:0.75rem;">
          <div class="card-header" style="padding:0.5rem 0.75rem;font-size:0.85rem;">🗝️ ${escapeHtml(crimeName)}</div>
          <div class="card-body" style="padding:0.5rem 0.75rem;">
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              ${roleBoxes}
            </div>
          </div>
        </div>`;
    });

    const historyRows = history.map(h => {
      // Get the role from the crime
      const crime = ocCrimesCache.find(c => c.crimeId === h.crimeId);
      let role = '—';
      if (crime) {
        const participant = crime.participants.find(p => p.playerId === playerId);
        if (participant && participant.role) {
          role = escapeHtml(participant.role);
        }
      }
      const passRate = h.checkpointPassRate !== null ? h.checkpointPassRate + '%' : '—';
      return `<tr>
        <td style="font-family:'Share Tech Mono',monospace;font-size:0.85rem;">#${h.crimeId}</td>
        <td>${escapeHtml(h.crimeName)}</td>
        <td style="color:#888;font-size:0.85rem;">${role}</td>
        <td style="text-align:center;">${passRate}</td>
        <td style="text-align:right;">+${(h.respectGain || 0).toLocaleString()}</td>
      </tr>`;
    }).join('');

    const modal = document.getElementById('oc-participant-modal');
    document.getElementById('participant-modal-title').innerHTML = `
      <span>📊 ${playerName} - OC History</span>
      <div style="display:flex;gap:0.5rem;">
        <button class="btn btn-small btn-outline" onclick="openParticipantHistoryWidget()" title="Choose Another Member">👥 Choose Another</button>
        <button class="btn btn-small btn-outline" onclick="refreshParticipantHistory(${playerId}, '${playerName.replace(/'/g, "\\'")}')" title="Refresh History">↻ Refresh</button>
      </div>`;
    document.getElementById('participant-modal-body').innerHTML = `
      <div class="badge-label" style="margin-top:0;">Role Performance by Crime</div>
      <p class="muted" style="font-size:0.75rem;margin-bottom:0.75rem;">Shows each member's highest pass rate for each role they've performed.</p>
      ${roleStatsHtml || '<div class="empty-state" style="margin-bottom:1rem;"><span class="empty-icon">📊</span><p>No role data available.</p></div>'}
      <div class="badge-label">Crime History</div>
      <div style="overflow-x:auto;max-height:400px;overflow-y:auto;">
        <table class="members-table" style="width:100%;">
          <thead><tr>
            <th>OC #</th>
            <th>Crime Name</th>
            <th>Role</th>
            <th style="text-align:center;">Pass Rate</th>
            <th style="text-align:right;">Respect</th>
          </tr></thead>
          <tbody>${historyRows || '<tr><td colspan="5" class="muted" style="padding:1rem;">No history found</td></tr>'}</tbody>
        </table>
      </div>`;
    modal.style.display = 'flex';
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

function showAdminTab(tabId, el) {
  // Deactivate all tabs
  document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.remove('active'));
  // Hide all tab content
  document.querySelectorAll('.admin-tab-content').forEach(content => content.classList.remove('active'));

  // Activate clicked tab
  if (el) el.classList.add('active');

  // Show corresponding content
  const contentEl = document.getElementById('tab-' + tabId);
  if (contentEl) contentEl.classList.add('active');

  // Auto-fetch data when switching tabs
  switch (tabId) {
    case 'member-overview':
      if (document.getElementById('admin-overview-data').innerHTML.includes('empty-state')) {
        fetchMemberOverview();
      }
      break;
    case 'faction-loans':
      if (document.getElementById('admin-loans-data').innerHTML.includes('empty-state')) {
        fetchFactionLoans();
      }
      break;
    case 'weapon-armor':
      if (document.getElementById('admin-weapon-armor-data').innerHTML.includes('empty-state')) {
        fetchWeaponArmorInventory();
      }
      break;
    case 'medical-inventory':
      if (document.getElementById('admin-medical-inventory-data').innerHTML.includes('empty-state')) {
        fetchMedicalInventory();
      }
      break;
    case 'drug-inventory':
      if (document.getElementById('admin-drug-inventory-data').innerHTML.includes('empty-state')) {
        fetchDrugInventory();
      }
      break;
    case 'faction-register':
      if (document.getElementById('admin-faction-register-data').innerHTML.includes('empty-state')) {
        fetchFactionRegister();
      }
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY FETCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Weapon & Armor Inventory ─────────────────────────────────────────────────
async function fetchWeaponArmorInventory() {
  const container = document.getElementById('admin-weapon-armor-data');
  container.innerHTML = '<div class="channel-loading">LOADING WEAPON & ARMOR INVENTORY...</div>';
  try {
    const res = await fetch('/api/admin/weapon-armor-inventory');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderWeaponArmorInventory(data.items || []);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

function renderWeaponArmorInventory(items) {
  if (!items.length) {
    return '<div class="empty-state"><p class="muted">No weapon or armor items found in the armory.</p></div>';
  }

  // Separate weapons and armor
  const weapons = items.filter(item => item.type && item.type.toLowerCase() !== 'armor');
  const armor = items.filter(item => item.type && item.type.toLowerCase() === 'armor');

  let html = '';

  // Render Weapons
  if (weapons.length > 0) {
    const weaponRows = weapons.map(item => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td style="text-align:center;">${escapeHtml(item.type || '—')}</td>
        <td style="text-align:center;">${escapeHtml(item.slot || '—')}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${item.total || 0}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#e74c3c;">${item.loaned || 0}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#2ecc71;">${item.available || 0}</td>
      </tr>`).join('');

    html += `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">🔫 Weapons (${weapons.length} types)</div>
        <div style="overflow-x:auto;">
          <table class="members-table">
            <thead><tr>
              <th>Name</th>
              <th style="text-align:center;">Type</th>
              <th style="text-align:center;">Slot</th>
              <th style="text-align:center;">Total</th>
              <th style="text-align:center;">Loaned</th>
              <th style="text-align:center;">Available</th>
            </tr></thead>
            <tbody>${weaponRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // Render Armor
  if (armor.length > 0) {
    const armorRows = armor.map(item => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td style="text-align:center;">${escapeHtml(item.slot || '—')}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${item.total || 0}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#e74c3c;">${item.loaned || 0}</td>
        <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#2ecc71;">${item.available || 0}</td>
      </tr>`).join('');

    html += `
      <div class="card">
        <div class="card-header">🛡️ Armor (${armor.length} types)</div>
        <div style="overflow-x:auto;">
          <table class="members-table">
            <thead><tr>
              <th>Name</th>
              <th style="text-align:center;">Slot</th>
              <th style="text-align:center;">Total</th>
              <th style="text-align:center;">Loaned</th>
              <th style="text-align:center;">Available</th>
            </tr></thead>
            <tbody>${armorRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  return html;
}

// ── Medical Inventory ────────────────────────────────────────────────────────
async function fetchMedicalInventory() {
  const container = document.getElementById('admin-medical-inventory-data');
  container.innerHTML = '<div class="channel-loading">LOADING MEDICAL INVENTORY...</div>';
  try {
    const res = await fetch('/api/admin/medical-inventory');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderMedicalInventory(data.items || []);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

function renderMedicalInventory(items) {
  if (!items.length) {
    return '<div class="empty-state"><p class="muted">No medical supplies found in the armory.</p></div>';
  }

  const rows = items.map(item => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${item.quantity || 0}</td>
    </tr>`).join('');

  const totalItems = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

  return `
    <div class="stats-grid" style="margin-bottom:1rem;">
      ${statTile(totalItems, 'Total Items')}
    </div>
    <div style="overflow-x:auto;">
      <table class="members-table">
        <thead><tr>
          <th>Name</th>
          <th style="text-align:center;width:100px;">Quantity</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}


// ── Drug Inventory ───────────────────────────────────────────────────────────
async function fetchDrugInventory() {
  const container = document.getElementById('admin-drug-inventory-data');
  container.innerHTML = '<div class="channel-loading">LOADING DRUG INVENTORY...</div>';
  try {
    const res = await fetch('/api/admin/drug-inventory');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderDrugInventory(data.items || []);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

function renderDrugInventory(items) {
  if (!items.length) {
    return '<div class="empty-state"><p class="muted">No drugs found in the armory.</p></div>';
  }

  const rows = items.map(item => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${item.quantity || 0}</td>
    </tr>`).join('');

  const totalItems = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

  return `
    <div class="stats-grid" style="margin-bottom:1rem;">
      ${statTile(totalItems, 'Total Items')}
    </div>
    <div style="overflow-x:auto;">
      <table class="members-table">
        <thead><tr>
          <th>Name</th>
          <th style="text-align:center;width:100px;">Quantity</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function takeWeeklySnapshot() {
  try {
    const res = await fetch('/api/admin/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    document.getElementById('snapshot-status').innerHTML = `<p class="success-text">✅ ${data.message}</p>`;
  } catch (err) {
    document.getElementById('snapshot-status').innerHTML = `<p class="error-text">❌ Error: ${err.message}</p>`;
  }
}



