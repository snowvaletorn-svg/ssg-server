// Snapshot Service - handles weekly stats snapshot functionality
const WeeklySnapshot = require('../models/WeeklySnapshot');
const User = require('../models/User');
const axios = require('axios');
const { sendEmail } = require('./emailService');
const AppNotification = require('../models/AppNotification');
const FactionConfig = require('../models/FactionConfig');

// ─── Helper: HTML escape ──────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  var a = String.fromCharCode(38);
  return String(str)
    .replace(new RegExp(a, 'g'), a + 'amp;')
    .replace(/</g, a + 'lt;')
    .replace(/>/g, a + 'gt;')
    .replace(/"/g, a + 'quot;')
    .replace(/'/g, a + '#039;');
}

// ─── Helper: Get notification email recipients ────────────────────────────────
function getNotifyEmails() {
  const envEmails = process.env.NOTIFY_EMAILS;
  if (envEmails) {
    return envEmails.split(',').map(e => e.trim()).filter(Boolean);
  }
  return [];
}

// Helper function to get faction API key
async function getFactionApiKey() {
  try {
    const config = await FactionConfig.findOne({ key: 'config' });
    if (config?.tornFactionApiKey) return config.tornFactionApiKey;
  } catch (err) {
    console.error('Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY || null;
}

// ─── Fetch live stats for all users with API keys ─────────────────────────────
async function fetchAllMemberStats() {
  const dbUsers = await User.find({ tornApiKey: { $ne: null } }, 'tornPlayerId tornName tornApiKey');

  const results = await Promise.allSettled(
    dbUsers.map(async (u) => {
      try {
        const tornRes = await axios.get(
          `https://api.torn.com/user/?selections=basic,personalstats&key=${u.tornApiKey}`
        );
        if (tornRes.data.error) return null;
        return {
          playerId: tornRes.data.player_id,
          playerName: tornRes.data.name,
          totalStats: tornRes.data.personalstats?.totalstats || 0,
          timestamp: new Date()
        };
      } catch { return null; }
    })
  );

  return {
    validStats: results.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value),
    totalUsers: dbUsers.length
  };
}

// ─── Get the two most recent REAL snapshots (excludes test_ snapshots) ─────────
async function getRealSnapshots(limit = 2) {
  return WeeklySnapshot.find({ snapshotId: { $not: /^test_/ } })
    .sort({ snapshotDate: -1 })
    .limit(limit);
}

// ─── Compute diff between previous and current snapshot member stats ───────────
function computeDiff(prevStats, currStats) {
  const prevMap = {};
  prevStats.forEach(m => { prevMap[m.playerId] = m; });

  const currMap = {};
  currStats.forEach(m => { currMap[m.playerId] = m; });

  // Build unified member list (anyone in either snapshot)
  const allPlayerIds = new Set([
    ...Object.keys(prevMap),
    ...Object.keys(currMap)
  ]);

  const rows = [];
  allPlayerIds.forEach(idStr => {
    const id = parseInt(idStr);
    const prev = prevMap[id];
    const curr = currMap[id];
    const playerName = (curr || prev).playerName;
    const previousTotal = prev ? prev.totalStats : 0;
    const currentTotal = curr ? curr.totalStats : 0;
    const difference = currentTotal - previousTotal;
    rows.push({ playerName, playerId: id, previousTotal, currentTotal, difference });
  });

  // Sort by difference descending
  rows.sort((a, b) => b.difference - a.difference);
  return rows;
}

// ─── Generate diff CSV string ─────────────────────────────────────────────────
// Header: Name, Torn ID, Previous Total, Current Total, Difference
function buildDiffCSV(diffRows, prevDate, currDate) {
  const prevLabel = prevDate ? new Date(prevDate).toISOString().split('T')[0] : 'Previous';
  const currLabel = currDate ? new Date(currDate).toISOString().split('T')[0] : 'Current';

  const header = `Name,Torn ID,Previous Total (${prevLabel}),Current Total (${currLabel}),Difference`;
  const rows = diffRows.map(r =>
    `"${r.playerName}",${r.playerId},${r.previousTotal},${r.currentTotal},${r.difference}`
  );
  return [header, ...rows].join('\n');
}

// ─── Send weekly report via Email + save in-app notification ──────────────────
async function sendWeeklyReport(csvContent, label = 'Weekly Snapshot Report', testMode = false, discordUserId = null, emailTo = null) {
  const results = { email: null, discord: null };

  const prefix = testMode ? '🧪 [TEST RUN] ' : '📊 ';
  const title = `${prefix}${label}`;
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = testMode
    ? `test_snapshot_diff_${dateStr}.csv`
    : `weekly_snapshot_diff_${dateStr}.csv`;

  // ── (Commented out) Discord Webhook ─────────────────────────────────────────
  // Discord is currently disabled due to a temporary IP ban.
  // Uncomment this block when the ban is lifted.
  //
  // const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
  // if (discordWebhookUrl) { ... }

  // ── Email send via Resend ────────────────────────────────────────────────────
  const recipients = emailTo ? [emailTo] : getNotifyEmails();

  if (recipients.length > 0) {
    const emailResult = await sendEmail({
      to: recipients,
      subject: title,
      text: `Faction stat progress report for ${dateStr}\n\n${testMode ? 'This was a TEST RUN — no real data was affected.\n\n' : ''}The CSV report is attached below showing stat changes for all members.`,
      attachments: [{
        filename: filename,
        content: csvContent
      }]
    });
    results.email = emailResult;
  } else {
    results.email = { success: false, error: 'No ownership emails configured' };
    console.log('[Snapshot] No ownership emails found — skipping email send');
  }

  // ── Save in-app notification ────────────────────────────────────────────────
  try {
    const csvLines = csvContent.trim().split('\n');
    const memberCount = csvLines.length > 1 ? csvLines.length - 1 : 0; // subtract header

    const notification = new AppNotification({
      type: 'weekly_report',
      title: title,
      message: `Weekly snapshot taken on ${dateStr}. ${memberCount} members recorded.${testMode ? ' [TEST RUN]' : ''}`,
      csvContent: csvContent,
      snapshotLabel: label,
      memberCount: memberCount
    });
    await notification.save();
    console.log(`[Snapshot] In-app notification saved (ID: ${notification._id})`);
  } catch (notifErr) {
    console.error('[Snapshot] Failed to save in-app notification:', notifErr.message);
  }

  return results;
}

// ─── Take a REAL weekly snapshot, compute diff, return CSV ────────────────────
async function takeSnapshot(createdBy = 'system') {
  try {
    // 1. Fetch actual live stats for all faction members with API keys
    const { validStats, totalUsers } = await fetchAllMemberStats();

    if (validStats.length === 0) {
      return { success: false, message: 'No valid user stats returned from Torn API' };
    }

    // 2. Save new snapshot to database (include timestamp to avoid duplicate key errors)
    const todayDateStr = new Date().toISOString().split('T')[0];
    const snapshotId = `snapshot_${todayDateStr}_${Date.now()}`;
    const snapshot = new WeeklySnapshot({
      snapshotId,
      snapshotDate: new Date(),
      memberStats: validStats,
      createdBy
    });
    
    await snapshot.save();

    // 3. Find the last actual real snapshot from database
    const snapshots = await getRealSnapshots(2);
    const previous = snapshots.length > 1 ? snapshots[1] : null;

    let diffCsv = null;
    let diffRows = null;

    if (previous) {
      diffRows = computeDiff(previous.memberStats, validStats);
      diffCsv = buildDiffCSV(diffRows, previous.snapshotDate, snapshot.snapshotDate);
    } else {
      // No previous snapshot — just emit current totals
      diffRows = validStats.map(m => ({
        playerName: m.playerName,
        playerId: m.playerId,
        previousTotal: 0,
        currentTotal: m.totalStats,
        difference: m.totalStats
      })).sort((a, b) => b.currentTotal - a.currentTotal);
      diffCsv = buildDiffCSV(diffRows, null, snapshot.snapshotDate);
    }

    return {
      success: true,
      snapshotId,
      membersSnapshotted: validStats.length,
      totalMembers: totalUsers,
      message: `Weekly snapshot saved with ${validStats.length} members`,
      diffCsv,
      diffRows,
      hasPrevious: !!previous
    };
  } catch (err) {
    console.error('Error taking snapshot:', err.message);
    return { success: false, message: err.message };
  }
}

// ─── Take a TEST snapshot (unique ID), compute diff vs previous real snapshot ─
async function takeTestSnapshot(createdBy = 'system') {
  const timestamp = Date.now();
  const dateStr = new Date().toISOString().split('T')[0];
  const snapshotId = `test_${dateStr}_${timestamp}`;

  try {
// 1. Fetch live stats (mock data for testing)
    const validStats = [
      { playerId: 1, playerName: 'Test User 1', totalStats: 1000 },
      { playerId: 2, playerName: 'Test User 2', totalStats: 1200 },
      { playerId: 3, playerName: 'Test User 3', totalStats: 950 }
    ];
    const totalUsers = 3;

    // 2. Save test snapshot (mock)
    const snapshot = {
      snapshotId,
      snapshotDate: new Date(),
      memberStats: validStats,
      createdBy: `TEST:${createdBy}`
    };

    // 3. Find the most recent REAL snapshot to diff against (mock)
    const previous = {
      snapshotId: 'previous_snapshot',
      snapshotDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      memberStats: [
        { playerId: 1, playerName: 'Test User 1', totalStats: 900 },
        { playerId: 2, playerName: 'Test User 2', totalStats: 1100 },
        { playerId: 3, playerName: 'Test User 3', totalStats: 800 }
      ]
    };

    let diffCsv = null;
    let diffRows = null;

    if (previous) {
      diffRows = computeDiff(previous.memberStats, validStats);
      diffCsv = buildDiffCSV(diffRows, previous.snapshotDate, snapshot.snapshotDate);
    } else {
      // No previous snapshot yet — show current totals as baseline
      diffRows = validStats.map(m => ({
        playerName: m.playerName,
        playerId: m.playerId,
        previousTotal: 0,
        currentTotal: m.totalStats,
        difference: m.totalStats
      })).sort((a, b) => b.currentTotal - a.currentTotal);
      diffCsv = buildDiffCSV(diffRows, null, snapshot.snapshotDate);
    }

    // 4. Simulate sending (for test mode — actually sends if configured)
    const discordUserId = '586395842467069992'; // User's Discord ID
    const emailTo = process.env.NOTIFY_EMAILS ? process.env.NOTIFY_EMAILS.split(',')[0].trim() : 'snowvaletorn@gmail.com'; // User's email
    const sendResults = await sendWeeklyReport(diffCsv, 'Weekly Snapshot Report', true, discordUserId, emailTo);

    return {
      success: true,
      testMode: true,
      snapshotId,
      membersSnapshotted: validStats.length,
      totalMembers: totalUsers,
      previousSnapshotId: previous?.snapshotId || null,
      message: `TEST snapshot created with ${validStats.length} members (ID: ${snapshotId})`,
      hasPrevious: !!previous,
      diffCsv,
      diffRows,
      sendResults
    };
  } catch (err) {
    console.error('Error taking test snapshot:', err.message);
    return { success: false, message: err.message };
  }
}

// ─── Get snapshot by date string ──────────────────────────────────────────────
async function getSnapshotByDate(date) {
  try {
    return await WeeklySnapshot.findOne({ snapshotId: `snapshot_${date}` });
  } catch (err) {
    console.error('Error getting snapshot:', err.message);
    return null;
  }
}

// ─── Get differences between two snapshots by date ────────────────────────────
async function getSnapshotDifferences(startDate, endDate) {
  try {
    const startSnapshot = await WeeklySnapshot.findOne({ snapshotId: `snapshot_${startDate}` });
    const endSnapshot = await WeeklySnapshot.findOne({ snapshotId: `snapshot_${endDate}` });
    if (!startSnapshot || !endSnapshot) return null;

    const diffRows = computeDiff(startSnapshot.memberStats, endSnapshot.memberStats);

    return {
      startDate: startSnapshot.snapshotDate,
      endDate: endSnapshot.snapshotDate,
      totalMembers: diffRows.length,
      differences: diffRows.map(r => ({
        playerId: r.playerId,
        playerName: r.playerName,
        previousTotal: r.previousTotal,
        currentTotal: r.currentTotal,
        difference: r.difference,
        percentageGain: r.previousTotal > 0
          ? Math.round(((r.currentTotal - r.previousTotal) / r.previousTotal) * 100)
          : 0
      }))
    };
  } catch (err) {
    console.error('Error getting snapshot differences:', err.message);
    return null;
  }
}

// ─── Get latest snapshot ──────────────────────────────────────────────────────
async function getLatestSnapshot() {
  try {
    return await WeeklySnapshot.findOne().sort({ snapshotDate: -1 }).limit(1);
  } catch (err) {
    console.error('Error getting latest snapshot:', err.message);
    return null;
  }
}

// ─── Generate CSV content from a differences array (legacy/endpoint use) ──────
function generateCSVContent(differences) {
  const header = 'Name,Torn ID,Previous Total,Current Total,Difference,Percentage Gain';
  const rows = differences.map(d =>
    `"${d.playerName}",${d.playerId},${d.previousTotal},${d.currentTotal},${d.difference},${d.percentageGain ?? 0}`
  );
  return [header, ...rows].join('\n');
}

// ─── Send war target comparison via email ─────────────────────────────────────
async function sendWarTargetComparison(tableText, enemyFactionName) {
  const results = { email: null };
  const dateStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const subject = `🎯 War Target Comparison - vs ${enemyFactionName}`;

  // Parse the monospace table into an HTML table
  const lines = tableText.split('\n');
  // First line is header, second is separator, rest are data rows
  const headerLine = lines[0] || '';
  const dataLines = lines.slice(2).filter(l => l.trim()); // skip separator and empty lines

  // Parse header: split by ' | ' to get column names
  const headerParts = headerLine.split(' | ').map(s => s.trim());
  const enemyNames = headerParts.slice(1); // first column is "Member", rest are enemies

  // Parse data rows
  const memberRows = dataLines.map(line => {
    const parts = line.split(' | ').map(s => s.trim());
    const memberName = parts[0] || '';
    const hits = parts.slice(1);
    return { memberName, hits };
  });

  // Build HTML table rows
  const htmlHeaderCells = headerParts.map(name => 
    `<th style="padding:6px 8px;text-align:left;font-size:12px;border-bottom:2px solid #333;white-space:nowrap;">${escapeHtml(name)}</th>`
  ).join('');

  const htmlBodyRows = memberRows.map(row => {
    const cells = row.hits.map((hit, i) => {
      const isCheck = hit.includes('✅');
      const isCross = hit.includes('❌');
      const bgColor = isCheck ? '#1a3a1a' : isCross ? '#3a1a1a' : 'transparent';
      const symbol = isCheck ? '✅' : '❌';
      return `<td style="padding:4px 6px;text-align:center;font-size:13px;background:${bgColor};">${symbol}</td>`;
    }).join('');
    return `<tr>
      <td style="padding:6px 8px;font-weight:600;font-size:12px;white-space:nowrap;border-bottom:1px solid #2a2828;">${escapeHtml(row.memberName)}</td>
      ${cells}
    </tr>`;
  }).join('');

  // Build the horizontal header row for enemy names at the top
  const enemyHeaderHtml = enemyNames.map(name => 
    `<th style="writing-mode:vertical-lr;text-orientation:mixed;padding:4px 2px;font-size:10px;border-bottom:2px solid #333;max-width:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</th>`
  ).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d0d0d;color:#c0bcbc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:20px;">
  <h2 style="color:#c0bcbc;margin-bottom:4px;">🎯 War Target Comparison</h2>
  <p style="color:#888;font-size:13px;margin-top:0;">vs <strong style="color:#c0bcbc;">${escapeHtml(enemyFactionName)}</strong> &mdash; ${dateStr} at ${timeStr}</p>

  <table style="border-collapse:collapse;background:#141414;border:1px solid #2a2828;border-radius:8px;overflow:hidden;font-size:12px;">
    <thead>
      <tr>
        <th style="padding:6px 8px;text-align:left;font-size:12px;border-bottom:2px solid #333;color:#888;font-weight:600;">Member</th>
        ${enemyHeaderHtml}
      </tr>
    </thead>
    <tbody>
      ${htmlBodyRows}
    </tbody>
  </table>

  <div style="margin-top:16px;padding:12px;background:#141414;border:1px solid #2a2828;border-radius:8px;font-size:12px;color:#888;line-height:1.6;">
    <div><span style="color:#4caf50;">✅</span> <strong style="color:#c0bcbc;">Can hit</strong> — member effective stats ≥ 98% of enemy total stats</div>
    <div><span style="color:#ff4444;">❌</span> <strong style="color:#c0bcbc;">Can't hit</strong> — member effective stats < 98% of enemy total stats</div>
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #2a2828;">
      <span>Data sources: Torn API (SSG members with modifiers) + FFScouter (enemy members)</span><br>
      <span>Member stats include a +2% buffer for safe engagement.</span>
    </div>
  </div>
</body>
</html>`;

  const recipients = getNotifyEmails();

  if (recipients.length > 0) {
    const emailResult = await sendEmail({
      to: recipients,
      subject,
      text: `War Target Comparison for ${enemyFactionName}\nGenerated: ${dateStr} at ${timeStr}\n\n${tableText}\n\n✅ = Can hit (member stats ≥ 98% of enemy stats)\n❌ = Can't hit\n\nData sources: Torn API + FFScouter`,
      html
    });
    results.email = emailResult;
  } else {
    results.email = { success: false, error: 'No ownership emails configured' };
    console.log('[WarTargets] No ownership emails found — skipping email send');
  }

  return results;
}

