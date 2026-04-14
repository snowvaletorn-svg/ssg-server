// Snapshot Service - handles weekly stats snapshot functionality
const WeeklySnapshot = require('../models/WeeklySnapshot');
const User = require('../models/User');
const axios = require('axios');

// Helper function to get faction API key
async function getFactionApiKey() {
  try {
    const FactionConfig = require('../models/FactionConfig');
    const config = await FactionConfig.findOne({ key: 'config' });
    if (config?.tornFactionApiKey) return config.tornFactionApiKey;
  } catch (err) {
    console.error('Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY || null;
}

// Take a snapshot of all faction members' total stats
async function takeSnapshot(createdBy = 'system') {
  try {
    // Get all faction members with API keys
    const dbUsers = await User.find({ tornApiKey: { $ne: null } }, 'tornPlayerId tornName tornApiKey');

    // Fetch stats for all members in parallel
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

    const validStats = results.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value);

    // Create snapshot
    const snapshot = new WeeklySnapshot({
      snapshotId: `snapshot_${new Date().toISOString().split('T')[0]}`,
      snapshotDate: new Date(),
      memberStats: validStats,
      createdBy: createdBy
    });

    await snapshot.save();

    return {
      success: true,
      snapshotId: snapshot.snapshotId,
      membersSnapshotted: validStats.length,
      totalMembers: dbUsers.length,
      message: `Weekly snapshot created successfully with ${validStats.length} members`
    };
  } catch (err) {
    console.error('Error taking snapshot:', err.message);
    return { success: false, message: err.message };
  }
}

// Get snapshot by date
async function getSnapshotByDate(date) {
  try {
    const snapshot = await WeeklySnapshot.findOne({ snapshotId: `snapshot_${date}` });
    return snapshot;
  } catch (err) {
    console.error('Error getting snapshot:', err.message);
    return null;
  }
}

// Get differences between two snapshots
async function getSnapshotDifferences(startDate, endDate) {
  try {
    const startSnapshot = await WeeklySnapshot.findOne({ snapshotId: `snapshot_${startDate}` });
    const endSnapshot = await WeeklySnapshot.findOne({ snapshotId: `snapshot_${endDate}` });

    if (!startSnapshot || !endSnapshot) {
      return null;
    }

    // Create a map of end snapshot members for quick lookup
    const endMap = {};
    endSnapshot.memberStats.forEach(member => {
      endMap[member.playerId] = member;
    });

    // Calculate differences
    const differences = startSnapshot.memberStats.map(startMember => {
      const endMember = endMap[startMember.playerId];
      return {
        playerId: startMember.playerId,
        playerName: startMember.playerName,
        previousTotal: startMember.totalStats,
        currentTotal: endMember ? endMember.totalStats : startMember.totalStats,
        difference: endMember ? endMember.totalStats - startMember.totalStats : 0,
        percentageGain: endMember ? 
          Math.round(((endMember.totalStats - startMember.totalStats) / startMember.totalStats) * 100) : 0
      };
    });

    // Sort by difference (highest first)
    differences.sort((a, b) => b.difference - a.difference);

    return {
      startDate: startSnapshot.snapshotDate,
      endDate: endSnapshot.snapshotDate,
      totalMembers: differences.length,
      differences
    };
  } catch (err) {
    console.error('Error getting snapshot differences:', err.message);
    return null;
  }
}

// Get latest snapshot
async function getLatestSnapshot() {
  try {
    const latestSnapshot = await WeeklySnapshot.findOne()
      .sort({ snapshotDate: -1 })
      .limit(1);
    return latestSnapshot;
  } catch (err) {
    console.error('Error getting latest snapshot:', err.message);
    return null;
  }
}

// Generate CSV content from differences
function generateCSVContent(differences) {
  const header = 'Player ID,Player Name,Previous Total,Current Total,Difference,Percentage Gain';
  const rows = differences.map(d => 
    `${d.playerId},${d.playerName},${d.previousTotal},${d.currentTotal},${d.difference},${d.percentageGain}`
  );
  return [header, ...rows].join('\n');
}

// Import historical data (supports wide CSV format from export)
async function importHistoricalData(csvData, createdBy = 'system') {
  try {
    // Handle undefined/null
    if (!csvData) {
      return { success: false, message: 'No CSV data provided' };
    }

    // Handle object with csvData property
    if (typeof csvData === 'object' && csvData.csvData) {
      csvData = csvData.csvData;
    }

    // Ensure it's a string
    if (typeof csvData !== 'string') {
      return { success: false, message: 'CSV data must be a string' };
    }

    const lines = csvData.trim().split('\n');
    
    if (!lines || lines.length < 2) {
      return { success: false, message: 'CSV must have header and at least one data row' };
    }

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
        if (existing) {
          existing.memberStats = snap.memberStats;
          existing.createdBy = snap.createdBy;
          await existing.save();
          updated++;
        } else {
          await new WeeklySnapshot(snap).save();
          created++;
        }
      } catch (err) { failed++; }
    }

    return { success: true, created, updated, failed, totalSnapshots: snapshots.length };
  } catch (err) {
    console.error('Error importing:', err.message);
    return { success: false, message: err.message };
  }
}

module.exports = {
  takeSnapshot,
  getSnapshotByDate,
  getSnapshotDifferences,
  getLatestSnapshot,
  generateCSVContent,
  importHistoricalData
};