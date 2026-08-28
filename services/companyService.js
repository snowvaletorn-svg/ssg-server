const axios = require('axios');
const Company = require('../models/Company');
const User = require('../models/User');
const AppNotification = require('../models/AppNotification');

// Helper to get faction API key
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

// Verify a director is in the faction
async function verifyDirectorInFaction(directorPlayerId) {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return { valid: false, error: 'No faction API key configured' };

    const res = await axios.get(
      `https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`
    );
    const members = res.data.members || [];
    const member = members.find(m => m.id === parseInt(directorPlayerId));
    return { valid: !!member, member: member || null };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// Company type ID to name mapping (from Torn API)
const COMPANY_TYPES = {
  1 : "Hair Salon",
2 : "Law Firm",
3 : "Flower Shop",
4 : "Car Dealership",
5 : "Clothing Store",
6 : "Gun Shop",
7 : "Game Shop",
8 : "Candle Shop",
9 : "Toy Shop",
10 : "Adult Novelties",
11 : "Cyber Cafe",
12 : "Grocery Store",
13 : "Theater",
14 : "Sweet Shop",
15 : "Cruise Line",
16 : "Television Network",
17 : null, //???
18 : "Zoo",
19 : "Firework Stand",
20 : "Property Broker",
21 : "Furniture Store",
22 : "Gas Station",
23 : "Music Store",
24 : "Nightclub",
25 : "Pub",
26 : "Gents Strip Club",
27 : "Restaurant",
28 : "Oil Rig",
29 : "Fitness Center",
30 : "Mechanic Shop",
31 : "Amusement Park",
32 : "Lingerie Store",
33 : "Meat Warehouse",
34 : "Farm",
35 : "Software Corp",
36 : "Ladies Strip Club",
37 : "Private Security Firm",
38 : "Mining Corporation",
39 : "Detective Agency",
40 : "Logistics Management"
};

function getCompanyTypeName(typeId) {
  const id = parseInt(typeId);
  return COMPANY_TYPES[id] || `Type ${typeId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Position stat requirements + employee efficiency (Torn Stats style matrix)
// ─────────────────────────────────────────────────────────────────────────────

// In-memory cache for the static /torn/…?selections=companies payload.
// Torn's company-type definitions only change on game updates, so re-fetching
// at most once per day per director is plenty and avoids redundant API calls.
const companyTypesCache = new Map();   // directorApiKey -> { fetchedAt, payload }
const COMPANY_TYPES_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch the full torn `companies` payload (all company types + their
 * positions and stat requirements). Cached per API key.
 * NOTE: the selection is `companies` (there is no `companytypes` selection —
 * requesting it returns API error 4 "Wrong fields").
 * @param {string} directorApiKey Director's Full/Limited access Torn API key.
 * @returns {Promise<object|null>} The `companies` object or null on failure.
 */
async function fetchCompanyTypesPayload(directorApiKey) {
  if (!directorApiKey) return null;

  const cached = companyTypesCache.get(directorApiKey);
  if (cached && Date.now() < cached.fetchedAt + COMPANY_TYPES_TTL) {
    return cached.payload;
  }

  try {
    const res = await axios.get(
      `https://api.torn.com/torn/?selections=companies&key=${encodeURIComponent(directorApiKey)}`
    );
    if (res.data.error) throw new Error(res.data.error.error);
    const payload = res.data.companies || null;
    companyTypesCache.set(directorApiKey, { fetchedAt: Date.now(), payload });
    return payload;
  } catch (err) {
    console.error('Error fetching companies (company types) from Torn API:', err.message);
    return null;
  }
}

/**
 * Get the normalized list of positions + stat requirements for a company type.
 * Source: GET /torn/?selections=companies — positions are keyed by NAME and
 * expose `man_required`, `int_required`, `end_required` (plus `*_gain` daily
 * gains) and `special_ability` (the literal string "None" when absent).
 * Each normalized position: { id, name, specialAbility, intelligence,
 * manuallabor, endurance, primaryStat, secondaryStat }.
 * @param {number} typeId Torn numeric company type id.
 * @param {string} directorApiKey Director's Torn API key (for the fetch).
 * @returns {Promise<Array>} Normalized positions array (empty on failure).
 */
