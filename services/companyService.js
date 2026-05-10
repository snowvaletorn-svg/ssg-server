const axios = require('axios');
const Company = require('../models/Company');
const User = require('../models/User');

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

// Fetch company data from Torn API using the director's API key
async function fetchCompanyDataFromApi(companyId, directorApiKey) {
  try {
    const res = await axios.get(
      `https://api.torn.com/company/${companyId}?key=${directorApiKey}`
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
      `https://api.torn.com/user/?selections=profile,personalstats&key=${employeeApiKey}`
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
  const companyType = getCompanyTypeName(profile.company_type);
  const dailyIncome = profile.daily_income || 0;

  // 5. Save to database
  try {
    const company = new Company({
      companyId: parseInt(companyId),
      companyName,
      companyType,
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

  // 4. Get faction member list for name-to-ID mapping
  const factionKey = await getFactionApiKey();
  let memberNameToId = {};
  try {
    if (factionKey) {
      const factionRes = await axios.get(
        `https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`
      );
      const members = factionRes.data.members || [];
      members.forEach(m => {
        memberNameToId[m.name.toLowerCase()] = m.id;
      });
    }
  } catch (err) {
    console.warn('Could not fetch faction members for employee enrichment:', err.message);
  }

  // 5. Get all users with API keys from DB for quick lookup
  const dbUsers = await User.find({ tornApiKey: { $ne: null } }, 'tornPlayerId tornApiKey tornName');

  // 6. Process employees - enrich with work stats
  const employees = [];
  const employeesData = profile.employees || {};
  
  for (const emp of Object.values(employeesData)) {
    if (!emp || !emp.name) continue;

    // Try to find this employee's Torn ID by name match
    const employeeId = memberNameToId[emp.name.toLowerCase()];
    
    // Look for their API key in our database
    const dbUser = dbUsers.find(u => u.tornPlayerId === employeeId);
    let workStats = null;
    
    if (dbUser && dbUser.tornApiKey) {
      workStats = await fetchEmployeeWorkStats(dbUser.tornApiKey);
    }

    employees.push({
      name: emp.name,
      position: emp.position || '',
      playerId: employeeId || null,
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

  // 7. Update cached info in DB
  company.companyName = profile.name || company.companyName;
  company.companyType = getCompanyTypeName(profile.company_type);
  company.stars = profile.rating || company.stars;
  company.dailyIncome = dailyIncome;
  company.lastFetchedAt = new Date();
  await company.save();

  return {
    company: {
      id: company.companyId,
      name: company.companyName,
      type: company.companyType,
      director: company.directorName,
      directorId: company.directorPlayerId,
      stars: company.stars,
      dailyIncome,
      lastFetchedAt: company.lastFetchedAt
    },
    employees
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
  verifyDirectorInFaction
};