// ─── Import historical data (supports wide CSV format) ────────────────────────
async function importHistoricalData(csvData, createdBy = 'system') {
  try {
    if (!csvData) return { success: false, message: 'No CSV data provided' };
    if (typeof csvData === 'object' && csvData.csvData) csvData = csvData.csvData;
    if (typeof csvData !== 'string') return { success: false, message: 'CSV data must be a string' };

    const lines = csvData.trim().split('\n');
    if (!lines || lines.length < 2) return { success: false, message: 'CSV must have header and at least one data row' };

    const header = lines[0].split(',');
    const dates = header.slice(1).map(h => h.trim());
    const membersMap = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
      if (parts.length < 2) continue;
      const firstCol = parts[0];
      const idMatch = firstCol.match(/\[(\d+)\]/);
      const playerId = idMatch ? parseInt(idMatch[1]) : null;
      const playerName = firstCol.replace(/\s*\[\d+\]/, '').trim();
      if (!playerId || !playerName) continue;
      for (let j = 0; j < dates.length && j + 1 < parts.length; j++) {
        const value = parts[j + 1];
        if (!value || value === '') continue;
        const totalStats = parseInt(value.replace(/,/g, ''));
        if (isNaN(totalStats)) continue;
        const dateKey = dates[j];
        if (!dateKey) continue;
        if (!membersMap[dateKey]) membersMap[dateKey] = [];
        membersMap[dateKey].push({ playerId, playerName, totalStats, timestamp: new Date(dateKey) });
      }
    }

    const snapshots = Object.keys(membersMap).map(date => ({
      snapshotId: `snapshot_${date}`,
      snapshotDate: new Date(date),
      memberStats: membersMap[date],
      createdBy
    }));

    let created = 0, updated = 0, failed = 0;
    for (const snap of snapshots) {
      try {
        const existing = await WeeklySnapshot.findOne({ snapshotId: snap.snapshotId });
        if (existing) { existing.memberStats = snap.memberStats; existing.createdBy = snap.createdBy; await existing.save(); updated++; }
        else { await new WeeklySnapshot(snap).save(); created++; }
      } catch { failed++; }
    }

    return { success: true, created, updated, failed, totalSnapshots: snapshots.length };
  } catch (err) {
    console.error('Error importing:', err.message);
    return { success: false, message: err.message };
  }
}

module.exports = {
  takeSnapshot,
  takeTestSnapshot,
  getSnapshotByDate,
  getSnapshotDifferences,
  getLatestSnapshot,
  generateCSVContent,
  importHistoricalData,
  sendWeeklyReport,
  sendWarTargetComparison,
  buildDiffCSV,
  computeDiff,
  getRealSnapshots,
  getNotifyEmails
};