async function getPositionsForCompanyType(typeId, directorApiKey) {
  const typeIdNum = parseInt(typeId);
  if (!typeIdNum) return [];

  const payload = await fetchCompanyTypesPayload(directorApiKey);
  if (!payload) return [];

  const type = payload[typeIdNum];
  if (!type || !type.positions) return [];

  const positions = [];
  for (const [posName, pos] of Object.entries(type.positions)) {
    if (!pos) continue;

    const intelligence = parseInt(pos.int_required) || 0;
    const manuallabor = parseInt(pos.man_required) || 0;
    const endurance = parseInt(pos.end_required) || 0;

    // Primary = the higher required stat; secondary = the lower required stat.
    const required = [
      { key: 'INT', val: intelligence },
      { key: 'MAN', val: manuallabor },
      { key: 'END', val: endurance }
    ].filter(r => r.val > 0).sort((a, b) => b.val - a.val);

    positions.push({
      id: posName,
      name: posName,
      specialAbility: pos.special_ability && pos.special_ability !== 'None' ? pos.special_ability : '',
      intelligence,
      manuallabor,
      endurance,
      primaryStat: required[0] ? required[0].key : null,
      secondaryStat: required[1] ? required[1].key : null
    });
  }

  // Keep positions in the order Torn reports them.
  return positions;
}

/**
 * Effectiveness contribution for a single required stat, matching Torn's
 * community "effectiveness mechanism" (see TheEffectivenessMechanism repo):
 *   base = floor(min(45, stat/required * 45))      -- capped base
 *   bonus = stat > required ? floor(max(0, 5*log2(stat/required))) : 0
 *   returns base + bonus
 * Base is capped at 45; the log2 bonus rewards over-qualification beyond that.
 * @param {number} stat        Employee's value for this stat.
 * @param {number} required    The position's requirement for this stat.
 * @returns {number} 0..(45 + bonus)
 */
function statEffectiveness(stat, required) {
  const s = parseInt(stat) || 0;
  const r = parseInt(required) || 0;
  if (r <= 0) return 0;
  try {
    const base = Math.floor(Math.min(45, (s / r) * 45));
    let bonus = 0;
    if (s > r) {
      bonus = Math.floor(Math.max(0, 5 * Math.log2(s / r)));
    }
    return base + bonus;
  } catch {
    return 0; // guard against log of non-positive numbers
  }
}

/**
 * Compute an employee's effectiveness at a single position using the same
 * formula as Torn's community "effectiveness mechanism": the position requires
 * a primary stat (the higher requirement) plus a secondary stat (the lower
 * requirement); effectiveness = statEffectiveness(primary) + statEffectiveness(secondary).
 * Stats the position does not require contribute 0.
 * @param {object} employee { manualLabor, intelligence, endurance }
 * @param {object} position { intelligence, manuallabor, endurance }
 * @returns {number} Effectiveness points (typically 0..~90+ with log2 bonuses).
 */
function computeEfficiencyForPosition(employee, position) {
  // Work stat key is `manualLabor` (capital L) elsewhere in this codebase.
  const manuallabor = employee.manualLabor !== undefined ? employee.manualLabor : employee.manuallabor;
  const stats = [
    { stat: employee.intelligence, req: position.intelligence },
    { stat: manuallabor, req: position.manuallabor },
    { stat: employee.endurance, req: position.endurance }
  ];

  // Only the two required stats matter. The higher requirement = primary,
  // the lower requirement = secondary (matches role definitions: e.g. Sexpert
  // INT 10000 primary > END 5000 secondary).
  const required = stats.filter(s => (parseInt(s.req) || 0) > 0);
  if (required.length === 0) return 90; // role with no stat requirements
  required.sort((a, b) => (parseInt(b.req) || 0) - (parseInt(a.req) || 0));

  const [primary, secondary] = required;
  return statEffectiveness(primary.stat, primary.req) +
         (secondary ? statEffectiveness(secondary.stat, secondary.req) : 0);
}

/**
 * Build the efficiency matrix for every employee against every position.
 * @param {Array} employees Normalized employee list (with work stats).
 * @param {Array} positions Normalized positions for the company type.
 */
function buildEfficiencyMatrix(employees, positions) {
  // Employees carry `manualLabor` (capital L) from getCompanyData; accept both
  // spellings so a MAN-only employee is never dropped from the matrix.
  const populated = employees.filter(e =>
    e && (e.intelligence || e.manualLabor || e.manuallabor || e.endurance)
  );

  return positions.map(position => {
    let best = null;
    const perEmployee = populated.map(employee => {
      const pct = computeEfficiencyForPosition(employee, position);
      if (!best || pct > best.pct) best = { playerId: employee.playerId, pct };
      return { playerId: employee.playerId, pct };
    });

    return {
      id: position.id,
      name: position.name,
      specialAbility: position.specialAbility,
      intelligence: position.intelligence,
      manuallabor: position.manuallabor,
      endurance: position.endurance,
      primaryStat: position.primaryStat || null,
      secondaryStat: position.secondaryStat || null,
      bestPlayerId: best ? best.playerId : null,
      bestEfficiency: best ? best.pct : 0,
      employees: perEmployee
    };
  });
}

