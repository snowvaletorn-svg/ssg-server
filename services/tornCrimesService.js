const axios = require('axios');
const OrganizedCrime = require('../models/OrganizedCrime');
const { decryptOrRaw } = require('./keyCipher');

// Helper function to get faction API key (decrypted at point of use)
async function getFactionApiKey() {
  try {
    const FactionConfig = require('../models/FactionConfig');
    const config = await FactionConfig.findOne({ key: 'config' });
    if (config?.tornFactionApiKey) return decryptOrRaw(config.tornFactionApiKey);
  } catch (err) {
    console.error('Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY || null;
}

// Static tool requirements based on role names
const ROLE_TOOLS = {
  'Picklock': 'Picklocks',
  'Imitator': 'Police Badge',
  'Muscle': 'Net',
  'Kidnapper': 'Dog Treats',
  'Thief #1': 'ID Badge',
  'Thief #2': 'ATM Key',
  'Looter #1': 'Jemmy',
  'Looter #3': 'Jemmy'
};

// Transform API response (v2 format) to our database schema
function transformCrimeData(apiCrime, factionId = 53272) {
  const participants = [];
  
  // v2 API returns slots instead of participants
  // Each slot has a position, optional user, checkpoint_pass_rate, and item_requirement
  if (apiCrime.slots && Array.isArray(apiCrime.slots)) {
    apiCrime.slots.forEach(slot => {
      // Get item/tool info for this position - use static mapping first, then API data
      let toolName = 'N/A';
      let toolId = null;
      let toolAvailable = null;

      // The v2 API provides the EXACT item ID required for this position (item_requirement.id)
      // and whether that item has been checked in / is available for this slot
      // (item_requirement.is_available). These are authoritative signals for the OC item
      // question — different crimes reuse the same-named position (e.g. "Picklock") with
      // different specific items, so we cannot rely on name matching alone. Capture both
      // here and persist them on the participant.
      if (slot.item_requirement && slot.item_requirement.id) {
        toolId = parseInt(slot.item_requirement.id);
      }
      if (slot.item_requirement) {
        toolAvailable = slot.item_requirement.is_available === true;
      }

      // Check if role has a static tool requirement (used only for the display name,
      // since the v2 API's item_requirement does not include a name)
      if (slot.position && ROLE_TOOLS[slot.position]) {
        toolName = ROLE_TOOLS[slot.position];
      }
      
      // Only add participants for slots that have a user assigned
      if (slot.user && slot.user.id) {
        // Build full role name with number for positions that have multiples
        // The API returns position as "Thief" or "Looter" and we need to append #1, #2, etc.
        let fullRoleName = slot.position || '';
        const posNumber = slot.position_number;
        
        // For Thief and Looter positions, always append the number
        if ((slot.position === 'Thief' || slot.position === 'Looter') && posNumber) {
          fullRoleName = `${slot.position} #${posNumber}`;
        }
        
        // Get tool name - check both the base position and the full role name
        if (toolName === 'N/A') {
          // Try with the full role name including number
          if (ROLE_TOOLS[fullRoleName]) {
            toolName = ROLE_TOOLS[fullRoleName];
          }
        }
        
        const passRate = typeof slot.checkpoint_pass_rate === 'number' ? slot.checkpoint_pass_rate : null;
        participants.push({
          playerId: slot.user.id,
          playerName: '', // Will be enriched later from faction members
          role: fullRoleName, // The full position name (e.g., "Thief #1", "Looter #3")
          tool: toolName, // Tool/item required for this position (display name)
          toolId: toolId, // Exact item ID required for this position (authoritative for inventory checks)
          toolAvailable: toolAvailable, // Whether the item is checked in/available for this slot
          status: {
            color: 'blue', // Default color
            description: '',
            details: '',
            state: 'Okay',
            until: null
          },
          checkpointPassRate: passRate, // From API (auto-populated); 0 is a real rate, not "missing"
          checkpointStatus: passRate === null ? 'pending' : (passRate >= 50 ? 'passed' : 'failed')
        });
      }
    });
  }

  // Map v2 API fields to our schema
  // Determine status based on API v2 status field
  // Note: API v2 returns "Recruiting", "Planning", "Ready", "Executing", "Succeeded", "Failed", "Expired"
  const apiStatus = apiCrime.status?.toLowerCase() || '';
  let status = 'pending';
  let success = null;
  
  if (apiStatus === 'succeeded' || apiStatus === 'successful') {
    status = 'succeeded';
    success = true;
  } else if (apiStatus === 'failed') {
    status = 'failed';
    success = false;
  } else if (apiStatus === 'expired') {
    // "Expired" crimes are ones that timed out (intentionally or not)
    status = 'expired';
    success = false;
  } else if (apiStatus === 'executing') {
    // "Executing" means the crime is currently in progress
    status = 'pending';
    success = null;
  }
  
  // Check if crime has expired but API still shows it as pending
  // This handles cases where the API status hasn't updated but the crime has expired
  if (status === 'pending' && apiCrime.expired_at) {
    const expiredTime = apiCrime.expired_at * 1000;
    if (Date.now() > expiredTime) {
      status = 'expired';
      success = false;
    }
  }
  
  // If crime has a completion time but status is still pending, mark as failed
  // This handles cases where the crime was completed but failed
  if (status === 'pending' && apiCrime.executed_at) {
    status = 'failed';
    success = false;
  }
  
  // Calculate time left if not yet executed
  let timeLeft = 0;
  if (!apiCrime.executed_at && apiCrime.ready_at) {
    const readyTime = apiCrime.ready_at * 1000;
    const now = Date.now();
    timeLeft = Math.max(0, Math.floor((readyTime - now) / 1000));
  }

  return {
    crimeId: apiCrime.id,
    crimeName: apiCrime.name,
    factionId: factionId,
    initiated: apiCrime.executed_at !== null,
    success: success,
    status: status,
    timeStarted: apiCrime.created_at ? new Date(apiCrime.created_at * 1000) : null,
    timeReady: apiCrime.ready_at ? new Date(apiCrime.ready_at * 1000) : null,
    timeCompleted: apiCrime.executed_at ? new Date(apiCrime.executed_at * 1000) : null,
    timeLeft: timeLeft,
    moneyGain: apiCrime.money_gain || 0,
    respectGain: apiCrime.respect_gain || 0,
    initiatedBy: apiCrime.initiated_by || null,
    plannedBy: apiCrime.planned_by || null,
    participants: participants,
    isComplete: success !== null,
    lastFetchedAt: new Date()
  };
}

// Enrich participant data with names and roles from faction members
async function enrichParticipantsWithFactionData(crimeData) {
  try {
    const factionApiKey = await getFactionApiKey();
    if (!factionApiKey) {
      console.warn('No faction API key available for enriching participant data');
      return crimeData;
    }

    const factionRes = await axios.get(
      `https://api.torn.com/v2/faction/?selections=members&key=${factionApiKey}`
    );
    
    const factionMembers = factionRes.data.members || {};
    const memberMap = {};
    
    // Create a map of member ID to member data
    Object.values(factionMembers).forEach(member => {
      memberMap[member.id] = {
        name: member.name,
        position: member.position
      };
    });

    // Enrich participants with names (role is already set from slot position)
    crimeData.participants = crimeData.participants.map(participant => {
      const memberData = memberMap[participant.playerId];
      if (memberData) {
        participant.playerName = memberData.name;
        // Keep the OC role from the slot, but could also store faction position separately if needed
      }
      return participant;
    });

    return crimeData;
  } catch (err) {
    console.error('Error enriching participant data:', err.message);
    return crimeData;
  }
}

// Fetch crimes from Torn API
async function fetchFactionCrimes(startDate = null) {
  const factionApiKey = await getFactionApiKey();
  if (!factionApiKey) {
    throw new Error('No faction API key configured');
  }

  try {
    // Build query parameters
    const params = new URLSearchParams();
    params.append('selections', 'crimes');
    params.append('key', factionApiKey);
    
    // Only fetch incomplete crimes to minimize API calls
    // The API returns 100 most recent crimes by default
    if (startDate) {
      params.append('from', Math.floor(startDate.getTime() / 1000));
    }

    const response = await axios.get(
      `https://api.torn.com/v2/faction/?${params.toString()}`
    );

    if (response.data.error) {
      throw new Error(response.data.error.error);
    }

    // The API returns crimes as an array, convert to object keyed by crime_id
    const crimesArray = response.data.crimes || [];
    const crimesObject = {};
    
    crimesArray.forEach(crime => {
      // v2 API uses 'id' instead of 'crime_id'
      if (crime.id !== undefined) {
        crimesObject[crime.id] = crime;
      }
    });
    
    return crimesObject;
  } catch (err) {
    console.error('Error fetching faction crimes:', err.message);
    throw err;
  }
}

// ---- Canonical OC definitions + item catalog (read-time enrichment) ------------
// The v2 faction crimes payload doesn't say how long a crime takes to prepare,
// how many slots it needs, or what it can pay. The public torn/organisedcrimes
// selection has that canonical data, so we attach it at read time (definitions
// change rarely; cached in memory for 24h).
const DEFINITIONS_CACHE_MS = 24 * 60 * 60 * 1000;
const ITEM_MAP_CACHE_MS = 24 * 60 * 60 * 1000;
let _definitionsCache = { data: null, fetchedAt: 0 };
let _itemNameCache = { data: null, fetchedAt: 0 };

async function fetchCrimeDefinitions() {
  const now = Date.now();
  if (_definitionsCache.data && now - _definitionsCache.fetchedAt < DEFINITIONS_CACHE_MS) {
    return _definitionsCache.data;
  }
  const key = await getFactionApiKey();
  if (!key) return _definitionsCache.data || null;
  try {
    const res = await axios.get(
      `https://api.torn.com/torn/?selections=organisedcrimes&key=${encodeURIComponent(key)}`
    );
    if (res.data.error) throw new Error(res.data.error.error);
    const defs = res.data.organisedcrimes || {};
    _definitionsCache = { data: defs, fetchedAt: now };
    return defs;
  } catch (err) {
    console.error('Error fetching organised crime definitions:', err.message);
    return _definitionsCache.data || null; // stale-if-error
  }
}

// Pure: index definitions by lowercased crime name for lookup.
function indexDefinitionsByName(defs) {
  const byName = {};
  Object.values(defs || {}).forEach(def => {
    if (def && def.name) byName[def.name.toLowerCase()] = def;
  });
  return byName;
}

// Pure: attach canonical definition info to a plain crime object (matched by name).
function applyDefinition(crime, defsByName) {
  const def = defsByName[(crime.crimeName || '').toLowerCase()];
  if (!def) return crime;
  crime.definition = {
    timeHours: def.time ?? null,
    members: def.members ?? null,
    minCash: def.min_cash ?? null,
    maxCash: def.max_cash ?? null,
    minRespect: def.min_respect ?? null,
    maxRespect: def.max_respect ?? null
  };
  return crime;
}

// The v2 API gives tool requirements as bare item IDs. Resolve display names
// from the torn/items catalog (public selection, cached for 24h).
async function fetchItemNameMap() {
  const now = Date.now();
  if (_itemNameCache.data && now - _itemNameCache.fetchedAt < ITEM_MAP_CACHE_MS) {
    return _itemNameCache.data;
  }
  const key = await getFactionApiKey();
  if (!key) return _itemNameCache.data || null;
  try {
    const res = await axios.get(
      `https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(key)}`
    );
    if (res.data.error) throw new Error(res.data.error.error);
    const map = buildItemNameMap(res.data.items);
    _itemNameCache = { data: map, fetchedAt: now };
    return map;
  } catch (err) {
    console.error('Error fetching item catalog for OC tool names:', err.message);
    return _itemNameCache.data || null; // stale-if-error
  }
}

// Pure: { '<itemId>': 'Item Name' } from a torn/items response body.
function buildItemNameMap(items) {
  const map = {};
  Object.entries(items || {}).forEach(([id, item]) => {
    if (item && item.name) map[String(id)] = item.name;
  });
  return map;
}

// Pure: fill in participant tool names from exact item IDs when known.
// Slots with no item requirement show 'None' instead of the old 'N/A'.
// (Display-only — the DB keeps 'N/A' so My Day's `tool !== 'N/A'` gate keeps
// working; use resolveToolNamesForStorage for writes.)
function resolveToolNames(participants, itemNameMap) {
  (participants || []).forEach(p => {
    if (p.toolId != null) {
      const itemName = itemNameMap && itemNameMap[String(p.toolId)];
      if (itemName) p.tool = itemName;
    } else if (!p.tool || p.tool === 'N/A') {
      p.tool = 'None';
    }
  });
  return participants;
}

// Pure: persist-time variant of resolveToolNames. Overwrites the static
// ROLE_TOOLS guess with the exact catalog name when the item ID is known,
// but keeps 'N/A' for slots without an item requirement — My Day and the
// utilities loan view gate on that exact stored value.
function resolveToolNamesForStorage(participants, itemNameMap) {
  (participants || []).forEach(p => {
    if (p.toolId != null) {
      const itemName = itemNameMap && itemNameMap[String(p.toolId)];
      if (itemName) p.tool = itemName;
    }
  });
  return participants;
}

// Read-time enrichment: canonical definition + accurate tool names + stats.
async function enrichCrimesWithMetadata(crimes) {
  const [defs, itemNameMap] = await Promise.all([
    fetchCrimeDefinitions(),
    fetchItemNameMap()
  ]);
  const defsByName = indexDefinitionsByName(defs);

  return crimes.map(crime => {
    const obj = crime.toObject ? crime.toObject() : { ...crime };
    resolveToolNames(obj.participants, itemNameMap);
    applyDefinition(obj, defsByName);
    const avgPassRate = OrganizedCrime.calculateAveragePassRate(obj.participants);
    return {
      ...obj,
      averagePassRate: avgPassRate,
      participantCount: obj.participants.length
    };
  });
}

// Update or create crimes in database
async function updateCrimesInDatabase(apiCrimes, factionId = 53272) {
  const results = {
    updated: 0,
    created: 0,
    errors: []
  };

  // Resolve exact tool names from the item catalog once per refresh
  // (24h-cached). Falls back to the static ROLE_TOOLS names on failure.
  const itemNameMap = await fetchItemNameMap();

  for (const [crimeId, apiCrime] of Object.entries(apiCrimes)) {
    try {
      const crimeData = transformCrimeData(apiCrime, factionId);
      // Persist catalog-exact tool names so every consumer (My Day,
      // utilities loans, OC page) reads accurate names from the DB.
      resolveToolNamesForStorage(crimeData.participants, itemNameMap);
      const enrichedData = await enrichParticipantsWithFactionData(crimeData);

      // Check if crime already exists
      const existingCrime = await OrganizedCrime.findOne({ crimeId: parseInt(crimeId) });

      if (existingCrime) {
        // Update existing crime
        await OrganizedCrime.updateOne(
          { crimeId: parseInt(crimeId) },
          { $set: enrichedData }
        );
        results.updated++;
      } else {
        // Create new crime
        await OrganizedCrime.create(enrichedData);
        results.created++;
      }
    } catch (err) {
      console.error(`Error processing crime ${crimeId}:`, err.message);
      results.errors.push({ crimeId, error: err.message });
    }
  }

  return results;
}

// Main function to refresh crimes
async function refreshFactionCrimes(startDate = null) {
  try {
    console.log('Fetching faction crimes from Torn API...');
    const apiCrimes = await fetchFactionCrimes(startDate);
    
    console.log(`Fetched ${Object.keys(apiCrimes).length} crimes from API`);
    
    const results = await updateCrimesInDatabase(apiCrimes);
    
    console.log('Refresh completed:', results);
    return {
      success: true,
      message: `Refreshed ${results.created} new crimes and updated ${results.updated} existing crimes`,
      results
    };
  } catch (err) {
    console.error('Error refreshing faction crimes:', err.message);
    return {
      success: false,
      message: err.message,
      results: { updated: 0, created: 0, errors: [err.message] }
    };
  }
}

// Get crimes with filtering and sorting
async function getCrimesForFaction(factionId, filters = {}) {
  try {
    const crimes = await OrganizedCrime.getCrimesForFaction(factionId, filters);

    // Enrich with canonical OC definitions, exact tool names, and pass-rate stats
    return await enrichCrimesWithMetadata(crimes);
  } catch (err) {
    console.error('Error getting crimes for faction:', err.message);
    throw err;
  }
}

// Get crime details with participant information
async function getCrimeDetails(crimeId) {
  try {
    const crime = await OrganizedCrime.findOne({ crimeId });
    if (!crime) {
      throw new Error('Crime not found');
    }

    const [enriched] = await enrichCrimesWithMetadata([crime]);
    return enriched;
  } catch (err) {
    console.error('Error getting crime details:', err.message);
    throw err;
  }
}

// Update checkpoint pass rates for a crime
async function updateCheckpointRates(crimeId, participantRates) {
  try {
    const crime = await OrganizedCrime.findOne({ crimeId });
    if (!crime) {
      throw new Error('Crime not found');
    }

    // Update checkpoint rates for participants
    crime.participants = crime.participants.map(participant => {
      const newRate = participantRates[participant.playerId];
      if (newRate !== undefined) {
        participant.checkpointPassRate = newRate;
        participant.checkpointStatus = newRate >= 50 ? 'passed' : 'failed';
      }
      return participant;
    });

    await crime.save();
    
    return {
      success: true,
      message: 'Checkpoint rates updated successfully',
      crimeId: crimeId
    };
  } catch (err) {
    console.error('Error updating checkpoint rates:', err.message);
    throw err;
  }
}

// Get participant history
async function getParticipantHistory(playerId, factionId) {
  try {
    const crimes = await OrganizedCrime.find({
      factionId: factionId,
      'participants.playerId': playerId
    }).sort({ timeStarted: -1 });

    const participantHistory = crimes.map(crime => {
      const participant = crime.participants.find(p => p.playerId === playerId);
      return {
        crimeId: crime.crimeId,
        crimeName: crime.crimeName,
        timeStarted: crime.timeStarted,
        timeCompleted: crime.timeCompleted,
        status: crime.status,
        success: crime.success,
        checkpointPassRate: participant?.checkpointPassRate || null,
        checkpointStatus: participant?.checkpointStatus || 'pending',
        moneyGain: crime.moneyGain,
        respectGain: crime.respectGain
      };
    });

    // Calculate statistics
    const totalCrimes = participantHistory.length;
    const completedCrimes = participantHistory.filter(c => c.checkpointPassRate !== null).length;
    const passedCrimes = participantHistory.filter(c => c.checkpointStatus === 'passed').length;
    const failedCrimes = participantHistory.filter(c => c.checkpointStatus === 'failed').length;
    
    const avgPassRate = completedCrimes > 0 
      ? Math.round(participantHistory
          .filter(c => c.checkpointPassRate !== null)
          .reduce((sum, c) => sum + c.checkpointPassRate, 0) / completedCrimes)
      : 0;

    return {
      playerId: playerId,
      history: participantHistory,
      statistics: {
        totalCrimes,
        completedCrimes,
        passedCrimes,
        failedCrimes,
        completionRate: totalCrimes > 0 ? Math.round((completedCrimes / totalCrimes) * 100) : 0,
        successRate: completedCrimes > 0 ? Math.round((passedCrimes / completedCrimes) * 100) : 0,
        averagePassRate: avgPassRate
      }
    };
  } catch (err) {
    console.error('Error getting participant history:', err.message);
    throw err;
  }
}

module.exports = {
  refreshFactionCrimes,
  getCrimesForFaction,
  getCrimeDetails,
  updateCheckpointRates,
  getParticipantHistory,
  getFactionApiKey,
  // Pure helpers exported for unit tests
  transformCrimeData,
  buildItemNameMap,
  resolveToolNames,
  resolveToolNamesForStorage,
  indexDefinitionsByName,
  applyDefinition
};