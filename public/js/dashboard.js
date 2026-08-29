// ── Stocks─ TCSE Stock Exchange ────────────────────────────────────────────────
let stocksCache = null;

async function fetchStocks() {
  const container = document.getElementById('stocks-data');
  container.innerHTML = '<div class="channel-loading">LOADING STOCK DATA...</div>';
  try {
    const res = await fetch('/api/torn/stocks');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    stocksCache = data.stocks || [];
    renderStocks();
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderStocks() {
  const container = document.getElementById('stocks-data');
  if (!stocksCache || stocksCache.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📈</span><p>No stock data available. Click Load Stocks to fetch data.</p></div>';
    return;
  }

  const sortBy = document.getElementById('stocks-sort')?.value || 'name';
  const order = document.getElementById('stocks-order')?.value || 'asc';
  const filter = document.getElementById('stocks-filter')?.value || 'all';
  const search = (document.getElementById('stocks-search')?.value || '').toLowerCase().trim();

  let stocks = [...stocksCache];

  // Apply search filter
  if (search) {
    stocks = stocks.filter(s => s.name.toLowerCase().includes(search) || (s.acronym || '').toLowerCase().includes(search));
  }

  // Apply tier filter
  if (filter === 'tiered') {
    stocks = stocks.filter(s => s.isTiered);
  } else if (filter === 'non-tiered') {
    stocks = stocks.filter(s => !s.isTiered);
  } else if (filter === 'available') {
    stocks = stocks.filter(s => s.availableShares > 0);
  }

  // Sort
  const validSortFields = ['name', 'price', 'requiredShares', 'totalCost', 'investors', 'availableShares'];
  if (validSortFields.includes(sortBy)) {
    stocks.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      if (aVal == null) aVal = order === 'asc' ? 999999999999 : -1;
      if (bVal == null) bVal = order === 'asc' ? 999999999999 : -1;
      if (typeof aVal === 'string') return order === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return order === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  function fmt(n) {
    if (n == null) return '—';
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  const rows = stocks.map(s => {
    const typeBadge = s.isIndexFund
      ? '<span style="color:#888;font-size:0.75rem;">📊 Index Fund</span>'
      : s.isTiered
        ? '<span style="color:#4caf50;font-size:0.75rem;">🎚️ Tiered</span>'
        : '<span style="color:#888;font-size:0.75rem;">📊 Not Tiered</span>';
    const priceColor = s.price > 0 ? '#c0bcbc' : '#888';
    return `<tr style="cursor:pointer;" onclick="showStockDetail(${s.id})">
      <td><strong>${escapeHtml(s.name)}</strong><br><span style="font-size:0.75rem;color:#888;">${escapeHtml(s.acronym || '')}</span></td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;color:${priceColor};">$${fmt(s.price)}</td>
      <td style="text-align:center;">${typeBadge}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${s.requiredShares ? fmt(s.requiredShares) : '—'}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${s.totalCost != null ? '$' + fmt(s.totalCost) : '—'}</td>
      <td style="font-size:0.85rem;color:#a0a0a0;max-width:300px;">${escapeHtml(s.dividend || '')}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card">
      <div style="overflow-x:auto;max-height:600px;overflow-y:auto;">
        <table class="members-table">
          <thead>
            <tr>
              <th style="min-width:180px;">Stock</th>
              <th style="text-align:right;">Price</th>
              <th style="text-align:center;">Type</th>
              <th style="text-align:right;">Required Shares</th>
              <th style="text-align:right;">Total Cost</th>
              <th>Dividend / Reward</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6" class="muted" style="padding:1rem;">No stocks match the current filters.</td></tr>'}</tbody>
        </table>
      </div>
      <div style="padding:0.5rem 1rem;font-size:0.8rem;color:#666;display:flex;justify-content:space-between;">
        <span>${stocks.length} stocks shown</span>
        <span>Click a row for details</span>
      </div>
    </div>`;
}

function showStockDetail(stockId) {
  const stock = stocksCache?.find(s => s.id === stockId);
  if (!stock) return;

  const modal = document.getElementById('stock-detail-modal');
  const title = document.getElementById('stock-detail-title');
  const body = document.getElementById('stock-detail-body');

  title.textContent = `${stock.name} (${stock.acronym || ''}) - Details`;

  function fmt(n) {
    if (n == null) return '—';
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  const typeLabel = stock.isIndexFund
    ? '📊 Index Fund (per share)'
    : stock.isTiered
      ? '🎚️ Tiered (recurring reward - claim repeatedly)'
      : '📊 Not Tiered (constant/one-time benefit)';

  const typeColor = stock.isIndexFund ? '#888' : stock.isTiered ? '#4caf50' : '#888';

  let html = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem 1.5rem;margin-bottom:1.5rem;color:#c0bcbc;">
      <div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem 1rem;">
        <div style="font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;">Type</div>
        <div style="color:${typeColor};font-size:0.9rem;">${typeLabel}</div>
      </div>
      <div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem 1rem;">
        <div style="font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;">Price</div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:1.1rem;color:#c0bcbc;">$${fmt(stock.price)}</div>
      </div>`;

  if (stock.requiredShares) {
    html += `
      <div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem 1rem;">
        <div style="font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;">Required Shares</div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:1.1rem;color:#c0bcbc;">${fmt(stock.requiredShares)}</div>
      </div>
      <div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem 1rem;">
        <div style="font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;">Total Cost</div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:1.1rem;color:#f0a500;">$${fmt(stock.totalCost)}</div>
      </div>`;
  }

  html += `</div>`;

  if (stock.dividend) {
    html += `<div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem 1rem;margin-bottom:1rem;">
      <div style="font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.35rem;">Reward / Dividend</div>
      <div style="color:#c0bcbc;font-size:0.9rem;line-height:1.5;">${escapeHtml(stock.dividend)}</div>
    </div>`;
  }

  // Show market info
  html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-top:1rem;">
    <div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem 1rem;">
      <div style="font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;">Market Cap</div>
      <div style="font-family:'Share Tech Mono',monospace;color:#c0bcbc;">$${fmt(stock.marketCap)}</div>
    </div>
    <div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem 1rem;">
      <div style="font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;">Total Shares</div>
      <div style="font-family:'Share Tech Mono',monospace;color:#c0bcbc;">${fmt(stock.totalShares)}</div>
    </div>
    <div style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem 1rem;">
      <div style="font-size:0.7rem;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;">Investors</div>
      <div style="font-family:'Share Tech Mono',monospace;color:#c0bcbc;">${fmt(stock.investors)}</div>
    </div>
  </div>`;

  body.innerHTML = html;
  modal.style.display = 'flex';
}

function closeStockDetail(event) {
  if (event.target === event.currentTarget) {
    document.getElementById('stock-detail-modal').style.display = 'none';
  }
}

// ── Section Navigation ────────────────────────────────────────────────────────
function showSection(sectionId, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  if (el) el.classList.add('active');

  // Update the URL hash so the section is linkable/shareable
  window.location.hash = sectionId;

  if (sectionId === 'my-day') { fetchMyDay(); }
  if (sectionId === 'torn') { fetchTornUser(); }
  if (sectionId === 'faction') { fetchFaction(); }
  if (sectionId === 'travel') { fetchTravel(); fetchTravelProfits(); }
  if (sectionId === 'admin') { fetchMemberOverview(); }
  if (sectionId === 'war') { fetchWarDataOverview(); fetchWarStats(); fetchEnemyStats(); }
  if (sectionId === 'targets') { checkFFScouterKeyStatus(); fetchTargets(); }
  if (sectionId === 'stocks') { fetchStocks(); }
}

// ── My Day Dashboard ──────────────────────────────────────────────────────────
// Available Utilities armory items used to populate the request dropdown
let utilityItems = [];

async function fetchMyDay() {
  const container = document.getElementById('my-day-data');
  container.innerHTML = '<div class="channel-loading">LOADING YOUR DAY...</div>';
  try {
    const res = await fetch('/api/my-day');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    // Load the list of available Utilities armory items for the request dropdown (non-fatal)
    try {
      const itemsRes = await fetch('/api/utilities/available');
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        utilityItems = itemsData.items || [];
      }
    } catch (e) {
      console.error('Failed to load utilities items:', e);
    }
    container.innerHTML = renderMyDay(data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderMyDay(d) {
  const cards = [];

  // ── Energy Card ──
  if (d.energy) {
    const pct = Math.round((d.energy.current / d.energy.maximum) * 100);
    const isMaxed = pct >= 100;
    const isFull = pct >= 95 && !isMaxed;
    let cardClass = 'myday-ok';
    let barColor = '#4caf50';
    let actionText = '<div class="myday-card-hint">You can still train more.</div>';
    if (isMaxed) {
      cardClass = 'myday-danger';
      barColor = '#ff4444';
      actionText = '<div class="myday-card-action">🔴 Energy is full! Train or use boosters now!</div>';
    } else if (isFull) {
      cardClass = 'myday-warning';
      barColor = '#e67e22';
      actionText = '<div class="myday-card-action">🔴 Energy is nearly full — train or use boosters!</div>';
    }
    cards.push(`
      <div class="myday-card ${cardClass}">
        <div class="myday-card-icon">⚡</div>
        <div class="myday-card-body">
          <div class="myday-card-title">Energy</div>
          <div class="myday-card-value">${d.energy.current.toLocaleString()} / ${d.energy.maximum.toLocaleString()} <span class="myday-pct">(${pct}%)</span></div>
          <div class="myday-bar"><div class="myday-bar-fill" style="width:${pct}%;background:${barColor};"></div></div>
          ${actionText}
        </div>
      </div>
    `);
  } else if (!d.hasApiKey) {
    cards.push(`
      <div class="myday-card myday-missing">
        <div class="myday-card-icon">🔑</div>
        <div class="myday-card-body">
          <div class="myday-card-title">API Key Required</div>
          <div class="myday-card-value">Save your Torn API key in your Profile to see energy and nerve status.</div>
          <div class="myday-card-action"><a href="#profile" onclick="showSection('profile', document.querySelector('.nav-item[href=\\'#profile\\']'))" class="btn btn-primary btn-small">Go to Profile</a></div>
        </div>
      </div>
    `);
  }

  // ── Nerve Card ──
  if (d.nerve) {
    const pct = Math.round((d.nerve.current / d.nerve.maximum) * 100);
    const isFull = pct >= 90;
    cards.push(`
      <div class="myday-card ${isFull ? 'myday-danger' : 'myday-ok'}">
        <div class="myday-card-icon">🔪</div>
        <div class="myday-card-body">
          <div class="myday-card-title">Nerve</div>
          <div class="myday-card-value">${d.nerve.current.toLocaleString()} / ${d.nerve.maximum.toLocaleString()} <span class="myday-pct">(${pct}%)</span></div>
          <div class="myday-bar"><div class="myday-bar-fill" style="width:${pct}%;background:${isFull ? '#ff4444' : '#4caf50'};"></div></div>
          ${isFull ? '<div class="myday-card-action">🔴 Nerve is almost full! Time to do crimes!</div>' : '<div class="myday-card-hint">Nerve is building — keep doing crimes when you can.</div>'}
        </div>
      </div>
    `);
  }

  // ── OC Card ──
  if (d.activeOc) {
    const statusText = d.activeOc.initiated ? '🔄 In Progress' : '⏳ Planning';
    cards.push(`
      <div class="myday-card myday-oc">
        <div class="myday-card-icon">🗝️</div>
        <div class="myday-card-body">
          <div class="myday-card-title">Active Organized Crime</div>
          <div class="myday-card-value">${d.activeOc.crimeName}</div>
          <div class="myday-card-detail">Your role: <strong>${d.activeOc.role}</strong> — ${statusText}</div>
          ${d.ocItemNeeded
            ? (d.ocItemHave
                ? `<div class="myday-card-hint">✅ You have the required item: <strong>${d.ocItemNeeded}</strong></div>`
                                : `<div class="myday-card-action">📦 This OC requires: <strong>${d.ocItemNeeded}</strong> — <span style="color:#e74c3c;font-weight:600;">Request Item</span> below in the Utilities Armory Request card</div>`
            )
            : '<div class="myday-card-hint">✅ No item needed for your role.</div>'}
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="myday-card myday-info">
        <div class="myday-card-icon">🗝️</div>
        <div class="myday-card-body">
          <div class="myday-card-title">No Active OC</div>
          <div class="myday-card-value">You're not in any active Organized Crime.</div>
          <div class="myday-card-action">Check <a href="https://www.torn.com/factions.php?step=your&type=1#/tab=crimes" target="_blank" rel="noopener" style="color:#4a90e2;text-decoration:underline;">the faction OC page</a> for available spots!</div>
        </div>
      </div>
    `);
  }

  // ── War Card ──
  if (d.war && d.war.isActive) {
    const startDate = new Date(d.war.start * 1000).toLocaleDateString();
    cards.push(`
      <div class="myday-card myday-war">
        <div class="myday-card-icon">⚔️</div>
        <div class="myday-card-body">
          <div class="myday-card-title">⚔️ Active War</div>
          <div class="myday-card-value">vs ${d.war.enemy}</div>
          <div class="myday-card-detail">Started: ${startDate}</div>
          <div class="myday-card-action"><a href="#war" onclick="showSection('war', document.querySelector('.nav-item[href=\\'#war\\']'))" class="btn btn-primary btn-small">View War Panel</a></div>
        </div>
      </div>
    `);
  }

  // ── Utilities Armory Request Ticket ──
    cards.push(renderUtilitiesRequestCard());

  // ── Pending Item Requests (visible to Utility Loaning holders) ──
  if (d.canLoanUtilities) {
    cards.push(renderPendingRequestsCard(d.pendingRequests || []));
  }

  // ── Requester's own requests + fulfillment notices ──
  if ((d.myRequestStatus && d.myRequestStatus.length) || (d.fulfilledRequests && d.fulfilledRequests.length)) {
    cards.push(renderMyRequestsCard(d.myRequestStatus || [], d.fulfilledRequests || []));
  }

  // ── Items Loaned to this user (Utilities armory) ──
  if (d.loanedItems && d.loanedItems.length) {
    cards.push(renderLoanedItemsCard(d.loanedItems));
  }

  // If no cards at all, show a message
  if (cards.length === 0) {
    return `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <p>No data available yet. Make sure you have an API key saved.</p>
      </div>`;
  }

  return `<div class="myday-grid">${cards.join('')}</div>`;
}

// ── Utilities Armory Request Ticket card (all faction members) ────────────────
function renderUtilitiesRequestCard() {
  const options = utilityItems.length
    ? utilityItems.map(it => `<option value="${escapeHtml(it.name)}" data-item-id="${it.id || ''}">${escapeHtml(it.name)}${it.available > 0 ? ` (${it.available} avail)` : ' (out of stock)'}</option>`).join('')
    : '<option value="">Loading items...</option>';

  return `
    <div class="myday-card myday-request" id="utilities-request-card">
      <div class="myday-card-icon">🧰</div>
      <div class="myday-card-body">
        <div class="myday-card-title">Utilities Armory Request</div>
        <div class="myday-card-value" style="font-size:0.95rem;">Request an item from the Utilities armory.</div>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem;">
          <select id="utilities-request-select" style="flex:1;min-width:180px;background:#1a1919;border:1px solid #333;color:#c0bcbc;border-radius:4px;padding:6px 8px;font-size:0.85rem;">
            ${options}
          </select>
          <button class="btn btn-primary btn-small" onclick="submitUtilityRequest()">Request Item</button>
        </div>
        <div id="utilities-request-status" style="font-size:0.8rem;color:#888;margin-top:0.35rem;"></div>
        ${utilityItems.length ? '' : '<div class="myday-card-hint">⚠️ Could not load available items.</div>'}
      </div>
    </div>`;
}

// ── Pending item requests card (Utility Loaning holders) ──────────────────────
function renderPendingRequestsCard(requests) {
  const rows = requests.length
    ? requests.map(r => {
        const time = new Date(r.createdAt).toLocaleString();
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid #2a2828;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.85rem;">🧰 ${escapeHtml(r.itemName)}</div>
              <div style="font-size:0.75rem;color:#888;">Requested by <a href="https://www.torn.com/profiles.php?XID=${r.requesterId}" target="_blank" rel="noopener" style="color:#a78df5;text-decoration:none;">${escapeHtml(r.requesterName || ('#' + r.requesterId))}</a> &middot; ${time}</div>
            </div>
                        <button class="btn btn-small" onclick="openTornArmory()" style="flex-shrink:0;margin-right:0.25rem;">🔗 Open Armory</button>
            <button class="btn btn-small btn-success" onclick="fulfillUtilityRequest('${r._id}')" style="flex-shrink:0;">✅ Fulfill</button>
          </div>`;
      }).join('')
    : '<div class="myday-card-hint">No open item requests.</div>';

  return `
    <div class="myday-card myday-request">
      <div class="myday-card-icon">📦</div>
      <div class="myday-card-body">
        <div class="myday-card-title">Pending Item Requests</div>
        <div class="myday-card-value" style="font-size:0.95rem;">${requests.length} open request(s)</div>
        <div style="margin-top:0.5rem;">${rows}</div>
      </div>
    </div>`;
}

// ── Requester's own requests + fulfillment notices card ───────────────────────
function renderMyRequestsCard(myRequests, fulfilled) {
    // Filter out fulfilled notifications for items that were never actually loaned
  // (loaned === 0 in the Torn armory). Items that are currently loaned (even to the
  // requester themselves) should keep their fulfilled notification visible until the
  // item is returned (at which point loaned goes back to 0).
  // utilityItems is a module-level variable loaded when My Day renders,
  // containing items with their loaned/available counts.
  const nonLoanedItems = utilityItems.filter(i => (i.loaned || 0) === 0).map(i => i.name.toLowerCase());
  const nonLoanedItemNames = new Set(nonLoanedItems);
  
  const myRows = myRequests.length
    ? myRequests.map(r => {
        const time = new Date(r.createdAt).toLocaleString();
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid #2a2828;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.85rem;">🧰 ${escapeHtml(r.itemName)} — <span style="color:#f39c12;">⏳ Awaiting fulfilment</span></div>
              <div style="font-size:0.75rem;color:#888;">Requested ${time}</div>
            </div>
            <button class="btn btn-small btn-outline" onclick="cancelUtilityRequest('${r._id}')" style="flex-shrink:0;">✕ Cancel</button>
          </div>`;
      }).join('')
    : '';

    const fulfilledRows = fulfilled.length
    ? fulfilled.filter(r => !nonLoanedItemNames.has((r.itemName || '').toLowerCase())).map(r => {
        const time = new Date(r.createdAt).toLocaleString();
        return `
          <div style="padding:0.5rem 0;border-bottom:1px solid #2a2828;">
            <div style="font-size:0.85rem;color:#2ecc71;">✅ ${escapeHtml(r.itemName)} — Fulfilled</div>
            <div style="font-size:0.75rem;color:#888;">${escapeHtml(r.message || '')} &middot; ${time}</div>
          </div>`;
      }).join('')
    : '';

  if (!myRows && !fulfilledRows) return '';

  return `
    <div class="myday-card myday-request">
      <div class="myday-card-icon">📋</div>
      <div class="myday-card-body">
        <div class="myday-card-title">Your Utilities Requests</div>
        ${myRows ? `<div style="margin-top:0.5rem;">${myRows}</div>` : ''}
        ${fulfilledRows ? `<div style="margin-top:0.5rem;">${fulfilledRows}</div>` : ''}
      </div>
    </div>`;
}

// ── Utilities request actions ─────────────────────────────────────────────────
async function submitUtilityRequest() {
  const select = document.getElementById('utilities-request-select');
  const statusEl = document.getElementById('utilities-request-status');
  if (!select || !statusEl) return;
  const name = select.value;
  const option = select.selectedOptions && select.selectedOptions[0];
  const itemId = option ? option.getAttribute('data-item-id') : null;
  if (!name) { statusEl.textContent = '⚠️ Please select an item first.'; return; }

  statusEl.textContent = 'Submitting...';
  try {
    const res = await fetch('/api/utilities/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: itemId ? parseInt(itemId) : null, itemName: name })
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = `⚠️ ${data.error || 'Failed to submit request.'}`;
      return;
    }
    statusEl.textContent = `✅ Request submitted for ${name}. A Utility Loaning holder has been notified.`;
    setTimeout(fetchMyDay, 800);
  } catch (err) {
    statusEl.textContent = `⚠️ ${err.message}`;
  }
}

async function fulfillUtilityRequest(id) {
  if (!confirm('Mark this item request as fulfilled after loaning it in Torn? The requester will be notified.')) return;
  try {
    const res = await fetch(`/api/utilities/requests/${id}/fulfill`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(`⚠️ ${data.error || 'Failed to fulfil request.'}`); return; }
    // Refresh the current My Day view to reflect the fulfilled status
    fetchMyDay();
    // Notify the user that the requester has been sent a notification
    alert('✅ Request marked as fulfilled. A notification has been sent to the requester.');
  } catch (err) {
    alert(`⚠️ ${err.message}`);
  }
}

// ─── Open the Torn faction armory utilities page in a new window ──────────────
function openTornArmory() {
  const win = window.open('https://www.torn.com/factions.php?step=your&type=1#/tab=armoury&start=0&sub=utilities', '_blank');
  if (win) win.focus();
}

// ─── Items Loaned to the user (Utilities armory) card ─────────────────────────
// Each loaned item gets a "Return Item" button that opens the Torn item page where
// the user can return the item after they are done using it.
function renderLoanedItemsCard(loanedItems) {
  const rows = loanedItems.map(item => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid #2a2828;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.85rem;">🧰 ${escapeHtml(item.itemName)}</div>
        <div style="font-size:0.75rem;color:#888;">Loaned to you &middot; ${item.loaned || 0} in use</div>
      </div>
      <a href="https://www.torn.com/item.php" target="_blank" rel="noopener"
         class="btn btn-small btn-success" style="flex-shrink:0;text-decoration:none;">↩️ Return Item</a>
    </div>`).join('');

  return `
    <div class="myday-card myday-request">
      <div class="myday-card-icon">🧰</div>
      <div class="myday-card-body">
        <div class="myday-card-title">Items Loaned</div>
        <div class="myday-card-value" style="font-size:0.95rem;">${loanedItems.length} item(s) loaned to you</div>
        <div style="margin-top:0.5rem;">${rows}</div>
        <div class="myday-card-hint" style="margin-top:0.35rem;">Click <strong>Return Item</strong> to go to your Torn item page and return it once you are done.</div>
      </div>
    </div>`;
}

async function cancelUtilityRequest(id) {
  if (!confirm('Cancel this request?')) return;
  try {
    const res = await fetch(`/api/utilities/requests/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { alert(`⚠️ ${data.error || 'Failed to cancel request.'}`); return; }
    fetchMyDay();
  } catch (err) {
    alert(`⚠️ ${err.message}`);
  }
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

// ── Role View Switching (Ownership only) ─────────────────────────────────────
async function switchRoleView() {
  const selector = document.getElementById('role-view-selector');
  const role = selector.value;

  try {
    const res = await fetch('/api/user/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role || null })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Error: ${data.error}`);
      return;
    }

    // Reload page to apply the new view
    window.location.reload();
  } catch (err) {
    alert(`Error switching role view: ${err.message}`);
  }
}

// ── Clear Role View / Return to Default ──────────────────────────────────────
async function clearRoleView() {
  try {
    const res = await fetch('/api/user/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: null })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Error: ${data.error}`);
      return;
    }

    // Reload page to restore the normal view
    window.location.reload();
  } catch (err) {
    alert(`Error clearing role view: ${err.message}`);
  }
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


// ── Torn User Stats ───────────────────────────────────────────────────────────
// Cached snapshot data that persists across page loads until refresh is clicked
let cachedSnapshotData = null;

async function fetchTornUser() {
  const container = document.getElementById('torn-user-data');
  container.innerHTML = '<div class="channel-loading">LOADING TORN DATA...</div>';
  try {
    const [userRes, snapshotRes] = await Promise.all([
      fetch('/api/torn/user'),
      fetch('/api/user/stats/last-increase')
    ]);
    const data = await userRes.json();
    if (!userRes.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }

    // Use cached snapshot data if available, otherwise use the API response
    if (!cachedSnapshotData) {
      const snapshotData = snapshotRes.ok ? await snapshotRes.json() : null;
      if (snapshotData && snapshotData.diff) {
        cachedSnapshotData = snapshotData;
      } else if (snapshotData && snapshotData.message) {
        // First time - no previous snapshot exists yet
        cachedSnapshotData = { isFirstSnapshot: true };
      }
    }

    container.innerHTML = renderTornUser(data, cachedSnapshotData);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

async function refreshStatsSnapshot() {
  const container = document.getElementById('torn-user-data');
  try {
    const res = await fetch('/api/user/stats/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const snapshotData = res.ok ? await res.json() : null;
    if (snapshotData) {
      cachedSnapshotData = snapshotData;
    }
    // Re-fetch user data and re-render with updated snapshot
    const userRes = await fetch('/api/torn/user');
    const data = await userRes.json();
    if (!userRes.ok) { return; }
    container.innerHTML = renderTornUser(data, cachedSnapshotData);
  } catch (err) {
    console.error('Stats refresh error:', err.message);
  }
}

// Refresh just the user data without touching the snapshot cache
async function refreshTornUserData() {
  const container = document.getElementById('torn-user-data');
  try {
    const res = await fetch('/api/torn/user');
    const data = await res.json();
    if (!res.ok) { return; }
    container.innerHTML = renderTornUser(data, cachedSnapshotData);
  } catch (err) {
    console.error('User data refresh error:', err.message);
  }
}

function renderTornUser(d, snapshotData) {
  const lifeBar = d.life ? `${d.life.current}/${d.life.maximum}` : 'N/A';
  const energyBar = d.energy ? `${d.energy.current}/${d.energy.maximum}` : 'N/A';
  const nerveBar = d.nerve ? `${d.nerve.current}/${d.nerve.maximum}` : 'N/A';
  const happyBar = d.happy ? `${d.happy.current}/${d.happy.maximum}` : 'N/A';
  const married = d.married?.spouse_name ? `💍 ${d.married.spouse_name}` : 'No';
  const job = d.job?.position && d.job?.company_name !== 'None'
    ? `${d.job.position} at ${d.job.company_name}` : d.job?.job || 'Unemployed';

  // Build stat increase display with duration since last update
  let statIncreaseHtml = '';
  if (snapshotData) {
    if (snapshotData.diff) {
      const diff = snapshotData.diff;
      const hasPrevious = snapshotData.previous && snapshotData.previous.timestamp;

      // Calculate duration since last update
      let durationText = '';
      if (hasPrevious) {
        const prevTime = new Date(snapshotData.previous.timestamp).getTime();
        const now = Date.now();
        const msAgo = now - prevTime;
        const hoursAgo = Math.floor(msAgo / (1000 * 60 * 60));
        const daysAgo = Math.floor(hoursAgo / 24);
        if (daysAgo > 0) {
          const remainingHours = hoursAgo % 24;
          durationText = `${daysAgo}d ${remainingHours}h ago`;
        } else if (hoursAgo > 0) {
          const minsAgo = Math.floor((msAgo % (1000 * 60 * 60)) / (1000 * 60));
          durationText = `${hoursAgo}h ${minsAgo}m ago`;
        } else {
          const minsAgo = Math.floor(msAgo / (1000 * 60));
          durationText = minsAgo > 0 ? `${minsAgo}m ago` : 'just now';
        }
      }

      if (hasPrevious) {
        const durationMessage = `Your stats have increased +${formatNumFull(diff.strength)} Strength, +${formatNumFull(diff.defense)} Defense, +${formatNumFull(diff.speed)} Speed, +${formatNumFull(diff.dexterity)} Dexterity, +${formatNumFull(diff.totalStats)} Total since your last update ${durationText}.`;
        statIncreaseHtml = `
          <div class="card" style="margin-top:1.25rem;background:#1a1919;border:1px solid #2a2828;">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
              <span>📈 Stats Overview</span>
              <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
                <span style="font-size:0.8rem;color:#888;">Last update: ${durationText}</span>
                <button class="btn btn-small btn-outline" onclick="refreshStatsSnapshot()" style="font-size:0.75rem;padding:2px 10px;">↻ Refresh Stats</button>
              </div>
            </div>
            <div class="card-body">
              <div class="stats-grid">
                ${statTile(`+${formatNumFull(diff.strength)}`, 'Strength')}
                ${statTile(`+${formatNumFull(diff.defense)}`, 'Defense')}
                ${statTile(`+${formatNumFull(diff.speed)}`, 'Speed')}
                ${statTile(`+${formatNumFull(diff.dexterity)}`, 'Dexterity')}
                ${statTile(`+${formatNumFull(diff.totalStats)}`, 'Total Stats')}
              </div>
              <div style="margin-top:1rem;padding:0.75rem;background:#161515;border:1px solid #2a2828;border-radius:6px;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;">
                <code id="stat-increase-copy-text" style="color:#c0bcbc;font-size:0.85rem;word-break:break-all;">${durationMessage}</code>
                <button class="btn btn-small btn-outline" onclick="copyStatIncrease()">📋 Copy</button>
              </div>
            </div>
          </div>`;
      } else if (snapshotData.isFirstSnapshot) {
        statIncreaseHtml = `
          <div class="card" style="margin-top:1.25rem;background:#1a1919;border:1px solid #2a2828;">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
              <span>📈 Stats Overview</span>
            </div>
            <div class="card-body">
              <p class="muted" style="margin:0 0 0.75rem 0;">First snapshot taken! Click the button below to take another snapshot and start tracking your stat increases.</p>
              <button class="btn btn-primary" onclick="refreshStatsSnapshot()">📸 Take Another Snapshot</button>
            </div>
          </div>`;
      }
    } else if (snapshotData.isFirstSnapshot) {
      statIncreaseHtml = `
        <div class="card" style="margin-top:1.25rem;background:#1a1919;border:1px solid #2a2828;">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
            <span>📈 Stats Overview</span>
          </div>
          <div class="card-body">
            <p class="muted" style="margin:0 0 0.75rem 0;">No stat snapshots yet. Click the button below to take your first snapshot and start tracking your stat increases over time.</p>
            <button class="btn btn-primary" onclick="refreshStatsSnapshot()">📸 Take First Snapshot</button>
          </div>
        </div>`;
    }
  }

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
        </div>
        ${d.effectiveStats ? `
        <div style="margin-top:1.25rem;">
          <div class="badge-label">Effective Battle Stats <span style="font-size:0.75rem;color:#888;font-weight:400;">(with modifiers)</span></div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Eff. Strength', formatNumFull(d.effectiveStats.strength) + ' <span style="color:#4caf50;font-size:0.75rem;">(+' + d.effectiveStats.modifiers.strength + '%)</span>')}
            ${infoBadge('Eff. Defense', formatNumFull(d.effectiveStats.defense) + ' <span style="color:#4caf50;font-size:0.75rem;">(+' + d.effectiveStats.modifiers.defense + '%)</span>')}
            ${infoBadge('Eff. Speed', formatNumFull(d.effectiveStats.speed) + ' <span style="color:#4caf50;font-size:0.75rem;">(+' + d.effectiveStats.modifiers.speed + '%)</span>')}
            ${infoBadge('Eff. Dexterity', formatNumFull(d.effectiveStats.dexterity) + ' <span style="color:#4caf50;font-size:0.75rem;">(+' + d.effectiveStats.modifiers.dexterity + '%)</span>')}
            ${infoBadge('Eff. Total', formatNumFull(d.effectiveStats.total))}
          </div>
        </div>` : ''}
        <div style="margin-top:1.25rem;">
          <div class="badge-label">Work Stats</div>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${infoBadge('Manual Labor', formatNumFull(d.personalstats.manuallabor))}
            ${infoBadge('Intelligence', formatNumFull(d.personalstats.intelligence))}
            ${infoBadge('Endurance', formatNumFull(d.personalstats.endurance))}
            ${infoBadge('Total Work', formatNumFull((parseInt(d.personalstats.manuallabor) || 0) + (parseInt(d.personalstats.intelligence) || 0) + (parseInt(d.personalstats.endurance) || 0)))}
          </div>
        </div>` : ''}
        ${statIncreaseHtml}
      </div>
    </div>`;
}

function copyStatIncrease() {
  const el = document.getElementById('stat-increase-copy-text');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const btn = el.nextElementSibling;
    if (btn) {
      const original = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => btn.textContent = original, 2000);
    }
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}
// ── Honors, Merits & Awards ───────────────────────────────────────────────────
async function fetchHonors() {
  const container = document.getElementById('honors-data');
  container.innerHTML = '<div class="channel-loading">LOADING HONORS & MERITS...</div>';
  try {
    const res = await fetch('/api/torn/honors');
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = '';
    renderHonors(data);
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
      fetch('/api/torn/faction-travel'),
      fetch('/api/faction/member-skills')
    ];
    if (IS_LEADERSHIP) requests.push(fetch('/api/admin/member-stats'));

    const [factionRes, travelRes, skillsRes, statsRes] = await Promise.allSettled(requests);

    const data = factionRes.status === 'fulfilled' ? await factionRes.value.json() : {};
    const travelData = travelRes.status === 'fulfilled' ? await travelRes.value.json() : {};
    const skillsData = skillsRes.status === 'fulfilled' ? await skillsRes.value.json() : {};
    const statsData = statsRes?.status === 'fulfilled' ? await statsRes.value.json() : {};

    if (!data.basic) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }

    const statsMap = {};
    if (IS_LEADERSHIP) {
      (statsData.stats || []).forEach(s => { statsMap[s.player_id] = s; });
    }

    const travelMap = {};
    (travelData.traveling || []).forEach(t => { travelMap[t.id] = t; });

    const skillsMap = {};
    (skillsData.skills || []).forEach(s => { skillsMap[s.player_id] = s; });

    container.innerHTML = renderFaction(data, statsMap, travelMap, skillsMap);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderFaction(d, statsMap = {}, travelMap = {}, skillsMap = {}) {
  const basic = d.basic;
  const members = d.members || [];
  const hasStats = Object.keys(statsMap).length > 0;

  const positionOrder = {
    'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'Warlord': 4,
    'Team_Strategy': 5, 'Team Strategy': 6, 'Team Strength': 7, 'Team Growth': 8, 'Recruit': 9
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
        // Check multiple sources for returning status: description text, OR travel destination
        const isReturning = m.status?.description?.toLowerCase().includes('returning')
          || (travelInfo?.travel?.destination === 'Torn')
          || (travelInfo?.description?.toLowerCase().includes('returning'));
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
    </div>
    ${renderFactionSkills(members, skillsMap, positionOrder)}`;
}

// ── Faction Skills Table ──────────────────────────────────────────────────────
let factionSkillsSortCol = 'total';
let factionSkillsSortAsc = false;

function sortFactionSkills(col) {
  if (factionSkillsSortCol === col) {
    factionSkillsSortAsc = !factionSkillsSortAsc;
  } else {
    factionSkillsSortCol = col;
    factionSkillsSortAsc = true;
  }
  // Re-render the faction section with the new sort
  fetchFaction();
}

function renderFactionSkills(members, skillsMap, positionOrder) {
  const hasSkills = Object.keys(skillsMap).length > 0;
  if (!hasSkills) return '';

  // Define the skill keys in alphabetical order (after Total)
  const SKILL_KEYS = [
    'arson', 'bootlegging', 'burglary', 'card_skimming', 'cracking',
    'disposal', 'forgery', 'graffiti', 'hunting', 'hustling',
    'pickpocketing', 'racing', 'reviving', 'scammin', 'search_for_cash', 'shoplifting'
  ];

  // Build rows sorted by position then level (same as member roster)
  const sortedMembers = [...members].sort((a, b) => {
    const aO = positionOrder[a.position] ?? 99;
    const bO = positionOrder[b.position] ?? 99;
    if (aO !== bO) return aO - bO;
    return (b.level || 0) - (a.level || 0);
  });

  // Apply current sort
  sortedMembers.sort((a, b) => {
    const aSkills = skillsMap[a.id]?.skills;
    const bSkills = skillsMap[b.id]?.skills;

    if (!aSkills && !bSkills) return 0;
    if (!aSkills) return 1;
    if (!bSkills) return -1;

    let aVal, bVal;
    if (factionSkillsSortCol === 'total') {
      aVal = SKILL_KEYS.reduce((sum, k) => sum + (aSkills[k] || 0), 0);
      bVal = SKILL_KEYS.reduce((sum, k) => sum + (bSkills[k] || 0), 0);
    } else {
      aVal = aSkills[factionSkillsSortCol] || 0;
      bVal = bSkills[factionSkillsSortCol] || 0;
    }

    return factionSkillsSortAsc ? aVal - bVal : bVal - aVal;
  });

  const arrow = col => factionSkillsSortCol === col ? (factionSkillsSortAsc ? ' ▲' : ' ▼') : '';

  const rows = sortedMembers.map(m => {
    const memberSkills = skillsMap[m.id]?.skills;
    if (!memberSkills) {
      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td style="text-align:right;font-family:'Share Tech Mono',monospace;color:#555;">—</td>
        ${SKILL_KEYS.map(() => '<td style="text-align:right;font-family:\'Share Tech Mono\',monospace;color:#555;">—</td>').join('')}
      </tr>`;
    }

    const total = SKILL_KEYS.reduce((sum, k) => sum + (memberSkills[k] || 0), 0);

    return `<tr>
      <td>${escapeHtml(m.name)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;font-weight:600;color:#f0c040;">${total.toFixed(2)}</td>
      ${SKILL_KEYS.map(k => {
        const val = memberSkills[k] || 0;
        return `<td style="text-align:right;font-family:'Share Tech Mono',monospace;">${val.toFixed(2)}</td>`;
      }).join('')}
    </tr>`;
  }).join('');

  return `
    <div class="card" style="margin-top:1.5rem;">
      <div class="card-header">
        Skills
        <span style="float:right;font-size:0.8rem;color:#555;">Click column headers to sort</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="members-table" id="faction-skills-table">
          <thead><tr>
            <th class="sortable" onclick="sortFactionSkills('name')" style="cursor:pointer;">Name${arrow('name')}</th>
            <th class="sortable" onclick="sortFactionSkills('total')" style="cursor:pointer;text-align:right;">Total${arrow('total')}</th>
            ${SKILL_KEYS.map(k => {
              const displayName = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              return `<th class="sortable" onclick="sortFactionSkills('${k}')" style="cursor:pointer;text-align:right;font-size:0.78rem;">${displayName}${arrow(k)}</th>`;
            }).join('')}
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="18" class="muted" style="padding:1rem;">No skill data available</td></tr>'}</tbody>
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
  // User is truly in Torn only if travel data is absent OR destination is Torn AND time_left is 0
  const isTraveling = t && ((t.time_left && t.time_left > 0) || (t.timestamp && t.timestamp > 0 && t.timestamp > Math.floor(Date.now() / 1000)));

  if (!t || (t.destination === 'Torn' && !isTraveling)) {
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

  // User is traveling — destination could be Torn (returning) or a foreign country (departing)
  const isReturning = t.destination === 'Torn';
  const arrivalTime = t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : 'Unknown';
  const timeLeft = t.time_left ? formatTimeLeft(t.time_left) : '';

  return `
    <div class="card">
      <div class="card-header">${isReturning ? '🔄 Returning to Torn' : '✈️ Currently Traveling'}</div>
      <div class="card-body">
        <div style="display:flex;gap:1rem;flex-wrap:wrap;">
          ${infoBadge('Destination', isReturning ? '🏠 Torn (Home)' : (t.destination || 'Unknown'))}
          ${infoBadge('Departure', t.departed || 'Unknown')}
          ${infoBadge('Arriving', arrivalTime)}
          ${timeLeft ? infoBadge('Time Left', timeLeft) : ''}
          ${infoBadge('Direction', isReturning ? '🔄 Returning' : '✈️ Departing')}
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

  // Guard 1: If the main stock container doesn't exist on the page, stop execution safely
  if (!container) {
    console.warn("Element '#yata-stock-data' not found. Skipping YATA stock initialization.");
    return;
  }

  container.innerHTML = '<div class="channel-loading">LOADING FOREIGN STOCK...</div>';

  try {
    const [stockRes, catalog] = await Promise.all([
      fetch('/api/yata/travel'),
      fetchItemCatalog()
    ]);

    const data = await stockRes.json();
    if (!stockRes.ok) {
      container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`;
      return;
    }

    yataStockCache = { data, catalog };

    // Guard 2 & 3: Safely capture filter dropdown values only if elements exist, otherwise default to empty strings
    const countrySelect = document.getElementById('travel-country-select');
    const sortSelect = document.getElementById('stock-sort');

    const selectedCountry = countrySelect ? countrySelect.value : '';
    const selectedSort = sortSelect ? sortSelect.value : '';

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

// ── Travel Profit Analytics Engine ───────────────────────────────────────────
let travelProfitsCache = null;
let stockAnalyticsCache = {};
let stockAdvisoryCache = null; // Cached advisory data from YATA/Prometheus
let restockCountdownTimer = null; // Interval timer for countdown

async function fetchTravelProfits() {
  const container = document.getElementById('travel-profits-data');
  container.innerHTML = '<div class="channel-loading">LOADING TRAVEL PROFITS...</div>';
  try {
    // Fetch travel profits and stock advisory in parallel
    const [profitsRes, advisoryRes] = await Promise.all([
      fetch('/api/travel-profits'),
      fetch('/api/stock/advisory').catch(() => null)
    ]);

    const data = await profitsRes.json();
    if (!profitsRes.ok) {
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

    // Process advisory data (YATA/Prometheus + userscript hybrid)
    if (advisoryRes && advisoryRes.ok) {
      const advisoryData = await advisoryRes.json();
      stockAdvisoryCache = advisoryData;

      // Build analytics map from advisory data
      const analyticsMap = {};
      const countries = advisoryData.countries || {};
      Object.entries(countries).forEach(([country, countryData]) => {
        if (countryData.items) {
          countryData.items.forEach(item => {
            analyticsMap[`${country}::${(item.name || '').toLowerCase().trim()}`] = item;
          });
        }
      });

      // Build name-only fallback
      const analyticsByName = {};
      Object.values(analyticsMap).forEach(item => {
        analyticsByName[(item.name || '').toLowerCase().trim()] = item;
      });
      analyticsMap._byName = analyticsByName;
      stockAnalyticsCache = analyticsMap;

      console.log('[Travel Profits] Advisory loaded:', Object.keys(analyticsMap).length, 'items | Source:', advisoryData.countries ? Object.values(advisoryData.countries)[0]?.dataSource : 'unknown');

      // Start restock countdown timer
      startRestockCountdown(advisoryData.restockCountdown);
    } else {
      // Fallback: fetch analytics per-country from old endpoint
      const countries = [...new Set(data.profits.map(p => p.country))];
      const analyticsMap = {};
      await Promise.all(countries.map(async (country) => {
        try {
          const aRes = await fetch(`/api/restock-analysis?country=${country}`);
          const aData = await aRes.json();
          if (aRes.ok && aData.items) {
            aData.items.forEach(item => {
              analyticsMap[`${country}::${(item.name || '').toLowerCase().trim()}`] = item;
            });
          }
        } catch (e) {
          console.error(`[Travel Profits] Analytics fallback error for ${country}:`, e.message);
        }
      }));
      const analyticsByName = {};
      Object.values(analyticsMap).forEach(item => {
        analyticsByName[(item.name || '').toLowerCase().trim()] = item;
      });
      analyticsMap._byName = analyticsByName;
      stockAnalyticsCache = analyticsMap;
    }

    renderTravelProfits();
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

// ── Restock Countdown Timer ───────────────────────────────────────────────────
function startRestockCountdown(initialCountdown) {
  // Clear any existing timer
  if (restockCountdownTimer) clearInterval(restockCountdownTimer);

  // Calculate the next restock time from the initial data
  let nextRestockMs = initialCountdown?.nextRestockInSeconds
    ? Date.now() + initialCountdown.nextRestockInSeconds * 1000
    : null;

  function updateCountdown() {
    const el = document.getElementById('restock-countdown-display');
    if (!el) return;

    // Recalculate deterministically: restocks at :00 and :30 every hour
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    let totalSeconds;
    if (minutes < 30) {
      totalSeconds = (30 - minutes) * 60 - seconds;
    } else {
      totalSeconds = (60 - minutes) * 60 - seconds;
    }

    if (totalSeconds <= 0) {
      el.textContent = 'RESTOCKING NOW';
      el.style.color = '#4caf50';
      // Re-render after a brief delay to pick up new stock data
      setTimeout(() => fetchTravelProfits(), 3000);
      return;
    }

    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    el.style.color = totalSeconds < 120 ? '#e74c3c' : totalSeconds < 300 ? '#f0a500' : '#4caf50';
  }

  updateCountdown();
  restockCountdownTimer = setInterval(updateCountdown, 1000);
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

const STANDARD_FLIGHT_COSTS = {
  mex: 6500,
  cay: 10000,
  can: 9000,
  haw: 11000,
  uni: 18000,
  arg: 21000,
  swi: 27000,
  jap: 32000,
  chi: 35000,
  uae: 32000,
  sou: 40000
};

function getFlightCost(countryCode, travelMethod) {
  if (travelMethod === 'airstrip' || travelMethod === 'private') {
    return 0;
  }
  return STANDARD_FLIGHT_COSTS[countryCode] || 0;
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
    // Clear enemy stats when no war
    const enemyContainer = document.getElementById('war-enemy-stats-data');
    if (enemyContainer) {
      enemyContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">🎯</span><p>No active war. Enemy stats will appear when a war begins.</p></div>';
    }
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
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#aaa;">${m.assists > 0 ? m.assists : '—'}</td>
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
          <thead><tr><th>#</th><th>Member</th><th style="text-align:center;">Hits</th><th style="text-align:center;">Assists</th><th style="text-align:right;">Respect Earned</th></tr></thead>
          <tbody>${hitRows || '<tr><td colspan="5" class="muted" style="padding:1rem;">No war hits found.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}
// ── War Target Comparison ──────────────────────────────────────────────────
async function outputWarTargetComparison() {
  const container = document.getElementById('war-target-comparison-data');
  container.innerHTML = '<div class="channel-loading">GENERATING COMPARISON...</div>';
  try {
    const res = await fetch('/api/war/target-comparison');
    const data = await res.json();
    if (!res.ok) {
      container.innerHTML = `<div class="channel-error">⚠️ ${data.error || 'Failed to generate comparison'}</div>`;
      return;
    }
    container.innerHTML = `
      <div class="card" style="border-left:4px solid #2ecc71;">
        <div class="card-body">
          <p style="color:#c0bcbc;font-size:0.9rem;">✅ Comparison generated and emailed successfully.</p>
          <p style="color:#888;font-size:0.85rem;margin-top:0.5rem;">
            <strong>Enemy:</strong> ${escapeHtml(data.enemyFactionName)}<br>
            <strong>Members:</strong> ${data.memberCount} &nbsp;|&nbsp; <strong>Enemies:</strong> ${data.enemyCount}
          </p>
          ${data.emailResult?.success
            ? '<p style="color:#2ecc71;font-size:0.85rem;margin-top:0.5rem;">📧 Email sent to leadership team.</p>'
            : '<p style="color:#e67e22;font-size:0.85rem;margin-top:0.5rem;">⚠️ Email not sent: ' + (data.emailResult?.error || 'Unknown error') + '</p>'}
          <pre style="background:#1a1919;border:1px solid #2a2828;border-radius:6px;padding:0.75rem;font-size:0.75rem;color:#c0bcbc;overflow-x:auto;margin-top:0.75rem;white-space:pre;">${escapeHtml(data.tableText)}</pre>
        </div>
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

// ── War Enemy Stats (FFScouter) ───────────────────────────────────────────
let enemyStats = [];

async function fetchEnemyStats() {
  const container = document.getElementById('war-enemy-stats-data');
  container.innerHTML = '<div class="channel-loading">LOADING ENEMY STATS...</div>';
  try {
    const res = await fetch('/api/war/enemy-stats');
    const data = await res.json();
    if (!res.ok) {
      container.innerHTML = `<div class="channel-error">⚠️ ${data.error || 'Failed to fetch enemy stats'}</div>`;
      return;
    }
    enemyStats = data.enemies || [];
    renderEnemyStats(data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderEnemyStats(data) {
  const container = document.getElementById('war-enemy-stats-data');
  const enemies = data.enemies || [];
  const enemyFactionName = data.enemyFactionName || 'Enemy Faction';

  if (!enemies.length) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🎯</span>
      <p>${data.message || 'No enemy stats available.'}</p>
      <p class="muted">Make sure an FFScouter API key is saved in the Targets section.</p>
    </div>`;
    return;
  }

  // Sort by total stats descending
  const sorted = [...enemies].sort((a, b) => b.totalStats - a.totalStats);

  const rows = sorted.map((e, i) => {
    // Determine status icon, text, and color based on statusState from Torn API
    let statusIcon = '🏠';
    let statusText = e.status || 'Unknown';
    let statusColor = '#2ecc71';

    const state = e.statusState || 'Unknown';
    if (state === 'Traveling') {
      statusIcon = '✈️';
      statusColor = '#3498db';
    } else if (state === 'Abroad') {
      statusIcon = '🌍';
      statusColor = '#f39c12';
    } else if (state === 'Hospital') {
      statusIcon = '🏥';
      statusColor = '#ff4444';
    } else if (state === 'Jail') {
      statusIcon = '🔒';
      statusColor = '#f39c12';
    } else if (state === 'Okay') {
      statusIcon = '🏠';
      statusColor = '#2ecc71';
    } else if (e.statusColor === 'red') {
      statusIcon = '🏥';
      statusColor = '#ff4444';
    } else if (e.statusColor === 'blue') {
      statusIcon = '✈️';
      statusColor = '#3498db';
    }

    // Determine revivable display
    let revivableIcon = '—';
    let revivableColor = '#555';
    if (e.isRevivable === true) {
      revivableIcon = '✅';
      revivableColor = '#4caf50';
    } else if (e.isRevivable === false) {
      revivableIcon = '❌';
      revivableColor = '#ff4444';
    }

    return `<tr>
      <td style="color:#555;font-size:0.8rem;text-align:center;">${i + 1}</td>
      <td>
        <a href="https://www.torn.com/profiles.php?XID=${e.id}" target="_blank" rel="noopener"
          style="color:#a78df5;text-decoration:none;">${escapeHtml(e.name)}</a>
        <span style="color:#555;font-size:0.75rem;"> [${e.id}]</span>
      </td>
      <td style="text-align:center;">${e.level}</td>
      <td style="text-align:center;font-weight:bold;color:#c0bcbc;">${formatNum(e.totalStats)}</td>
      <td style="text-align:center;">
        <span style="color:${statusColor};">${statusIcon} ${statusText}</span>
      </td>
      <td style="text-align:center;color:${revivableColor};">${revivableIcon}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="members-table enemy-stats-table">
        <thead>
          <tr>
            <th style="text-align:center;width:40px;">#</th>
            <th>Name</th>
            <th style="text-align:center;">Level</th>
            <th style="text-align:center;">Est. Total Stats</th>
            <th style="text-align:center;">Status</th>
            <th style="text-align:center;">Revivable</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:0.75rem;color:#444;margin-top:0.5rem;padding:0 0.5rem;">
      Showing ${enemies.length} members from ${escapeHtml(enemyFactionName)}. Data from FFScouter.
    </p>`;
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
    'Team_Strategy': 5, 'Team Strategy': 6, 'Team Strength': 7, 'Team Growth': 8, 'Recruit': 9
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
    'Team_Strategy': 5, 'Team Strategy': 6, 'Team Strength': 7, 'Team Growth': 8, 'Recruit': 9
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

    // Work stats - same layout as battle stats
    const hasWorkStats = m.manuallabor !== null && m.manuallabor !== undefined;
    const workStatsCell = hasWorkStats ? `
        <div style="font-family:'Share Tech Mono',monospace;font-size:0.72rem;line-height:1.35;white-space:nowrap;">
          <div><span style="color:#a78df5;font-weight:600;">MAN</span> ${formatNumFull(m.manuallabor)}</div>
          <div><span style="color:#27ae60;font-weight:600;">INT</span> ${formatNumFull(m.intelligence)}</div>
          <div><span style="color:#e67e22;font-weight:600;">END</span> ${formatNumFull(m.endurance)}</div>
          <div style="border-top:1px solid #333;margin-top:1px;padding-top:1px;text-align:center;font-weight:600;color:#c0bcbc;">${formatNumFull((parseInt(m.manuallabor) || 0) + (parseInt(m.intelligence) || 0) + (parseInt(m.endurance) || 0))}</div>
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
        <td style="font-size:0.78rem;">${workStatsCell}</td>
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
            <th>Work Stats</th>
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
    'Team_Strategy': 5, 'Team Strategy': 6, 'Team Strength': 7, 'Team Growth': 8, 'Recruit': 9
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
    'Team_Strategy': 5, 'Team Strategy': 6, 'Team Strength': 7, 'Team Growth': 8, 'Recruit': 9
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
          <p class="help-text">The Profile page shows your Torn identity and SSG role assignments. This is also where you manage your Torn API key.</p>
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
      },
      {
        heading: 'SSG Stock Observer',
        content: `
          <p class="help-text">The Stock Observer is a userscript that automatically submits stock data to the server when you visit the Torn travel page while abroad. This data powers the Travel Profits analytics.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">📥 Install/Update Userscript</strong> to install via Tampermonkey (PC) or Torn PDA (mobile)</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">The script runs automatically when you visit torn.com/travel.php while abroad</div></div>
          <div class="help-callout">💡 Multiple members running the Stock Observer helps keep stock data fresh for everyone's profit calculations.</div>
        `
      },
      {
        heading: 'Travel Profits',
        content: `
          <p class="help-text">Shows profitable items to buy abroad and resell on the Torn market. Each item shows buy price, market value, and profit calculations for your chosen travel method and quantity.</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Select your <strong style="color:#c0bcbc;">Travel Method</strong>: Standard (pays flight costs), Airstrip, or Private Jet (free travel)</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Choose <strong style="color:#c0bcbc;">Item Types</strong> to include in calculations (Plushies, Flowers, Drugs, Other)</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Set your <strong style="color:#c0bcbc;">Quantity</strong> (5-29 items per trip)</div></div>
          <div class="help-step"><div class="help-step-num">4</div><div class="help-step-text">Use the <strong style="color:#c0bcbc;">Country</strong> and <strong style="color:#c0bcbc;">Sort</strong> dropdowns to filter results</div></div>
          <div class="help-step"><div class="help-step-num">5</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">Load</strong> to fetch current market prices and profit calculations</div></div>
          <div class="help-callout">💡 Profit/Run = (Profit per item × Quantity) − Flight cost. Airstrip/Private Jet have no flight cost.</div>
          <div class="help-callout">💡 The table includes columns for burn rate, stockout prediction, next restock, and departure recommendations when stock analytics data is available.</div>
        `
      },
      {
        heading: 'Travel Configuration',
        content: `
          <p class="help-text">The Travel Configuration panel lets you customize profit calculations:</p>
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text"><strong style="color:#c0bcbc;">Travel Method</strong>: Standard pays flight costs per trip; Airstrip and Private Jet have no flight cost</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text"><strong style="color:#c0bcbc;">Item Types</strong>: Toggle which item categories show in the profit tables</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text"><strong style="color:#c0bcbc;">Quantity</strong>: Set how many items you can carry per trip (5-29)</div></div>
          <div class="help-step"><div class="help-step-num">4</div><div class="help-step-text"><strong style="color:#c0bcbc;">Sort By</strong>: Sort results by Profit/Run, Profit/Item, Profit %, or Country</div></div>
          <div class="help-callout">💡 All calculations update live when you change any configuration without needing to reload data.</div>
        `
      }
    ]
  },
  targets: {
    title: '🎯 Targets',
    sections: [
      {
        heading: 'Target Finder',
        content: `
          <p class="help-text">Find inactive Torn players you can attack based on your battle stats. Uses FFScouter to identify targets within a fair fight range.</p>
          <div class="help-callout warning">⚠️ Requires an FFScouter API key saved in the Targets section.</div>
        `
      },
      {
        heading: 'Setting Up FFScouter',
        content: `
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Go to <a href="https://ffscouter.com/" target="_blank" style="color:#a78df5;">ffscouter.com</a> and click "Generate Custom API Key"</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Copy the generated key and paste it into the FFScouter API Key field on this page</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">Save Key</strong> to store it securely</div></div>
          <div class="help-callout">💡 See the Scripts section for a link to install the Fair Fight Script which integrates with FFScouter.</div>
        `
      },
      {
        heading: 'Finding Targets',
        content: `
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Choose a <strong style="color:#c0bcbc;">Preset</strong> (Respect or Level) for quick filtering, or use Custom Filters</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Adjust <strong style="color:#c0bcbc;">Level Range</strong>, <strong style="color:#c0bcbc;">Fair Fight Range</strong>, and <strong style="color:#c0bcbc;">Limit</strong> as needed</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Check <strong style="color:#c0bcbc;">Factionless only</strong> to exclude players in factions</div></div>
          <div class="help-step"><div class="help-step-num">4</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">Find Targets</strong> or <strong style="color:#c0bcbc;">Load Targets</strong> to get results</div></div>
          <div class="help-callout">💡 Results show Fair Fight rating, estimated battle stats, last action time, and faction info. Green FF ≥ 3 is a safe fight.</div>
          <div class="help-callout">💡 Inactive players (14+ days offline) are shown by default. Results are filtered based on your personal battle stats.</div>
        `
      }
    ]
  },
  companies: {
    title: '🏢 Companies',
    sections: [
      {
        heading: 'Company Management',
        content: `
          <p class="help-text">View and manage faction-owned companies. Shows company type, star rating, director, daily income, and employee details with work stats.</p>
          <div class="help-callout warning">⚠️ Every faction member can view this page — you'll see any faction companies you direct or currently work at. Ownership sees all companies.</div>
        `
      },
      {
        heading: 'Viewing Company Details',
        content: `
          <div class="help-step"><div class="help-step-num">1</div><div class="help-step-text">Click <strong style="color:#c0bcbc;">↻ Refresh</strong> to load your accessible companies</div></div>
          <div class="help-step"><div class="help-step-num">2</div><div class="help-step-text">Click on any company card to view the detailed employee efficiency matrix</div></div>
          <div class="help-step"><div class="help-step-num">3</div><div class="help-step-text">Each column is a job position (with its <strong style="color:#c0bcbc;">★ primary</strong> and secondary stat requirements); each row is an employee. The value in each cell is that employee's <strong style="color:#c0bcbc;">effectiveness ⚡</strong> for the role — computed from how well their primary &amp; secondary stats meet the position's requirements (each capped at 45 base, so 90⚡ = fully meeting requirements, with a log₂ bonus for over-qualification)</div></div>
          <div class="help-step"><div class="help-step-num">4</div><div class="help-step-text">Green = 90⚡+ (fully/over-qualified), yellow = partially qualified, red = well short. The <span style="color:#3498db;">●</span> marks an employee's current role, and the bottom row shows the best-matched employee for each position</div></div>
          <div class="help-callout">💡 Use this to spot who to move into open positions for the best results — an employee who fully meets a role's requirements (90⚡+) unlocks the position's special ability.</div>
          <div class="help-callout">💡 Ownership can add new companies using the <strong style="color:#c0bcbc;">➕ Add Company</strong> button with the company ID and director's Torn ID.</div>
        `
      }
    ]
  },
  scripts: {
    title: '📜 Scripts',
    sections: [
      {
        heading: 'Helpful Scripts',
        content: `
          <p class="help-text">The Scripts section provides links to useful Tampermonkey userscripts for Torn City, along with setup instructions.</p>
        `
      },
      {
        heading: 'Available Scripts',
        content: `
          <div class="help-step"><div class="help-step-num">🎯</div><div class="help-step-text"><strong style="color:#c0bcbc;">Fair Fight Script</strong> — Shows Fair Fight ratings on attack pages. Requires FFScouter setup — generate an API key at ffscouter.com.</div></div>
          <div class="help-step"><div class="help-step-num">🛒</div><div class="help-step-text"><strong style="color:#c0bcbc;">Bazaar Items in Market</strong> — Shows bazaar listings directly in the item market. Requires a Torn API key.</div></div>
          <div class="help-step"><div class="help-step-num">💰</div><div class="help-step-text"><strong style="color:#c0bcbc;">Crime Profitability</strong> — Displays value per nerve on the crimes page to help you choose the most profitable crimes.</div></div>
          <div class="help-step"><div class="help-step-num">✈️</div><div class="help-step-text"><strong style="color:#c0bcbc;">Warn Before Flights</strong> — Alerts you if an active Organized Crime would be impacted by your flight, preventing accidental OC disruption.</div></div>
          <div class="help-callout">💡 All scripts work with Tampermonkey on PC browsers. Install by clicking the script link, then click "Install" in Tampermonkey.</div>
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
          <div class="help-step"><div class="help-step-num">📖</div><div class="help-step-text"><strong style="color:#c0bcbc;">Torn Stats Account</strong> — Website dedicated to Tracking Stat progress for Torn as well as a plethora of other items.</div></div>
          <div class="help-step"><div class="help-step-num">📊</div><div class="help-step-text"><strong style="color:#c0bcbc;">Stats Training</strong> — Advanced stat building guides. Available to Strategy and above.</div></div>
          <div class="help-step"><div class="help-step-num">💰</div><div class="help-step-text"><strong style="color:#c0bcbc;">Money Making Training</strong> — Guides on funding your stats growth. Available to Strategy and above.</div></div>
          <div class="help-step"><div class="help-step-num">⬆️</div><div class="help-step-text"><strong style="color:#c0bcbc;">Level Training</strong> — How to level up fast. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🔗</div><div class="help-step-text"><strong style="color:#c0bcbc;">Chains</strong> — How to do Chains. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🫆</div><div class="help-step-text"><strong style="color:#c0bcbc;">Crimes Training</strong> — Guide for Crimes. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🗝️</div><div class="help-step-text"><strong style="color:#c0bcbc;">Organized Crimes Training</strong> — Guide for OCs. Available to all members.</div></div>
          <div class="help-step"><div class="help-step-num">🗝️</div><div class="help-step-text"><strong style="color:#c0bcbc;">Torn Stats Guides</strong> — The following are guides available in Torn Stats. These guides require access to Torn Stats. See Torn Stats Training for information on how to create your Torn Stats account.</div></div>
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
      },
      {
        heading: 'Utilities Inventory',
        content: `
          <p class="help-text">The Utilities armory holds items used for Organized Crimes and personal crimes. This tab shows the inventory (total, loaned, available) and every loaned item tied to the member holding it <strong style="color:#c0bcbc;">and their organized crime</strong>.</p>
          <div class="help-callout">💡 Each loan shows the crime, the member&apos;s role, and a status: <strong style="color:#f39c12;">In Use</strong> (item should be returned when the crime completes), <strong style="color:#e74c3c;">Return Due</strong> (their crime already finished and the item is a tool), <strong style="color:#2ecc71;">Consumed</strong> (a material that is used up — no return needed), or <strong style="color:#888;">Not for OC</strong>.</div>
          <div class="help-callout">💡 A 🧰 marker on an item means it matches that member&apos;s OC role requirement. Materials (consumed) and Tools (returned) are classified per the Torn OC 2.0 wiki — an item can be a tool in one crime and a material in another.</div>
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
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
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

// ── Companies Section ─────────────────────────────────────────────────────────
async function fetchCompanies() {
  const container = document.getElementById('companies-data');
  container.innerHTML = '<div class="channel-loading">LOADING COMPANY DATA...</div>';
  try {
    const res = await fetch('/api/companies');
    const companies = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${companies.error}</div>`; return; }
    if (!companies.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">🏢</span><p>You don't currently work at or direct a faction company.</p><p class="muted">When you join a faction-owned company, it will appear here automatically.</p></div>`;
      return;
    }
    container.innerHTML = renderCompanyCards(companies);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

function renderCompanyCards(companies) {
  const cards = companies.map(c => {
    const starStr = '★'.repeat(Math.min(c.stars, 10)) || 'No stars';
    const incomeFormatted = formatNumFull(c.dailyIncome);
    return `
      <div class="card" style="margin-bottom:1rem;cursor:pointer;" onclick="openCompanyDetail(${c.companyId})">
        <div class="card-header">
          🏢 ${escapeHtml(c.companyName)}
          <span style="float:right;font-size:0.85rem;color:#f0a500;">${starStr}</span>
        </div>
        <div class="card-body" style="padding:0.85rem 1.25rem;">
          <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
            ${infoBadge('Type', escapeHtml(c.companyType || 'N/A'))}
            ${infoBadge('Director', escapeHtml(c.directorName || 'Unknown'))}
            ${infoBadge('Daily Income', `$${incomeFormatted}`)}
            ${c.lastFetchedAt ? infoBadge('Last Updated', new Date(c.lastFetchedAt).toLocaleDateString()) : ''}
          </div>
        </div>
      </div>`;
  }).join('');
  return cards;
}

async function openCompanyDetail(companyId) {
  const modal = document.getElementById('company-detail-modal');
  const titleEl = document.getElementById('company-detail-title');
  const bodyEl = document.getElementById('company-detail-body');

  titleEl.textContent = 'Loading company data...';
  bodyEl.innerHTML = '<div class="channel-loading">LOADING COMPANY DETAILS...</div>';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/company/${companyId}`);
    const data = await res.json();
    if (!res.ok) { bodyEl.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }

    titleEl.textContent = `🏢 ${escapeHtml(data.company.name)} (${data.company.stars}★)`;

    const company = data.company;
    const employees = data.employees || [];
    const positions = data.positions || [];

    // Efficiency cell styling, based on effectiveness points. A position's
    // effectiveness = primary stat + secondary stat, each capped at 45 base,
    // so meeting all requirements exactly = 90 points (plus a bonus for
    // over-qualification).
    function effColor(pct, loading) {
      if (loading) return { bg: '#1a1919', fg: '#555' };
      if (pct >= 90) return { bg: 'rgba(46,204,113,0.16)', fg: '#2ecc71' };
      if (pct >= 45) return { bg: 'rgba(241,196,15,0.16)', fg: '#f1c40f' };
      return { bg: 'rgba(231,76,60,0.18)', fg: '#e74c3c' };
    }

    // Per-employee lookup: playerId -> { positionId: pct }
    const effByEmp = {};
    employees.forEach(emp => {
      const map = {};
      (emp.efficiency?.byPosition || []).forEach(p => { map[p.positionId] = p.pct; });
      effByEmp[emp.playerId] = map;
    });

    // Position column headers (name, special ability, required stats).
    // Primary stat is marked with a ★; secondary with a ·.
    const posHeaders = positions.map(pos => {
      const statOf = {
        INT: pos.intelligence,
        MAN: pos.manuallabor,
        END: pos.endurance
      };
      const req = [];
      if (pos.primaryStat) req.push('<span style="color:#e0c060;">★ ' + pos.primaryStat + ' ' + formatNum(statOf[pos.primaryStat]) + '</span>');
      if (pos.secondaryStat) req.push(pos.secondaryStat + ' ' + formatNum(statOf[pos.secondaryStat]));
      const ability = pos.specialAbility ? `<div style="font-size:0.62rem;color:#9b59b6;font-weight:600;letter-spacing:0.03em;">✦ ${escapeHtml(pos.specialAbility)}</div>` : '';
      return `<th style="min-width:96px;text-align:center;vertical-align:middle;">
        <div style="white-space:nowrap;">${escapeHtml(pos.name)}</div>
        ${ability}
        <div style="font-size:0.62rem;color:#777;white-space:nowrap;">${req.join(' · ')}</div>
      </th>`;
    }).join('');

    const hasStats = employees.some(e => (e.intelligence || e.manualLabor || e.endurance));

    // Employee rows: sticky identity + one effectiveness cell per position.
    const employeeRows = employees.map(emp => {
      const empMap = effByEmp[emp.playerId] || {};
      const posCells = positions.map(pos => {
        const pct = empMap[pos.id];
        const value = (pct === undefined || pct === null) ? null : pct;
        const c = effColor(value, !hasStats);
        const held = emp.position && pos.name && emp.position.trim().toLowerCase() === pos.name.trim().toLowerCase();
        const cellVal = value === null ? '—' : value + '⚡';
        const heldMark = held ? '<span title="Currently in this role" style="color:#3498db;margin-right:3px;">●</span>' : '';
        const heldOutline = held ? 'outline:1px solid #3498db;outline-offset:-2px;' : '';
        return `<td style="text-align:center;background:${c.bg};color:${c.fg};font-family:'Share Tech Mono',monospace;font-size:0.8rem;${heldOutline}">${heldMark}${cellVal}</td>`;
      }).join('');

      const best = emp.efficiency?.best;
      const bestHint = best && best.pct != null
        ? `<div style="font-size:0.66rem;color:#27ae60;font-weight:600;white-space:nowrap;">Best: ${escapeHtml(best.name)} ${best.pct}⚡</div>` : '';

      return `<tr>
        <td style="position:sticky;left:0;background:#131313;z-index:2;border-right:1px solid #2a2a2a;white-space:nowrap;">
          <div>${escapeHtml(emp.name)}</div>
          <div style="font-size:0.68rem;color:#888;">${escapeHtml(emp.position || '—')}</div>
          ${bestHint}
        </td>
        <td style="text-align:right;font-family:'Share Tech Mono',monospace;font-size:0.74rem;">${formatNumFull(emp.manualLabor)}</td>
        <td style="text-align:right;font-family:'Share Tech Mono',monospace;font-size:0.74rem;">${formatNumFull(emp.intelligence)}</td>
        <td style="text-align:right;font-family:'Share Tech Mono',monospace;font-size:0.74rem;">${formatNumFull(emp.endurance)}</td>
        <td style="text-align:center;font-size:0.74rem;">${emp.addiction}%</td>
        ${posCells}
      </tr>`;
    }).join('');

    // Footer: best-matched employee for each position.
    let bestRow = '';
    if (positions.length > 0 && hasStats) {
      const bestCells = positions.map(pos => {
        const bestEmp = employees.find(e => e.playerId === pos.bestPlayerId);
        if (!bestEmp) return '<td style="text-align:center;color:#555;">—</td>';
        const pct = bestEmp.efficiency?.byPosition?.find(p => p.positionId === pos.id)?.pct;
        const c = effColor(pct, false);
        return `<td style="text-align:center;color:${c.fg};font-family:'Share Tech Mono',monospace;font-size:0.74rem;">${escapeHtml(bestEmp.name)}<br>${pct}⚡</td>`;
      }).join('');
      bestRow = `<tr style="border-top:1px solid #2a2a2a;">
        <td colspan="5" style="font-weight:600;font-size:0.74rem;color:#888;">Best matched employee</td>
        ${bestCells}
      </tr>`;
    }

    const typeLabel = positions.length > 0
      ? `<div style="font-size:0.72rem;color:#777;margin-top:0.35rem;padding:0 1.25rem;">Effectiveness (⚡) each role: ★primary stat + secondary stat, both capped at 45 base — <strong style="color:#c0bcbc;">90⚡ = meeting all requirements</strong>, plus a log₂ bonus for over-qualification. ● = employee's current role. Green ▮ = 90⚡+.</div>`
      : '';

    bodyEl.innerHTML = `
      <div class="stats-grid" style="margin-bottom:1.5rem;">
        ${statTile(escapeHtml(company.type || 'N/A'), 'Company Type')}
        ${statTile(escapeHtml(company.director), 'Director')}
        ${statTile(company.stars + '★', 'Star Level')}
        ${statTile('$' + formatNumFull(company.dailyIncome), 'Daily Income')}
      </div>

      ${(typeof IS_OWNER !== 'undefined' && IS_OWNER) ? `
      <div class="card" style="margin-bottom:1.5rem;">
        <div class="card-header">🛠️ Director Correction (Ownership)</div>
        <div class="card-body" style="padding:0.85rem 1.25rem;">
          <p class="muted" style="margin:0 0 0.5rem 0;font-size:0.8rem;">If the director shown above is wrong (e.g. leadership changed in Torn), enter the new director's Torn ID and correct it. The next data refresh syncs the record from Torn automatically.</p>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
            <input id="set-director-id-${company.id}" type="number" placeholder="New director's Torn ID" style="background:#1a1919;border:1px solid #333;color:#c0bcbc;border-radius:4px;padding:6px 10px;font-size:0.85rem;width:200px;">
            <button class="btn btn-primary btn-small" onclick="setCompanyDirector(${company.id})">✅ Set Director</button>
            <span id="set-director-status-${company.id}" style="font-size:0.8rem;"></span>
          </div>
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-header">
          👥 Employees — Efficiency Matrix (${employees.length})
          <span style="float:right;font-size:0.8rem;color:#555;">Scroll sideways to see every position</span>
        </div>
        ${typeLabel}
        ${employees.length > 0 && positions.length > 0 ? `
        <div style="overflow-x:auto;max-height:560px;overflow-y:auto;">
          <table class="members-table" style="border-collapse:separate;border-spacing:0;">
            <thead>
              <tr>
                <th style="position:sticky;top:0;left:0;background:#1f1e1e;z-index:3;border-right:1px solid #2a2a2a;">Employee</th>
                <th style="position:sticky;top:0;background:#1f1e1e;z-index:2;text-align:right;">Manual</th>
                <th style="position:sticky;top:0;background:#1f1e1e;z-index:2;text-align:right;">Intelligence</th>
                <th style="position:sticky;top:0;background:#1f1e1e;z-index:2;text-align:right;">Endurance</th>
                <th style="position:sticky;top:0;background:#1f1e1e;z-index:2;text-align:center;">Addiction</th>
                ${posHeaders}
              </tr>
            </thead>
            <tbody>
              ${employeeRows}
              ${bestRow}
            </tbody>
          </table>
        </div>` : (employees.length > 0
          ? '<div class="card-body"><p class="muted">Position requirements could not be loaded for this company type, so an efficiency matrix is unavailable. Raw work stats are shown below.</p>' + renderRawEmployees(employees) + '</div>'
          : '<div class="card-body"><p class="muted">No employee data available.</p></div>')}
      </div>

      <p style="font-size:0.75rem;color:#444;margin-top:1rem;">
        Last fetched: ${company.lastFetchedAt ? new Date(company.lastFetchedAt).toLocaleString() : 'Never'}
      </p>`;
  } catch (err) {
    bodyEl.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

// Fallback: simple employee stats table when position requirements are unknown.
function renderRawEmployees(employees) {
  const rows = employees.map(emp => `<tr>
      <td>${escapeHtml(emp.name)}</td>
      <td>${escapeHtml(emp.position || '—')}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNumFull(emp.manualLabor)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNumFull(emp.intelligence)}</td>
      <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${formatNumFull(emp.endurance)}</td>
      <td style="text-align:center;">${emp.addiction}%</td>
    </tr>`).join('');
  return `<div style="overflow-x:auto;"><table class="members-table">
    <thead><tr>
      <th>Name</th><th>Position</th>
      <th style="text-align:right;">Manual</th><th style="text-align:right;">Intelligence</th>
      <th style="text-align:right;">Endurance</th><th style="text-align:center;">Addiction</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function closeCompanyDetail(event) {
  if (event.target === document.getElementById('company-detail-modal')) {
    document.getElementById('company-detail-modal').style.display = 'none';
  }
}

function showAddCompanyForm() {
  document.getElementById('add-company-form').style.display = 'block';
}

function hideAddCompanyForm() {
  document.getElementById('add-company-form').style.display = 'none';
  document.getElementById('add-company-status').innerHTML = '';
}

async function addCompany() {
  const companyId = document.getElementById('new-company-id').value.trim();
  const directorPlayerId = document.getElementById('new-company-director').value.trim();
  const statusEl = document.getElementById('add-company-status');

  if (!companyId || !directorPlayerId) {
    statusEl.innerHTML = '<p style="color:#ff4444;">Please enter both Company ID and Director Torn ID.</p>';
    return;
  }

  statusEl.innerHTML = '<p class="muted">Validating and adding company...</p>';

  try {
    const res = await fetch('/api/admin/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: parseInt(companyId), directorPlayerId: parseInt(directorPlayerId) })
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.innerHTML = `<p style="color:#ff4444;">❌ ${data.error}</p>`;
      return;
    }

    statusEl.innerHTML = `<p class="success-text">✅ Company "${escapeHtml(data.company.companyName)}" added successfully!</p>`;
    document.getElementById('new-company-id').value = '';
    document.getElementById('new-company-director').value = '';
    setTimeout(() => {
      hideAddCompanyForm();
      fetchCompanies();
    }, 2000);
  } catch (err) {
    statusEl.innerHTML = `<p style="color:#ff4444;">❌ Error: ${err.message}</p>`;
  }
}

// ── Director correction (Ownership) ───────────────────────────────────────────
async function setCompanyDirector(companyId) {
  const input = document.getElementById(`set-director-id-${companyId}`);
  const statusEl = document.getElementById(`set-director-status-${companyId}`);
  const directorPlayerId = parseInt(input?.value);

  if (!directorPlayerId) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#ff4444;">Enter the new director\'s Torn ID.</span>';
    return;
  }
  if (!confirm(`Set player ${directorPlayerId} as director of company ${companyId}?`)) return;

  if (statusEl) statusEl.innerHTML = '<span class="muted">Updating director...</span>';
  try {
    const res = await fetch(`/api/admin/companies/${companyId}/director`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directorPlayerId })
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.innerHTML = `<span style="color:#ff4444;">❌ ${data.error}</span>`;
      return;
    }
    if (statusEl) statusEl.innerHTML = `<span style="color:#2ecc71;">✅ Director is now ${escapeHtml(data.company.directorName)} (${directorPlayerId}).</span>`;
    input.value = '';
    fetchCompanies();
    // Reload the open modal with fresh data after a moment so the success
    // message stays visible briefly.
    setTimeout(() => openCompanyDetail(companyId), 1500);
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:#ff4444;">❌ ${err.message}</span>`;
  }
}

// ── Keep-alive ping ───────────────────────────────────────────────────────────
setInterval(() => {
  fetch('/api/ping').catch(() => { });
}, 14 * 60 * 1000 + 30 * 1000);

// ═══════════════════════════════════════════════════════════════════════════════
// TRAVEL PROFITS
// ═══════════════════════════════════════════════════════════════════════════════

function renderTravelProfits() {
  const container = document.getElementById('travel-profits-data');

  if (!travelProfitsCache || !travelProfitsCache.profits || !travelProfitsCache.profits.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💰</span>
        <p>No items found.</p>
        <p class="muted">Items may not be available or lack market data.</p>
      </div>`;
    return;
  }

  // Get travel method from radio buttons
  const travelMethod = document.querySelector('input[name="travelMethod"]:checked')?.value || 'standard';

  // Get selected country from dropdown
  const selectedCountry = document.getElementById('travel-country-select')?.value || '';

  // Get quantity from input (default 25, min 5, max 29)
  const quantityInput = document.getElementById('profit-quantity');
  let quantity = parseInt(quantityInput?.value) || 25;
  quantity = Math.max(5, Math.min(29, quantity));

  // Get item types from checkboxes
  const typePlushie = document.getElementById('type-plushie')?.checked ?? true;
  const typeFlower = document.getElementById('type-flower')?.checked ?? true;
  const typeDrug = document.getElementById('type-drug')?.checked ?? true;
  const typeOther = document.getElementById('type-other')?.checked ?? true;

  const sortBy = document.getElementById('profit-sort')?.value || 'profitPerRun';

  let profits = [...travelProfitsCache.profits];

  // Filter by item type using checkboxes
  profits = profits.filter(p => {
    const type = p.type.toLowerCase();
    const normalizedType = type.endsWith('s') ? type.slice(0, -1) : type;

    if (normalizedType === 'plushie' && typePlushie) return true;
    if (normalizedType === 'flower' && typeFlower) return true;
    if (normalizedType === 'drug' && typeDrug) return true;
    if (!['plushie', 'flower', 'drug'].includes(normalizedType) && typeOther) return true;

    return false;
  });

  // Filter by selected country if one is chosen
  if (selectedCountry) {
    profits = profits.filter(p => p.country === selectedCountry);
  }

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
      profits.sort((a, b) => {
        const aFlightCost = getFlightCost(a.country, travelMethod);
        const bFlightCost = getFlightCost(b.country, travelMethod);
        return ((b.profit * quantity) - bFlightCost) - ((a.profit * quantity) - aFlightCost);
      });
      break;
  }

  // Group by country
  const grouped = {};
  profits.forEach(p => {
    if (!grouped[p.country]) grouped[p.country] = [];
    grouped[p.country].push(p);
  });

  const summary = travelProfitsCache.summary || {};
  const inStockProfits = profits.filter(p => !p.outOfStock);

  // Find the best profit per run from IN-STOCK items only
  const bestRun = inStockProfits.length > 0 ? inStockProfits.reduce((best, current) => {
    const bestFlightCost = getFlightCost(best.country, travelMethod);
    const currentFlightCost = getFlightCost(current.country, travelMethod);
    const bestProfit = (best.profit * quantity) - bestFlightCost;
    const currentProfit = (current.profit * quantity) - currentFlightCost;
    return currentProfit > bestProfit ? current : best;
  }) : null;

  // Calculate maximum possible profit for selected country
  let selectedCountryTotal = 0;
  if (selectedCountry && profits.length > 0) {
    const flightCost = getFlightCost(selectedCountry, travelMethod);
    let slotsRemaining = quantity;
    let totalProfit = 0;

    const sortedItems = [...profits].sort((a, b) => b.profit - a.profit);
    for (const item of sortedItems) {
      if (slotsRemaining <= 0) break;
      const takeAmount = Math.min(item.quantity, slotsRemaining);
      totalProfit += item.profit * takeAmount;
      slotsRemaining -= takeAmount;
    }
    selectedCountryTotal = totalProfit - flightCost;
  }

  let html = `
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-header">
        💰 Travel Profits Summary
        <span style="float:right;font-size:0.8rem;color:#555;">
          ${profits.length} items ${selectedCountry ? `for ${getCountryName(selectedCountry)}` : `across ${Object.keys(grouped).length} countries`}
        </span>
      </div>
      <div class="card-body">
        <div class="stats-grid">
          ${selectedCountry ? statTile(getCountryName(selectedCountry), 'Selected Country') : (bestRun ? statTile(getCountryName(bestRun.country), 'Best Country') : statTile('—', 'Best Country'))}
          ${selectedCountry ? statTile('$' + formatNum(selectedCountryTotal), 'Total Profit') : (bestRun ? statTile('+' + formatNum((bestRun.profit * quantity) - getFlightCost(bestRun.country, travelMethod)), 'Best Profit/Run') : statTile('—', 'Best Profit/Run'))}
          ${bestRun ? statTile(escapeHtml(bestRun.name), 'Best Item') : statTile('—', 'Best Item')}
          ${statTile(travelMethod === 'standard' ? '✈️ Standard' : travelMethod === 'airstrip' ? '🛫 Airstrip' : '🚀 Private', 'Travel Method')}
        </div>
      </div>
    </div>`;

  Object.entries(grouped).forEach(([country, items]) => {
    const flightCost = getFlightCost(country, travelMethod);
    const countryTotal = items.reduce((sum, p) => sum + (p.profit * quantity), 0) - flightCost;

    // Travel time for this country
    let baseTravelTime = 0;
    if (items.length > 0 && items[0].travelTimes) {
      baseTravelTime = items[0].travelTimes[travelMethod] || items[0].travelTimes['standard'] || 0;
    }

    const rows = items.map(item => {
      const profitPerRun = (item.profit * quantity) - flightCost;
      // Try normalized country+name match first, then fall back to name-only match (case-insensitive)
      let analytics = stockAnalyticsCache[`${item.country}::${(item.name || '').toLowerCase().trim()}`];
      if (!analytics && stockAnalyticsCache._byName) {
        analytics = stockAnalyticsCache._byName[(item.name || '').toLowerCase().trim()];
      }
      // Burn Rate
      let burnRateHtml = '<span style="color:#555;">—</span>';
      if (analytics && analytics.burnRate && analytics.burnRate.perHour > 0) {
        burnRateHtml = `<span style="font-family:'Share Tech Mono',monospace;">${analytics.burnRate.perHour.toFixed(1)}</span>`;
      }

      // Stockout
      let stockoutHtml = '<span style="color:#555;">—</span>';
      if (analytics && analytics.stockout) {
        if (analytics.stockout.willStockOut && analytics.stockout.stockoutInMinutes) {
          stockoutHtml = `<span style="color:#e74c3c;font-family:'Share Tech Mono',monospace;">~${analytics.stockout.stockoutInMinutes}m</span>`;
        } else if (analytics.stockout.stockoutInMinutes) {
          stockoutHtml = `<span style="color:#4caf50;font-family:'Share Tech Mono',monospace;">${analytics.stockout.stockoutInMinutes}m</span>`;
        }
      }

      // Next Restock
      let restockHtml = '<span style="color:#555;">—</span>';
      if (analytics && analytics.restock && analytics.restock.nextInMinutes) {
        restockHtml = `<span style="color:#f0a500;font-family:'Share Tech Mono',monospace;">~${analytics.restock.nextInMinutes}m</span>`;
      }

      // Recommendation
      let recHtml = '<span style="color:#555;">—</span>';
      if (analytics && analytics.optimalArrival && analytics.optimalArrival.departureRecommendation) {
        const rec = analytics.optimalArrival.departureRecommendation;
        const isDoNotTravel = rec.action && rec.action.includes('Do not travel');
        const isDepartNow = rec.action && rec.action.includes('Depart now');
        const isDepartAt = rec.action && rec.action.includes('Depart at');
        const recColor = isDepartNow ? '#4caf50' : isDepartAt ? '#4a90e2' : isDoNotTravel ? '#e74c3c' : '#f0a500';
        // Format the action text with UTC badge if a time is present
        let actionHtml = rec.action;
        if (isDepartAt && rec.departAt) {
          const depDate = new Date(rec.departAt);
          const utcStr = depDate.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
          actionHtml = `<span style="color:#4a90e2;">✈️ Leave at ${utcStr}</span>`;
        } else if (isDepartNow && rec.arriveAt) {
          const arrDate = new Date(rec.arriveAt);
          const utcStr = arrDate.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
          actionHtml = `<span style="color:#4caf50;">✈️ Depart now</span><br><small style="color:#888;">Arrive ~${utcStr}</small>`;
        }
        recHtml = `<span style="color:${recColor};font-size:0.75rem;">${actionHtml}<br><small style="color:#888;">${rec.reason || ''}</small></span>`;
      }

      // Confidence
      let confHtml = '<span style="color:#555;">—</span>';
      if (analytics && analytics.confidence) {
        const confColors = { high: '#4caf50', medium: '#f0a500', low: '#e74c3c' };
        confHtml = `<span style="color:${confColors[analytics.confidence] || '#555'};font-size:0.78rem;">${analytics.confidence}</span>`;
      }

      const isOos = item.outOfStock;
      const rowStyle = '';
      const qtyDisplay = isOos ? '<span style="color:#ff4444;font-size:0.75rem;">OUT OF STOCK</span>' : item.quantity.toLocaleString();
      const profitColor = item.profit > 0 ? '#4caf50' : '#ff4444';

      return `
        <tr style="${rowStyle}">
          <td>${escapeHtml(item.name)}</td>
          <td style="color:#888;font-size:0.85rem;">${escapeHtml(item.type)}</td>
          <td style="text-align:center;">${qtyDisplay}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;">$${formatNum(item.buyPrice)}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;">$${formatNum(item.marketValue)}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;color:${profitColor};">${item.profit > 0 ? '+$' + formatNum(item.profit) : '-$' + formatNum(Math.abs(item.profit))}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;color:#f0a500;">${item.profit > 0 ? '+$' + formatNum(profitPerRun) : '-'}</td>
          <td style="text-align:center;font-family:'Share Tech Mono',monospace;font-size:0.85rem;">${burnRateHtml}</td>
          <td style="text-align:center;font-family:'Share Tech Mono',monospace;font-size:0.85rem;">${stockoutHtml}</td>
          <td style="text-align:center;font-size:0.85rem;">${restockHtml}</td>
          <td style="text-align:center;font-size:0.78rem;line-height:1.3;">${recHtml}</td>
          <td style="text-align:center;">${confHtml}</td>
        </tr>`;
    }).join('');

    // Calculate overall country departure: latest departAt among all items with restock data
    let latestDepartUTC = null;
    let soonestArriveUTC = null;
    let hasAnyRec = false;
    items.forEach(item => {
      let analytics = stockAnalyticsCache[`${item.country}::${(item.name || '').toLowerCase().trim()}`];
      if (!analytics && stockAnalyticsCache._byName) {
        analytics = stockAnalyticsCache._byName[(item.name || '').toLowerCase().trim()];
      }
      if (analytics && analytics.optimalArrival && analytics.optimalArrival.departureRecommendation) {
        const rec = analytics.optimalArrival.departureRecommendation;
        hasAnyRec = true;
        if (rec.departAt) {
          const depTime = new Date(rec.departAt).getTime();
          if (!latestDepartUTC || depTime > latestDepartUTC) latestDepartUTC = depTime;
        }
        if (rec.arriveAt) {
          const arrTime = new Date(rec.arriveAt).getTime();
          if (!soonestArriveUTC || arrTime < soonestArriveUTC) soonestArriveUTC = arrTime;
        }
      }
    });
    let overallBanner = '';
    if (hasAnyRec && latestDepartUTC) {
      const depStr = new Date(latestDepartUTC).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
      overallBanner = `<div style="background:#1a1919;border-top:1px solid #2a2828;padding:0.6rem 1rem;display:flex;align-items:center;gap:0.5rem;">
        <span style="font-size:0.85rem;">✈️</span>
        <span style="font-size:0.8rem;color:#4a90e2;font-weight:600;">Recommended departure: ${depStr}</span>
        <span style="font-size:0.75rem;color:#888;">(to restock all items)</span>
      </div>`;
    }

    html += `
      <div class="card" style="margin-bottom:1rem;">
        <div class="card-header">
          🌍 ${getCountryName(country)}
          <span style="float:right;font-size:0.75rem;color:#555;">
            Travel: ~${baseTravelTime} min | Total: $${formatNum(countryTotal)}
          </span>
        </div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
          <table class="members-table" style="min-width:1100px;">
            <thead>
              <tr>
                <th style="white-space:nowrap;">Item</th>
                <th style="white-space:nowrap;">Type</th>
                <th style="text-align:center;white-space:nowrap;">Avail</th>
                <th style="text-align:right;white-space:nowrap;">Buy</th>
                <th style="text-align:right;white-space:nowrap;">Market</th>
                <th style="text-align:right;white-space:nowrap;">Profit</th>
                <th style="text-align:right;white-space:nowrap;">Run</th>
                <th style="text-align:center;white-space:nowrap;">🔥 Burn/hr</th>
                <th style="text-align:center;white-space:nowrap;">⏳ Stockout</th>
                <th style="text-align:center;white-space:nowrap;">🔁 Restock</th>
                <th style="text-align:center;white-space:nowrap;">🎯 Recommendation</th>
                <th style="text-align:center;white-space:nowrap;">🔒 Conf.</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${overallBanner}
      </div>`;
  });

  container.innerHTML = html;
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
// NOTIFICATIONS (Ownership only)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchNotifications() {
  const notifCard = document.getElementById('notification-card');
  const notifList = document.getElementById('notification-list');
  const notifLoading = document.getElementById('notification-loading');
  const notifEmpty = document.getElementById('notification-empty');
  const notifBadge = document.getElementById('notification-badge');

  if (!notifCard) return; // Not ownership, no notification card

  try {
    notifCard.style.display = 'block';
    notifLoading.style.display = 'block';
    notifList.style.display = 'none';
    notifEmpty.style.display = 'none';

    const res = await fetch('/api/notifications?limit=20');
    if (!res.ok) {
      notifCard.style.display = 'none';
      return;
    }

    const notifications = await res.json();

    notifLoading.style.display = 'none';

    if (notifications.length === 0) {
      notifEmpty.style.display = 'block';
      notifBadge.style.display = 'none';
      return;
    }

    // Count unread
    const unread = notifications.filter(n => !n.isRead);
    if (unread.length > 0) {
      notifBadge.style.display = 'inline';
      notifBadge.textContent = unread.length;
    } else {
      notifBadge.style.display = 'none';
    }

    // Render list
    notifList.style.display = 'block';
    notifList.innerHTML = notifications.map(n => {
      const time = new Date(n.createdAt).toLocaleString();
      let details = '';

      if (n.type === 'application') {
        const status = n.allYes ? '✅ All agreed' : '⚠️ Not all agreed';
        details = `<div style="font-size:0.8rem;color:#888;margin-top:0.25rem;">
          <span>${n.applicantName} [${n.applicantId}]</span> &middot; 
          <span>${status}</span>
          <a href="https://www.torn.com/profiles.php?XID=${n.applicantId}" target="_blank" style="color:#3498db;margin-left:0.5rem;">View Profile ↗</a>
        </div>`;
      } else if (n.type === 'weekly_report') {
        const membersText = n.memberCount ? `${n.memberCount} members` : '';
        details = `<div style="font-size:0.8rem;color:#888;margin-top:0.25rem;">
          <span>${membersText}</span>
          ${n.csvContent ? `<button class="btn btn-small btn-outline" style="font-size:0.7rem;padding:2px 6px;margin-left:0.5rem;" onclick="downloadNotificationCsv('${n._id}')">⬇️ Download CSV</button>` : ''}
        </div>`;
      } else if (n.type === 'employee_removal') {
        details = `<div style="font-size:0.8rem;color:#888;margin-top:0.25rem;">
          <span>${n.employeeName} [${n.employeeId}]</span> &middot;
          <span>🏢 ${n.companyName || ''}</span>
          <a href="https://www.torn.com/profiles.php?XID=${n.employeeId}" target="_blank" style="color:#3498db;margin-left:0.5rem;">View Profile ↗</a>
        </div>
        <div style="margin-top:0.5rem;">
          <button class="btn btn-small btn-danger" style="font-size:0.75rem;padding:3px 10px;" onclick="removeEmployeeData(${n.employeeId}, '${escapeHtml(n.employeeName || '')}')">🗑️ Delete Employee Data</button>
        </div>`;
      }

      const readStyle = n.isRead ? 'opacity:0.6;' : 'font-weight:600;';

      return `<div style="padding:0.5rem 0;border-bottom:1px solid #2a2828;${readStyle}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;cursor:pointer;" onclick="markNotificationRead('${n._id}', this.parentElement.parentElement)">
            <div style="font-size:0.85rem;">${n.title}</div>
            ${details}
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;margin-left:1rem;flex-shrink:0;">
            <span style="font-size:0.7rem;color:#666;white-space:nowrap;">${time}</span>
            <button onclick="event.stopPropagation();deleteNotification('${n._id}')" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:0.85rem;padding:2px 4px;" title="Delete notification">✕</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Error fetching notifications:', err);
    const card = document.getElementById('notification-card');
    if (card) card.style.display = 'none';
  }
}

async function markNotificationRead(id, element) {
  try {
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
    if (element) {
      element.style.opacity = '0.6';
      element.style.fontWeight = '400';
    }
    // Refresh badge count
    const badge = document.getElementById('notification-badge');
    if (badge) {
      const current = parseInt(badge.textContent) || 0;
      if (current > 1) {
        badge.textContent = current - 1;
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error marking notification read:', err);
  }
}

async function removeEmployeeData(playerId, employeeName) {
  if (!confirm(`Delete all stored data for ${employeeName} (${playerId})? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/admin/employees/${playerId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert(`Error: ${data.error}`);
      return;
    }
    alert(`✅ ${data.message}`);
    fetchNotifications();
  } catch (err) {
    alert(`Error deleting employee data: ${err.message}`);
  }
}

async function deleteNotification(id) {
  if (!confirm('Delete this notification?')) return;
  try {
    const res = await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      console.error('Error deleting notification:', data.error);
      return;
    }
    // Re-fetch the notification list
    fetchNotifications();
  } catch (err) {
    console.error('Error deleting notification:', err);
  }
}

function downloadNotificationCsv(notificationId) {
  fetch(`/api/notifications?limit=50`)
    .then(res => res.json())
    .then(notifications => {
      const notif = notifications.find(n => n._id === notificationId);
      if (notif && notif.csvContent) {
        const blob = new Blob([notif.csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `weekly_report_${new Date(notif.createdAt).toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    })
    .catch(err => console.error('Error downloading CSV:', err));
}

// Auto-fetch notifications when profile section is shown
(function () {
  const origShowSection = window.showSection;
  window.showSection = function (sectionId, el) {
    if (sectionId === 'profile') {
      setTimeout(fetchNotifications, 100);
    }
    if (origShowSection) origShowSection(sectionId, el);
  };

  // Also call on page load
  if (document.getElementById('notification-card')) {
    setTimeout(fetchNotifications, 500);
  }
})();

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
    case 'utilities-inventory':
      if (document.getElementById('admin-utilities-inventory-data').innerHTML.includes('empty-state')) {
        fetchUtilitiesInventory();
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


// ── Utilities Inventory ──────────────────────────────────────────────────────
async function fetchUtilitiesInventory() {
  const container = document.getElementById('admin-utilities-inventory-data');
  container.innerHTML = '<div class="channel-loading">LOADING UTILITIES INVENTORY...</div>';
  try {
    const res = await fetch('/api/admin/utilities-inventory');
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      container.innerHTML = `<div class="channel-error">⚠️ Server returned non-JSON response. Please ensure you're logged in and have leadership access.</div>`;
      return;
    }
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`; return; }
    container.innerHTML = renderUtilitiesInventory(data.items || [], data.loans || [], data.memberCount || 0);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ Error: ${err.message}</div>`;
  }
}

function utilitiesStatusBadge(status) {
  const map = {
    'IN USE': { label: '🔄 In Use', color: '#f39c12' },
    'RETURN DUE': { label: '⬅️ Return Due', color: '#e74c3c' },
    'CONSUMED': { label: '💨 Consumed', color: '#2ecc71' },
    'NO OC': { label: '➖ Not for OC', color: '#888' }
  };
  const s = map[status] || { label: status, color: '#888' };
  return `<span style="color:${s.color};font-weight:600;">${s.label}</span>`;
}

function formatLoanReturnTime(loan) {
  if (loan.consumed) return 'N/A (consumed)';
  // If the player's OC role does not require this item, the return is based
  // on user completion rather than the crime end time.
  if (!loan.ocRoleMatch) return 'Upon user completion';
  if (loan.status === 'RETURN DUE') return 'Now — should be returned';
  if (loan.status === 'IN USE' && loan.timeReady) {
    return `When crime completes (ready ${new Date(loan.timeReady).toLocaleDateString()} ${new Date(loan.timeReady).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  }
  return 'When crime completes';
}
function renderUtilitiesInventory(items, loans, memberCount) {
  if (!items.length && !loans.length) {
    return '<div class="empty-state"><p class="muted">No Utilities items found in the armory.</p></div>';
  }

  // Summary tiles
  const inUse = loans.filter(l => l.status === 'IN USE').length;
  const returnDue = loans.filter(l => l.status === 'RETURN DUE').length;
  const consumed = loans.filter(l => l.status === 'CONSUMED').length;

  // Inventory table
  const invRows = items.map(item => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td style="text-align:center;">${escapeHtml(item.type || '—')}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${item.total || 0}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#e74c3c;">${item.loaned || 0}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;color:#2ecc71;">${item.available || 0}</td>
    </tr>`).join('');

  const inventoryHtml = `
    <div class="card">
      <div class="card-header">🧰 Utilities Inventory (${items.length} types)</div>
      <div style="overflow-x:auto;">
        <table class="members-table">
          <thead><tr>
            <th>Name</th>
            <th style="text-align:center;">Type</th>
            <th style="text-align:center;">Total</th>
            <th style="text-align:center;">Loaned</th>
            <th style="text-align:center;">Available</th>
          </tr></thead>
          <tbody>${invRows}</tbody>
        </table>
      </div>
    </div>`;

  // Loaned items table (tied to person + their OC)
  let loansHtml = '';
  if (loans.length) {
    const loanRows = loans.map(l => `
      <tr>
        <td>
          <a href="https://www.torn.com/profiles.php?XID=${l.playerId}" target="_blank" rel="noopener"
            style="color:#a78df5;text-decoration:none;font-size:0.78rem;">${escapeHtml(l.playerName)}</a>
          <span style="color:#555;font-size:0.7rem;"> [${l.playerId}]</span>
        </td>
        <td>${escapeHtml(l.itemName)}${l.ocRoleMatch ? ' <span title="Matches this member\'s OC role requirement" style="cursor:help;font-size:0.7rem;color:#f39c12;">🧰</span>' : ''}</td>
        <td>${l.status === 'NO OC' ? '—' : escapeHtml(l.crimeName || '—')}</td>
        <td style="text-align:center;">${l.status === 'NO OC' ? '—' : escapeHtml(l.role || '—')}</td>
        <td style="text-align:center;white-space:nowrap;">${utilitiesStatusBadge(l.status)}</td>
        <td style="text-align:center;">${l.status === 'NO OC' ? '' : escapeHtml(l.crimeStatus || '')}</td>
        <td style="font-size:0.75rem;">${formatLoanReturnTime(l)}</td>
      </tr>`).join('');

    loansHtml = `
      <div class="card" style="margin-top:1rem;">
        <div class="card-header">📋 Loaned Utilities (${loans.length})</div>
        <div style="overflow-x:auto;">
          <table class="members-table">
            <thead><tr>
              <th>Member</th>
              <th>Item</th>
              <th>OC Crime</th>
              <th style="text-align:center;">Role</th>
              <th style="text-align:center;">Status</th>
              <th style="text-align:center;">Crime Status</th>
              <th>Expected Return</th>
            </tr></thead>
            <tbody>${loanRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  return `
    <div class="stats-grid" style="margin-bottom:1rem;">
      ${statTile(items.length, 'Item Types')}
      ${statTile(loans.length, 'Loaned Out')}
      ${statTile(inUse, 'In Use')}
      ${statTile(returnDue, 'Return Due')}
      ${statTile(consumed, 'Consumed')}
    </div>
    ${inventoryHtml}
    ${loansHtml}`;
}
// Weekly snapshot, records members hours from week to week and provides an email to Snowvale
async function takeWeeklySnapshot() {
  try {
    const res = await fetch('/api/admin/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    document.getElementById('snapshot-status').innerHTML = `<p class="success-text">✅ ${data.message}</p>`;
  } catch (err) {
    document.getElementById('snapshot-status').innerHTML = `<p class="error-text">❌ Error: ${err.message}</p>`;
  }
}

// ─── Save user email address to database ──────────────────────────────────────
async function saveUserEmail() {
  try {
    const email = document.getElementById('email-input').value.trim();

    const res = await fetch('/api/user/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save email');
    }

    // Show success message
    const statusEl = document.getElementById('email-status');
    if (statusEl) {
      statusEl.innerHTML = `<p class="success-text">✅ ${data.message}</p>`;
      setTimeout(() => {
        statusEl.innerHTML = '';
      }, 3000);
    }

    // Also update the displayed email at the top of the profile
    const profileEmailDisplay = document.querySelector('.profile-detail .value[id="user-email"]');
    if (profileEmailDisplay) {
      profileEmailDisplay.textContent = email || 'Not provided';
    }

    return { success: true, message: data.message };

  } catch (err) {
    // Show error message
    const statusEl = document.getElementById('email-status');
    if (statusEl) {
      statusEl.innerHTML = `<p class="error-text">❌ ${err.message}</p>`;
    }

    console.error('Email save error:', err);
    return { success: false, error: err.message };
  }
}

// ─── Test Run: snapshot with diff, shows table + send results ────────────────
let _testRunCsvFull = '';

async function takeSnapshotTestRun() {
  const statusEl = document.getElementById('snapshot-test-status');
  const csvBox = document.getElementById('snapshot-test-csv');
  _testRunCsvFull = '';
  csvBox.style.display = 'none';
  statusEl.innerHTML = '<p class="muted">🧪 Running test snapshot… fetching live stats for all members. This may take up to 30 seconds.</p>';

  try {
    const res = await fetch('/api/admin/snapshot/test-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      statusEl.innerHTML = `<p class="error-text">❌ Test run failed: ${data.message || data.error || 'Unknown error'}</p>`;
      return;
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const prevNote = data.hasPrevious
      ? `Diffed against: <code style="color:#888;">${data.previousSnapshotId}</code>`
      : `<span style="color:#f0a500;">⚠️ No previous snapshot found — showing current totals as baseline.</span>`;

    // ── Send results badges ───────────────────────────────────────────────────
    const sr = data.sendResults || {};
    const emailBadge = sr.email?.success
      ? `<span style="color:#4caf50;">✅ Email sent</span>`
      : `<span style="color:#888;" title="${sr.email?.error || 'not configured'}">⬜ Email: ${sr.email?.error ? 'failed' : 'not configured'}</span>`;

    statusEl.innerHTML = `
      <div class="card" style="background:#1a1919;border:1px solid #2a2828;padding:0.75rem 1rem;margin-bottom:0.75rem;">
        <p class="success-text" style="margin:0 0 0.4rem;">✅ ${data.message}</p>
        <p class="muted" style="font-size:0.8rem;margin:0 0 0.25rem;">
          Snapshot ID: <code style="color:#888;">${data.snapshotId}</code> &nbsp;|&nbsp;
          Members captured: <strong>${data.membersSnapshotted}</strong> / ${data.totalMembers}
        </p>
        <p class="muted" style="font-size:0.8rem;margin:0 0 0.5rem;">${prevNote}</p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:0.8rem;">${emailBadge}</div>
      </div>`;

    // ── Diff table ────────────────────────────────────────────────────────────
    if (data.diffRows && data.diffRows.length) {
      _testRunCsvFull = data.diffCsv || '';

      const rows = data.diffRows.map(r => {
        const diffColor = r.difference > 0 ? '#4caf50' : r.difference < 0 ? '#ff4444' : '#888';
        const diffPrefix = r.difference > 0 ? '+' : '';
        return `<tr>
          <td>${escapeHtml(r.playerName)}</td>
          <td style="text-align:center;color:#555;font-size:0.8rem;">${r.playerId}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${r.previousTotal.toLocaleString()}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;">${r.currentTotal.toLocaleString()}</td>
          <td style="text-align:right;font-family:'Share Tech Mono',monospace;color:${diffColor};font-weight:600;">${diffPrefix}${r.difference.toLocaleString()}</td>
        </tr>`;
      }).join('');

      csvBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <span style="font-size:0.85rem;color:#888;">📊 Stat Diff — ${data.diffRows.length} members (sorted by gain ↓)</span>
          <button class="btn btn-small btn-outline" onclick="downloadTestCsv()">⬇️ Download CSV</button>
        </div>
        <div style="overflow-x:auto;max-height:350px;overflow-y:auto;">
          <table class="members-table" style="font-size:0.82rem;">
            <thead><tr>
              <th>Name</th>
              <th style="text-align:center;">Torn ID</th>
              <th style="text-align:right;">Previous Total</th>
              <th style="text-align:right;">Current Total</th>
              <th style="text-align:right;">Difference</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      csvBox.style.display = 'block';
    }
  } catch (err) {
    statusEl.innerHTML = `<p class="error-text">❌ Error: ${err.message}</p>`;
  }
}

function downloadTestCsv() {
  if (!_testRunCsvFull) return;
  const blob = new Blob([_testRunCsvFull], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `test_snapshot_diff_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAnnouncement() {
  const card = document.getElementById('announcement-card');
  const loading = document.getElementById('announcement-loading');
  const list = document.getElementById('announcement-list');
  const empty = document.getElementById('announcement-empty');

  if (!card) return;

  try {
    const res = await fetch('/api/announcements?limit=5');
    if (!res.ok) throw new Error('Failed to fetch announcements');

    const announcements = await res.json();

    loading.style.display = 'none';

    if (announcements && announcements.length > 0) {
      card.style.display = 'block';
      list.style.display = 'block';
      empty.style.display = 'none';

      list.innerHTML = announcements.map((a, i) => `
        <div style="padding:0.5rem 0;${i < announcements.length - 1 ? 'border-bottom:1px solid #2a2828;' : ''}">
          <p style="white-space:pre-wrap;margin-bottom:0.25rem;font-size:0.85rem;">${escapeHtml(a.message)}</p>
          <span style="font-size:0.7rem;color:#666;">Posted by ${escapeHtml(a.authorName)} — ${new Date(a.createdAt).toLocaleString()}</span>
        </div>
      `).join('');
    } else {
      card.style.display = 'block';
      list.style.display = 'none';
      empty.style.display = 'block';
    }
  } catch (err) {
    console.error('Error fetching announcements:', err);
    loading.style.display = 'none';
    empty.style.display = 'block';
    card.style.display = 'block';
  }
}

function toggleAnnouncementForm() {
  const formBody = document.getElementById('announcement-form-body');
  const input = document.getElementById('announcement-input');
  if (formBody.style.display === 'none' || !formBody.style.display) {
    formBody.style.display = 'block';
    input.value = '';
    document.getElementById('announcement-status').textContent = '';
    fetchAnnouncementHistory();
  } else {
    formBody.style.display = 'none';
  }
}

async function submitAnnouncement() {
  const input = document.getElementById('announcement-input');
  const statusEl = document.getElementById('announcement-status');
  const message = input.value.trim();

  if (!message) {
    statusEl.innerHTML = '<span style="color:#e74c3c;">Please enter a message.</span>';
    return;
  }

  statusEl.innerHTML = '<span class="muted">Posting...</span>';

  try {
    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const data = await res.json();

    if (!res.ok) {
      statusEl.innerHTML = `<span style="color:#e74c3c;">❌ ${data.error}</span>`;
      return;
    }

    statusEl.innerHTML = '<span class="success-text">✅ Announcement posted!</span>';
    input.value = '';
    fetchAnnouncement();
    fetchAnnouncementHistory();
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#e74c3c;">❌ Error: ${err.message}</span>`;
  }
}

async function fetchAnnouncementHistory() {
  const historyEl = document.getElementById('announcement-history');
  if (!historyEl) return;

  try {
    const res = await fetch('/api/announcements?limit=10');
    if (!res.ok) throw new Error('Failed to fetch history');

    const announcements = await res.json();

    if (announcements.length === 0) {
      historyEl.innerHTML = '<p class="muted" style="font-size:0.8rem;">No previous announcements.</p>';
      return;
    }

    historyEl.innerHTML = `
      <div style="font-size:0.8rem;color:#888;margin-bottom:0.5rem;">Recent Announcements:</div>
      ${announcements.map(a => `
        <div style="background:#1a1919;border:1px solid #2a2828;border-radius:4px;padding:0.5rem;margin-bottom:0.4rem;">
          <p style="font-size:0.8rem;white-space:pre-wrap;margin-bottom:0.25rem;">${escapeHtml(a.message)}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.7rem;color:#666;">${a.authorName} — ${new Date(a.createdAt).toLocaleString()}</span>
            <button class="btn btn-small btn-outline" onclick="deleteAnnouncement('${a._id}')" style="font-size:0.65rem;padding:1px 6px;">🗑️</button>
          </div>
        </div>
      `).join('')}
    `;
  } catch (err) {
    console.error('Error fetching announcement history:', err);
  }
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;

  try {
    const res = await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) {
      alert(`Error: ${data.error}`);
      return;
    }

    fetchAnnouncement();
    fetchAnnouncementHistory();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FF SCOUTER TARGET FINDER
// ═══════════════════════════════════════════════════════════════════════════════

// ── Check FFScouter key status on section load ───────────────────────────────
async function checkFFScouterKeyStatus() {
  const statusEl = document.getElementById('ffscouter-key-status');
  try {
    const res = await fetch('/api/user/check-ffscouter-key');
    const data = await res.json();
    if (res.ok && data.hasKey) {
      statusEl.innerHTML = '<p class="success-text">✅ FFScouter API key is saved.</p>';
    } else {
      statusEl.innerHTML = '<p class="muted">No FFScouter API key saved yet.</p>';
    }
  } catch {
    // Silently fail - the key status will show on first fetch attempt
    statusEl.innerHTML = '';
  }
}

// ── Save FFScouter API Key ───────────────────────────────────────────────────
async function saveFFScouterKey() {
  const input = document.getElementById('ffscouter-key-input');
  const statusEl = document.getElementById('ffscouter-key-status');
  const key = input.value.trim();

  if (!key) {
    statusEl.innerHTML = '<p style="color:#ff4444;">Please enter an FFScouter API key.</p>';
    return;
  }

  statusEl.innerHTML = '<p class="muted">Validating key...</p>';

  try {
    const res = await fetch('/api/user/ffscouter-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ffScouterKey: key })
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.innerHTML = `<p style="color:#ff4444;">❌ ${data.error}</p>`;
      return;
    }

    statusEl.innerHTML = '<p class="success-text">✅ FFScouter API key saved successfully!</p>';
    input.value = '';
  } catch (err) {
    statusEl.innerHTML = `<p style="color:#ff4444;">❌ Error: ${err.message}</p>`;
  }
}

// ── Toggle custom filter inputs when a preset is selected ─────────────────────
function togglePresetFilters() {
  const preset = document.getElementById('target-preset')?.value;
  const disabled = preset && preset !== '';
  const customInputs = ['target-minlevel', 'target-maxlevel', 'target-minff', 'target-maxff', 'target-factionless'];
  customInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = disabled;
      el.style.opacity = disabled ? '0.4' : '1';
      el.style.pointerEvents = disabled ? 'none' : 'auto';
    }
  });
}

// ── Reset Target Filters to Defaults ─────────────────────────────────────────
function resetTargetFilters() {
  togglePresetFilters();
  document.getElementById('target-preset').value = '';
  document.getElementById('target-minlevel').value = 1;
  document.getElementById('target-maxlevel').value = 100;
  document.getElementById('target-minff').value = 1;
  document.getElementById('target-maxff').value = 3.5;
  document.getElementById('target-limit').value = 25;
  document.getElementById('target-factionless').checked = false;
}

// ── Fetch Targets from FFScouter ─────────────────────────────────────────────
async function fetchTargets() {
  const container = document.getElementById('targets-data');
  container.innerHTML = '<div class="channel-loading">🎯 FINDING TARGETS...</div>';

  // Get filter values
  const minlevel = document.getElementById('target-minlevel').value || 1;
  const maxlevel = document.getElementById('target-maxlevel').value || 100;
  const minff = document.getElementById('target-minff').value || 1;
  const maxff = document.getElementById('target-maxff').value || 3.5;
  const limit = Math.min(parseInt(document.getElementById('target-limit').value) || 25, 50);
  const factionless = document.getElementById('target-factionless').checked ? 1 : 0;
  const preset = document.getElementById('target-preset')?.value || '';

  try {
    const params = new URLSearchParams();
    params.set('limit', limit);

    // If a preset is selected, only send preset + limit (FFScouter spec: only key + limit allowed with preset)
    if (preset && preset !== '') {
      params.set('preset', preset);
    } else {
      // Custom filters — include inactiveonly
      params.set('inactiveonly', 1);
      params.set('minlevel', minlevel);
      params.set('maxlevel', maxlevel);
      params.set('minff', minff);
      params.set('maxff', maxff);
      params.set('factionless', factionless);
    }

    const res = await fetch(`/api/ffscouter/targets?${params}`);
    const data = await res.json();

    if (!res.ok) {
      // Check if it's a "no FFScouter key" error
      if (res.status === 400 && data.error && data.error.includes('No FFScouter API key')) {
        container.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">🔑</span>
            <p>You need to save your FFScouter API key first.</p>
            <p class="muted">Enter your key in the field above and click Save.</p>
          </div>`;
        return;
      }
      container.innerHTML = `<div class="channel-error">⚠️ ${data.error}</div>`;
      return;
    }

    const targets = data.targets || [];

    if (targets.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🎯</span>
          <p>No targets found matching your criteria.</p>
          <p class="muted">Try adjusting your filters (level range, fair fight range, etc.).</p>
        </div>`;
      return;
    }

    container.innerHTML = renderTargets(targets, data);
  } catch (err) {
    container.innerHTML = `<div class="channel-error">⚠️ ${err.message}</div>`;
  }
}

// ── Render Targets Table ─────────────────────────────────────────────────────
function renderTargets(targets, meta) {
  // Build stats summary banner if meta data is available
  let statsBanner = '';
  if (meta && meta.userTotalStatsHuman && meta.filterThreshold) {
    const thresholdPct = Math.round((1 - meta.filterThreshold) * 100);
    statsBanner = `
      <div class="card" style="margin-bottom:1rem;background:#1a1919;border:1px solid #2a2828;">
        <div class="card-body" style="padding:0.75rem 1rem;">
          <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
            <span style="font-size:0.85rem;color:#888;">📊 <strong style="color:#c0bcbc;">Your Total Stats:</strong> ${meta.userTotalStatsHuman}</span>
            <span style="font-size:0.85rem;color:#888;">🔻 <strong style="color:#f0a500;">Max Target BS:</strong> ${meta.maxBsEstimate ? formatNumFull(meta.maxBsEstimate) : '—'}</span>
            <span style="font-size:0.85rem;color:#888;">🎯 <strong style="color:#4caf50;">Showing targets up to ${thresholdPct}% below your stats</strong></span>
          </div>
        </div>
      </div>`;
  }

  const rows = targets.map((t, i) => {
    // Format last action time
    let lastActionDisplay = '—';
    if (t.last_action) {
      const now = Math.floor(Date.now() / 1000);
      const diff = now - t.last_action;
      const days = Math.floor(diff / 86400);
      const hours = Math.floor((diff % 86400) / 3600);
      if (days > 0) lastActionDisplay = `${days}d ${hours}h ago`;
      else if (hours > 0) lastActionDisplay = `${hours}h ago`;
      else lastActionDisplay = `${Math.floor(diff / 60)}m ago`;
    }

    // Format battle stat estimate
    const bsDisplay = t.bs_estimate_human || (t.bs_estimate ? formatNumFull(t.bs_estimate) : '—');

    // FF color coding
    let ffColor = '#888';
    if (t.fair_fight !== null) {
      if (t.fair_fight >= 3) ffColor = '#4caf50';
      else if (t.fair_fight >= 2) ffColor = '#f0a500';
      else ffColor = '#e74c3c';
    }

    // Faction display
    const factionDisplay = t.faction_name
      ? `<a href="https://www.torn.com/factions.php?step=profile&ID=${t.faction_id}" target="_blank" style="color:#888;text-decoration:none;">${escapeHtml(t.faction_name)}</a>`
      : '<span style="color:#555;">—</span>';

    return `<tr>
      <td style="color:#555;font-size:0.8rem;text-align:center;">${i + 1}</td>
      <td>
        <a href="https://www.torn.com/profiles.php?XID=${t.player_id}" target="_blank" rel="noopener"
          style="color:#a78df5;text-decoration:none;font-weight:500;">
          ${escapeHtml(t.name || `Player ${t.player_id}`)}
        </a>
      </td>
      <td style="text-align:center;">${t.level || '—'}</td>
      <td style="text-align:center;color:${ffColor};font-weight:600;">${t.fair_fight !== null ? t.fair_fight.toFixed(2) : '—'}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;">${bsDisplay}</td>
      <td style="text-align:center;font-family:'Share Tech Mono',monospace;font-size:0.85rem;color:${t.bss_public ? '#c0bcbc' : '#555'};">${t.bss_public ? t.bss_public.toLocaleString() : '—'}</td>
      <td style="text-align:center;font-size:0.85rem;">${lastActionDisplay}</td>
      <td style="text-align:center;font-size:0.85rem;">${factionDisplay}</td>
      <td style="text-align:center;">
        <a href="https://www.torn.com/profiles.php?XID=${t.player_id}" target="_blank" class="btn btn-small btn-primary" style="text-decoration:none;padding:2px 8px;font-size:0.75rem;">🔍 View</a>
      </td>
    </tr>`;
  }).join('');


  return `${statsBanner}
    <div class="card">
      <div class="card-header">
        🎯 Targets Found
        <span style="float:right;font-size:0.8rem;color:#888;">${targets.length} targets</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="members-table" style="min-width:800px;">
          <thead>
            <tr>
              <th style="text-align:center;width:40px;">#</th>
              <th>Name</th>
              <th style="text-align:center;">Lvl</th>
              <th style="text-align:center;">Fair Fight</th>
              <th style="text-align:center;">BS Estimate</th>
              <th style="text-align:center;">BSS Public</th>
              <th style="text-align:center;">Last Action</th>
              <th style="text-align:center;">Faction</th>
              <th style="text-align:center;width:60px;">Profile</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Initialize dashboard features on page load ────────────────────────────────
(function initDashboard() {
  // Check URL hash for a specific section to navigate to
  const hash = window.location.hash.replace('#', '');
  const validSections = ['my-day', 'profile', 'torn', 'targets', 'faction', 'travel', 'training', 'bank-rates', 'war', 'stocks', 'oc', 'scripts', 'companies', 'admin'];
  
  if (hash && validSections.includes(hash)) {
    // Navigate to the section specified in the URL hash
    const navItem = document.querySelector(`.nav-item[href="#${hash}"]`);
    showSection(hash, navItem);
  } else if (typeof IS_EMPLOYEE !== 'undefined' && IS_EMPLOYEE) {
    // Employees default to Targets
    const navItem = document.querySelector('.nav-item[href="#targets"]');
    showSection('targets', navItem);
  } else if (document.getElementById('my-day-data')) {
    // Default: Auto-load My Day (faction members)
    fetchMyDay();
  } else if (document.getElementById('targets-data')) {
    // Fallback: if targets section exists, show it
    const navItem = document.querySelector('.nav-item[href="#targets"]');
    showSection('targets', navItem);
  }

  // Listen for hash changes (e.g., browser back/forward buttons)
  window.addEventListener('hashchange', function() {
    const newHash = window.location.hash.replace('#', '');
    if (newHash && validSections.includes(newHash)) {
      const navItem = document.querySelector(`.nav-item[href="#${newHash}"]`);
      showSection(newHash, navItem);
    }
  });

  // Fetch announcement for all members
  fetchAnnouncement();

  // Fetch notifications for ownership (uses existing fetchNotifications)
  if (IS_OWNER) {
    fetchNotifications();
  }
})();