// Fetch company data from Torn API using the director's API key
async function fetchCompanyDataFromApi(companyId, directorApiKey) {
  try {
    const res = await axios.get(
      `https://api.torn.com/company/${companyId}?key=${encodeURIComponent(directorApiKey)}`
    );
    if (res.data.error) {
      throw new Error(res.data.error.error);
    }
    return res.data;
  } catch (err) {
    throw new Error(`Torn API error for company ${companyId}: ${err.message}`);
  }
}

// Fetch work stats and addiction for an employee using their personal API key
async function fetchEmployeeWorkStats(employeeApiKey) {
  try {
    const res = await axios.get(
      `https://api.torn.com/user/?selections=profile,personalstats&key=${encodeURIComponent(employeeApiKey)}`
    );
    if (res.data.error) return null;
    const ps = res.data.personalstats;
    if (!ps) return null;
    return {
      manualLabor: ps.manuallabor || 0,
      intelligence: ps.intelligence || 0,
      endurance: ps.endurance || 0,
      addiction: res.data.addiction || res.data.addiction_rate || 0
    };
  } catch {
    return null;
  }
}

/**
 * Detect employees who have left the company and notify ownership.
 * Compares stored employee accounts for this company against the
 * company's current Torn roster (keyed by player ID).
 */
async function detectDepartedEmployees(companyId, currentEmployeeIds) {
  try {
    // Find all employee accounts registered for this company
    const storedEmployees = await User.find(
      { accountType: 'employee', companyId: parseInt(companyId) },
      'tornPlayerId tornName'
    );

    const currentIdSet = new Set(currentEmployeeIds.map(id => parseInt(id)));

    for (const emp of storedEmployees) {
      if (currentIdSet.has(emp.tornPlayerId)) continue;

      // Employee is no longer in the company roster — check for existing notification
      const existing = await AppNotification.findOne({
        type: 'employee_removal',
        employeeId: emp.tornPlayerId,
        companyId: parseInt(companyId)
      });

      if (existing) continue; // Already notified

      const company = await Company.findOne({ companyId: parseInt(companyId) });

      await AppNotification.create({
        type: 'employee_removal',
        title: `👋 Employee Left: ${emp.tornName}`,
        message: `${emp.tornName} [${emp.tornPlayerId}] is no longer an employee of ${company?.companyName || `Company ${companyId}`}. Delete their data if they should no longer have access.`,
        employeeName: emp.tornName,
        employeeId: emp.tornPlayerId,
        companyName: company?.companyName || `Company ${companyId}`,
        companyId: parseInt(companyId)
      });

      console.log(`[Company ${companyId}] Employee ${emp.tornName} (${emp.tornPlayerId}) detected as departed — notification created.`);
    }
  } catch (err) {
    console.error('Employee departure detection error:', err.message);
  }
}

// Add a new company (ownership only)
async function addCompany(companyId, directorPlayerId, addedBy) {
  // 1. Verify director is in faction
  const factionCheck = await verifyDirectorInFaction(directorPlayerId);
  if (!factionCheck.valid) {
    return { success: false, error: 'Director is not a member of SSG faction or could not be verified.' };
  }

  // 2. Look up director's saved API key
  const directorUser = await User.findOne({ tornPlayerId: parseInt(directorPlayerId) });
  if (!directorUser || !directorUser.tornApiKey) {
    return { success: false, error: 'Director has no saved API key in the system. They must log in and save their key first.' };
  }

  // 3. Test API access to the company
  let companyData;
  try {
    companyData = await fetchCompanyDataFromApi(companyId, directorUser.tornApiKey);
  } catch (err) {
    return { success: false, error: `Cannot access company data: ${err.message}. Ensure the director's API key has full access.` };
  }

  // 4. Extract basic info
  const profile = companyData.company || companyData;
  const companyName = profile.name || `Company ${companyId}`;
  const companyTypeId = parseInt(profile.company_type);
  const companyType = getCompanyTypeName(companyTypeId);
  const dailyIncome = profile.daily_income || 0;

  // 5. Save to database
  try {
    const company = new Company({
      companyId: parseInt(companyId),
      companyName,
      companyType,
      companyTypeId,
      directorPlayerId: parseInt(directorPlayerId),
      directorName: factionCheck.member?.name || directorUser.tornName || '',
      stars: profile.rating || 0,
      dailyIncome,
      addedBy: parseInt(addedBy),
      lastFetchedAt: new Date()
    });
    await company.save();
    return { success: true, company };
  } catch (err) {
    if (err.code === 11000) {
      return { success: false, error: 'Company already exists in the system.' };
    }
    return { success: false, error: err.message };
  }
}

// Get full company data (director or ownership)
async function getCompanyData(companyId, requestingPlayerId) {
  // 1. Get company from DB
  const company = await Company.findOne({ companyId: parseInt(companyId) });
  if (!company) throw new Error('Company not found');

  // 2. Look up director's API key
  const directorUser = await User.findOne({ tornPlayerId: company.directorPlayerId });
  if (!directorUser || !directorUser.tornApiKey) {
    throw new Error('Company director has no API key saved. Data cannot be refreshed.');
  }

  // 3. Fetch company data from Torn API
  const companyData = await fetchCompanyDataFromApi(companyId, directorUser.tornApiKey);
  const profile = companyData.company || companyData;
  const dailyIncome = profile.daily_income || 0;

  // 4. Process employees - match by player ID directly from the Torn company API
  const employees = [];
  const employeesData = profile.employees || {};

  // Torn company API keys employees by player ID (object key = player ID)
  const employeeIds = Object.keys(employeesData).map(id => parseInt(id));

  // Get all users with API keys from DB for work-stats lookup
  const dbUsers = await User.find({ tornApiKey: { $ne: null } }, 'tornPlayerId tornApiKey tornName');
  const dbByTornId = {};
  dbUsers.forEach(u => { if (u.tornPlayerId) dbByTornId[u.tornPlayerId] = u; });

  // Numeric company type id (needed to look up position stat requirements).
  const companyTypeId = parseInt(profile.company_type);

  for (const [empId, emp] of Object.entries(employeesData)) {
    if (!emp || !emp.name) continue;

    const playerId = parseInt(empId);
    if (!playerId) continue;

    // Look for their API key in our database by player ID
    const dbUser = dbByTornId[playerId];
    let workStats = null;

    if (dbUser && dbUser.tornApiKey) {
      workStats = await fetchEmployeeWorkStats(dbUser.tornApiKey);
    }

    employees.push({
      name: emp.name,
      position: emp.position || '',
      playerId: playerId,
      manualLabor: workStats?.manualLabor || 0,
      intelligence: workStats?.intelligence || 0,
      endurance: workStats?.endurance || 0,
      addiction: workStats?.addiction || 0
    });
  }

  // Sort employees by position hierarchy then name
  employees.sort((a, b) => {
    if (a.position !== b.position) return a.position.localeCompare(b.position);
    return a.name.localeCompare(b.name);
  });

  // 4b. Fetch this company type's positions + evaluate each employee's
  //     efficiency against every position (Torn Stats style matrix).
  const positions = await getPositionsForCompanyType(companyTypeId, directorUser.tornApiKey);
  const efficiencyMatrix = buildEfficiencyMatrix(employees, positions);

  // Attach each employee's per-position efficiency + their best position.
  const matrixByPlayer = {};
  for (const pos of efficiencyMatrix) {
    for (const cell of pos.employees) {
      if (!matrixByPlayer[cell.playerId]) matrixByPlayer[cell.playerId] = [];
      matrixByPlayer[cell.playerId].push({ positionId: pos.id, name: pos.name, pct: cell.pct });
    }
  }
  employees.forEach(emp => {
    const perPos = matrixByPlayer[emp.playerId] || [];
    perPos.sort((a, b) => b.pct - a.pct);
    emp.efficiency = { byPosition: perPos, best: perPos[0] || null };
  });

  // 5. Detect departed employees and notify ownership (deduped)
  await detectDepartedEmployees(companyId, employeeIds);

  // 6. Update cached info in DB
  company.companyName = profile.name || company.companyName;
  company.companyType = getCompanyTypeName(companyTypeId);
  company.companyTypeId = companyTypeId;
  company.stars = profile.rating || company.stars;
  company.dailyIncome = dailyIncome;
  company.lastFetchedAt = new Date();
  await company.save();

  return {
    company: {
      id: company.companyId,
      name: company.companyName,
      type: company.companyType,
      typeId: company.companyTypeId,
      director: company.directorName,
      directorId: company.directorPlayerId,
      stars: company.stars,
      dailyIncome,
      lastFetchedAt: company.lastFetchedAt
    },
    employees,
    positions: efficiencyMatrix
  };
}

// List all companies (basic info)
async function listCompanies() {
  return Company.find().sort({ companyName: 1 });
}

// Remove a company
async function removeCompany(companyId) {
  const result = await Company.deleteOne({ companyId: parseInt(companyId) });
  return result.deletedCount > 0;
}

module.exports = {
  addCompany,
  getCompanyData,
  listCompanies,
  removeCompany,
  verifyDirectorInFaction,
  detectDepartedEmployees,
  fetchCompanyDataFromApi,
  getPositionsForCompanyType,
  computeEfficiencyForPosition,
  statEffectiveness,
  buildEfficiencyMatrix
};