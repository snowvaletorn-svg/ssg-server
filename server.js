require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const nodemailer = require('nodemailer');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const factionData = require('./data/factions');
const User = require('./models/User');
const FactionConfig = require('./models/FactionConfig');
const {
  takeSnapshot,
  takeTestSnapshot,
  getSnapshotByDate,
  getSnapshotDifferences,
  getLatestSnapshot,
  generateCSVContent,
  importHistoricalData,
  getRealSnapshots,
  computeDiff,
  buildDiffCSV,
  getNotifyEmails
} = require('./services/snapshotService');
const { sendEmail } = require('./services/emailService');
const AppNotification = require('./models/AppNotification');
const Announcement = require('./models/Announcement');
const StockObservation = require('./models/StockObservation');
const OrganizedCrime = require('./models/OrganizedCrime');
const UserStatSnapshot = require('./models/UserStatSnapshot');
const { startScheduler } = require('./services/schedulerService');
const stockAnalysisService = require('./services/stockAnalysisService');
const stockDataSourceService = require('./services/stockDataSourceService');
const {
  addCompany,
  getCompanyData,
  listCompanies,
  removeCompany,
  verifyDirectorInFaction
} = require('./services/companyService');
// ═══════════════════════════════════════════════════════════════════════════════
// CAT SCRIPT BACKEND — COMMENTED OUT FOR FUTURE USE
// ═══════════════════════════════════════════════════════════════════════════════
// const CatUser = require('./models/CatUser');
// const CatCall = require('./models/CatCall');
// const CatStatus = require('./models/CatStatus');

// ==============================================
// CACHING LAYER
// ==============================================
const cache = new Map();
const pendingRequests = new Map();

const CACHE_TTL = {
  FACTION_MEMBERS: 5 * 60 * 1000,    // 5 minutes
  USER_DATA: 2 * 60 * 1000,          // 2 minutes
  TRAVEL_DATA: 30 * 1000,            // 30 seconds
  STATIC_DATA: 24 * 60 * 60 * 1000   // 24 hours
};

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.value;
  cache.delete(key);
  return null;
}

function setCached(key, value, ttl) {
  cache.set(key, { value, expiry: Date.now() + ttl });
}

async function deduplicateRequest(key, fetchFn) {
  if (pendingRequests.has(key)) return pendingRequests.get(key);

  const promise = fetchFn();
  pendingRequests.set(key, promise);

  try {
    return await promise;
  } finally {
    pendingRequests.delete(key);
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const SSG_FACTION_ID = 53272;

// Test users for employee login testing (non-faction company employees)
// Each test user is only authorized for their mapped company ID.
const TEST_USERS = [
  { tornName: 'test_userAN', tornId: 1234567, companyId: 115695 },
  { tornName: 'test_userMS', tornId: 2345678, companyId: 124594 },
];

function findTestUser(tornName, tornId) {
  const name = (tornName || '').trim().toLowerCase();
  return TEST_USERS.find(u =>
    u.tornName.toLowerCase() === name && u.tornId === parseInt(tornId)
  );
}

// Format a Torn API error code into a friendly, actionable message
function formatTornApiError(code) {
  const messages = {
    0: 'Torn API is currently down. Please try again later.',
    1: 'You must provide a valid API key.',
    2: 'Your API key is missing permissions. Enable: Personal User Data, Personal Stats, Travel, and Torn Market Data (Items, Bank, Stocks) in Torn API settings.',
    3: 'Your API key does not have access to this data.',
    4: 'Incorrect key. To use the full capability of this page, please use a Full Access API Key.',
    5: 'Torn API is rate limiting your key. Please wait a minute and try again.',
    6: 'Torn is down for maintenance. Please try again later.',
  };
  return messages[code] || `Torn API error (code ${code}).`;
}

// Torn faction positions mapped to permission groups
const POSITIONS = {
  ownership: ['Leader', 'Co-leader', 'Matriarch'],
  leadership: ['Leadership'],
  warlord: ['Warlord'],
  strategy: ['Team Strategy', 'Team_Strategy'],
  strength: ['Team Strength'],
  growth: ['Team Growth', 'Recruit'],
};

// Helper to format numbers (for display in API responses)
function formatNumHelper(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

// Map faction position to permission group
function getPositionGroup(position) {
  for (const [group, positions] of Object.entries(POSITIONS)) {
    if (positions.includes(position)) return group;
  }
  return null;
}

const TRAINING_CHANNELS = [
  {
    id: '1435130329479250021',
    name: '📖 Torn Stats Account Creation',
    description: 'Website dedicated to Tracking Stat progress for Torn as well as a plethora of other items.',
    positionGroups: ['ownership', 'leadership', 'strategy', 'strength', 'growth', 'warlord']
  },
  {
    id: '1435414594410512494',
    name: '📊 Stats Training',
    description: 'Advanced stat training guides and strategies.',
    positionGroups: ['ownership', 'leadership', 'strategy', 'strength', 'warlord']
  },
  {
    id: '1435416169946415194',
    name: '💰 Money Making Training',
    description: 'Guides on making money to fund your stats growth.',
    positionGroups: ['ownership', 'leadership', 'strategy', 'strength', 'warlord']
  },
  {
    id: '1435413325725958165',
    name: '⬆️ Level Training',
    description: 'Everything you need to know about leveling up fast.',
    positionGroups: ['ownership', 'leadership', 'strategy', 'strength', 'growth', 'warlord']
  },
  {
    id: '1435414982316654746',
    name: '🔗 Chains',
    description: 'Detailed walkthrough on what chains are.',
    positionGroups: ['ownership', 'leadership', 'strategy', 'strength', 'growth', 'warlord']
  },
  {
    id: '1435416378709508138',
    name: '🫆 Crimes Training',
    description: 'Guide for all members on Crimes in Torn.',
    positionGroups: ['ownership', 'leadership', 'strategy', 'strength', 'growth', 'warlord']
  },
  {
    id: '1435416812706857225',
    name: '🗝️ Organized Crimes Training',
    description: 'Guide for all members on Organized Crimes in Torn.',
    positionGroups: ['ownership', 'leadership', 'strategy', 'strength', 'growth', 'warlord']
  },
  {
    id: '1435130329479250021',
    name: '📖 Torn Stats Guides',
    description: 'The following are guides available in Torn Stats. These guides require access to Torn Stats. See Torn Stats Training for information on how to create your Torn Stats account.',
    positionGroups: ['ownership', 'leadership', 'strategy', 'strength', 'growth', 'warlord']
  },
];

// ─── HELPER: Get faction API key ──────────────────────────────────────────────
async function getFactionApiKey() {
  try {
    const config = await FactionConfig.findOne({ key: 'config' });
    if (config?.tornFactionApiKey) return config.tornFactionApiKey.trim();
  } catch (err) {
    console.error('Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY?.trim() || null;
}

// ─── HELPER: Validate Torn API key and get user data ─────────────────────────
async function validateTornApiKey(apiKey) {
  try {
    const encodedKey = encodeURIComponent(apiKey.trim());
    const res = await axios.get(`https://api.torn.com/user/?selections=basic,profile&key=${encodedKey}`);
    if (res.data.error) {
      return { valid: false, error: res.data.error.error };
    }
    return {
      valid: true,
      playerId: res.data.player_id,
      name: res.data.name,
      data: res.data
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ─── HELPER: Check if player is in a company's employee roster ───────────────
// Uses the company director's saved API key to fetch the current rosters.
async function isPlayerInCompany(playerId, companyId) {
  try {
    const { fetchCompanyDataFromApi } = require('./services/companyService');
    const Company = require('./models/Company');
    const company = await Company.findOne({ companyId: parseInt(companyId) });
    if (!company) return { inCompany: false, error: 'Company not found in the system.' };

    const directorUser = await User.findOne({ tornPlayerId: company.directorPlayerId });
    if (!directorUser || !directorUser.tornApiKey) {
      // Fallback: the stored director may be stale or keyless — use any saved
      // key (the company profile is readable with any valid key).
      const anyKeyed = await User.findOne(
        { tornApiKey: { $exists: true, $nin: [null, ''] } },
        'tornPlayerId tornApiKey'
      );
      if (!anyKeyed?.tornApiKey) {
        return { inCompany: false, error: 'Company director has no API key saved. Please contact ownership.' };
      }
      return await checkCompanyRoster(playerId, companyId, anyKeyed.tornApiKey);
    }

    return await checkCompanyRoster(playerId, companyId, directorUser.tornApiKey);
  } catch (err) {
    return { inCompany: false, error: err.message };
  }
}

// Shared roster check for isPlayerInCompany — fetches the company profile with
// the given API key and reports whether the player is on the current roster.
async function checkCompanyRoster(playerId, companyId, apiKey) {
  try {
    const { fetchCompanyDataFromApi } = require('./services/companyService');
    const companyData = await fetchCompanyDataFromApi(companyId, apiKey);
    const employeesObj = companyData.company?.employees || companyData.employees || {};
    const employeeIds = Object.keys(employeesObj).map(id => parseInt(id));

    return {
      inCompany: employeeIds.includes(parseInt(playerId)),
      companyName: companyData.company?.name || companyData.name || `Company ${companyId}`
    };
  } catch (err) {
    return { inCompany: false, error: err.message };
  }
}

// ─── HELPER: Check if player is in SSG faction ───────────────────────────────
async function isPlayerInFaction(playerId) {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return { inFaction: false, error: 'No faction API key configured' };

    const encodedKey = encodeURIComponent(factionKey.trim());
    const res = await axios.get(
      `https://api.torn.com/v2/faction/members?key=${encodedKey}`
    );
    if (res.data.error) {
      return { inFaction: false, error: res.data.error.error };
    }

    const member = res.data.members?.find(m => m.id === playerId);
    return { inFaction: !!member, member: member || null };
  } catch (err) {
    return { inFaction: false, error: err.message };
  }
}

// ─── MONGODB ──────────────────────────────────────────────────────────────────
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    family: 4,
    tls: true
  })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));
}

// ─── SESSION STORE ────────────────────────────────────────────────────────────
let sessionStore;
if (isProduction && process.env.MONGO_URI) {
  sessionStore = MongoStore.create
    ? MongoStore.create({ mongoUrl: process.env.MONGO_URI, collectionName: 'sessions', ttl: 14 * 24 * 60 * 60 })
    : new (MongoStore.default || MongoStore)({ mongoUrl: process.env.MONGO_URI, collectionName: 'sessions' });
} else {
  sessionStore = new session.MemoryStore();
}

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Login-specific rate limiter (stricter)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 login attempts per 15 minutes
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const bankRatesLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many bank rate requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── APP SETTINGS & MIDDLEWARE ────────────────────────────────────────────────
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors({
  origin: function (origin, callback) {
    // If no origin (like simple server-to-server or direct tools), allow it
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'https://ssg-server.onrender.com',
      'https://www.torn.com', // ALLOWS STANDARD PC BROWSER TAMPERMONKEY HANDSHAKES
      'https://torn.com',
      process.env.ALLOWED_ORIGIN
    ].filter(Boolean);

    // Allow matched origins, subdomains of onrender, OR requests coming from Torn itself
    if (
      allowedOrigins.indexOf(origin) !== -1 || 
      origin.endsWith('.onrender.com') ||
      origin.includes('torn.com')
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'User-Agent',
    'Accept'
  ],
  credentials: true // Keeps session cookies functional for your dashboard login views
}));
app.use(compression({ level: 6 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/', apiLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/torn/bank-rates', bankRatesLimiter);

// ─── SESSION ──────────────────────────────────────────────────────────────────
const SESSION_MAX_AGE = 72 * 60 * 60 * 1000; // 72 hours (default)
const STAY_LOGGED_IN_MAX_AGE = 100 * 60 * 60 * 1000; // 100 hours (extended)

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: {
    secure: isProduction,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    httpOnly: true
  }
}));

// Middleware to extend session on each request if stayLoggedIn is set
app.use((req, res, next) => {
  if (req.session && req.session.stayLoggedIn) {
    // Reset the session expiration on each request
    req.session.cookie.maxAge = STAY_LOGGED_IN_MAX_AGE;
    // Touch the session to update expiration in store
    if (req.session.touch) {
      req.session.touch(Date.now());
    }
  }
  next();
});

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const isAuthenticated = (req, res, next) => {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  next();
};

// Helper to check if user has a specific position group
function hasPositionGroup(user, group) {
  const position = user?.factionPosition;
  if (!position) return false;
  return POSITIONS[group]?.includes(position) || false;
}

// Helper to get effective position group (respects impersonation)
function getEffectivePositionGroup(req) {
  // Only ownership users can impersonate other roles
  if (hasPositionGroup(req.session.user, 'ownership') && req.session.impersonateRole) {
    return req.session.impersonateRole;
  }
  return req.session.user?.positionGroup;
}

const isOwnership = (req, res, next) => {
  if (!hasPositionGroup(req.session.user, 'ownership')) {
    return res.status(403).json({ error: 'Ownership position required (Leader, Co-leader, or Matriarch).' });
  }
  next();
};

const isLeadershipOrOwnership = (req, res, next) => {
  if (!hasPositionGroup(req.session.user, 'ownership') && !hasPositionGroup(req.session.user, 'leadership')) {
    return res.status(403).json({ error: 'Leadership or Ownership position required.' });
  }
  next();
};

const isWarlord = (req, res, next) => {
  if (!hasPositionGroup(req.session.user, 'ownership') &&
    !hasPositionGroup(req.session.user, 'leadership') &&
    !hasPositionGroup(req.session.user, 'warlord')) {
    return res.status(403).json({ error: 'Ownership, Leadership, or Warlord position required.' });
  }
  next();
};

// Reject employee (non-faction) accounts from faction-sensitive endpoints
const isFactionMember = (req, res, next) => {
  if (req.session?.user?.accountType === 'employee') {
    return res.status(403).json({ error: 'This feature is only available to faction members.' });
  }
  next();
};

// ─── UTILITY LOANING PERMISSION ───────────────────────────────────────────────
// The "Utility Loaning" permission is granted by a faction position whose armory
// access includes the Utilities (Temporary) category. We detect it by querying
// Torn's faction positions API and reading each position's armory loan capacity.
//
// Note: utilities / OC crime items map to Torn's "temporary" armory category.
// We treat a position as having Utility Loaning when its temporary (or a possible
// dedicated utilities) loan capacity is > 0, OR the position is ownership/leadership.
let utilityLoaningCache = null;
let utilityLoaningCacheAt = 0;
const UTILITY_LOANING_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Detect the set of faction position names that can loan from the Utilities armory
async function fetchUtilityLoaningPositions() {
  const factionKey = await getFactionApiKey();
  if (!factionKey) return new Set();

  const posRes = await axios.get(
    `https://api.torn.com/faction/?selections=positions&key=${encodeURIComponent(factionKey)}`,
    { timeout: 10000 }
  );
  const raw = posRes.data;
  const positions = raw?.positions || raw || {};

  const set = new Set();
  // Always include ownership/leadership as capable of fulfilling (sensible fallback).
  POSITIONS.ownership.forEach(p => set.add(p));
  POSITIONS.leadership.forEach(p => set.add(p));

  if (Array.isArray(positions)) {
    positions.forEach(pos => {
      if (pos && typeof pos === 'object' && hasUtilityLoanCapacity(pos)) {
        if (pos.name) set.add(pos.name);
      }
    });
  } else if (positions && typeof positions === 'object') {
    Object.values(positions).forEach(pos => {
      if (pos && typeof pos === 'object' && hasUtilityLoanCapacity(pos)) {
        if (pos.name) set.add(pos.name);
      }
    });
  }

  return set;
}

// Does a single position object allow loaning from the Utilities/Temporary armory?
function hasUtilityLoanCapacity(pos) {
  // The Utilities / OC crime items fall under the "temporary" armory category.
  // Some API versions may expose a dedicated "utilities" field. Accept either.
  const rawTemp = pos.temporary;
  const rawUtil = pos.utilities;
  if (typeof rawTemp === 'number') return rawTemp > 0;
  if (typeof rawUtil === 'number') return rawUtil > 0;
  if (typeof rawTemp === 'boolean') return rawTemp === true;
  if (typeof rawUtil === 'boolean') return rawUtil === true;
  // String capacities like "5" or comma lists
  if (typeof rawTemp === 'string' && rawTemp.trim() !== '' && rawTemp.trim() !== '0') return true;
  if (typeof rawUtil === 'string' && rawUtil.trim() !== '' && rawUtil.trim() !== '0') return true;
  return false;
}

// Cached wrapper around fetchUtilityLoaningPositions
async function getUtilityLoaningPositions() {
  if (Date.now() - utilityLoaningCacheAt < UTILITY_LOANING_CACHE_TTL && utilityLoaningCache) {
    return utilityLoaningCache;
  }
  const positions = await fetchUtilityLoaningPositions();
  utilityLoaningCache = positions;
  utilityLoaningCacheAt = Date.now();
  return positions;
}

// Does a given session user have the Utility Loaning permission?
async function isUtilityLoaningUser(user) {
  if (!user?.factionPosition) return false;
  // Ownership / leadership always qualify
  if (hasPositionGroup(user, 'ownership') || hasPositionGroup(user, 'leadership')) return true;
  try {
    const positions = await getUtilityLoaningPositions();
    return positions.has(user.factionPosition);
  } catch (err) {
    console.error('Utility Loaning permission check failed:', err.message);
    return false;
  }
}

// Express middleware for endpoints that require the Utility Loaning permission
const isUtilityLoaning = async (req, res, next) => {
  const ok = await isUtilityLoaningUser(req.session.user);
  if (!ok) {
    return res.status(403).json({ error: 'Utility Loaning permission required.' });
  }
  next();
};

// ─── COMPANY PAGE ACCESS ──────────────────────────────────────────────────────
// Every faction member can open the Companies page. Each member sees the
// companies they direct (registered by Ownership) plus any company they
// currently work at (detected live from their own saved Torn API key's `job`
// selection). Ownership sees everything. Employees keep their logged-in
// company. Membership lookups are cached to limit Torn API calls.

const USER_COMPANY_MEMBERSHIP_CACHE_TTL = 10 * 60 * 1000; // 10 min for "has job"
const USER_NO_COMPANY_CACHE_TTL = 5 * 60 * 1000;          // 5 min for "no job"

/**
 * Determine which company (if any) a user currently works at, using their own
 * saved Torn API key with the `job` selection. The result is cached in-memory
 * (positive result longer than negative) to keep Torn API usage low.
 * @param {number} playerId
 * @param {string} apiKey User's own Torn API key
 * @returns {Promise<number|null>} company ID the user works at, or null
 */
async function detectUserCompany(playerId, apiKey) {
  const cacheKey = `user-company:${playerId}`;
  const cached = getCached(cacheKey);
  if (cached !== null && cached !== undefined) return cached.hasCompany ? cached.companyId : null;

  const result = await deduplicateRequest(cacheKey, async () => {
    try {
      const encodedKey = encodeURIComponent(apiKey.trim());
      const res = await axios.get(
        `https://api.torn.com/user/?selections=job&key=${encodedKey}`,
        { timeout: 10000 }
      );
      if (res.data.error) return { hasCompany: false, companyId: null };
      const job = res.data.job || {};
      // v1 shape: { job: { company_id, company_name, ... }, jobpoints: {...} }
      const companyId = parseInt(job.company_id || job.companyId || job.company?.id);
      return { hasCompany: !!companyId, companyId: companyId || null };
    } catch (err) {
      console.error(`Company membership lookup failed for player ${playerId}:`, err.message);
      return { hasCompany: false, companyId: null };
    }
  });

  setCached(cacheKey, result, result.hasCompany ? USER_COMPANY_MEMBERSHIP_CACHE_TTL : USER_NO_COMPANY_CACHE_TTL);
  return result.hasCompany ? result.companyId : null;
}

/**
 * Resolve which registered companies the session user may see.
 * Ownership → all companies. Employees → their logged-in company only.
 * Faction members → companies they direct + companies they work at (live
 * lookup via their own API key, cached).
 * @param {object} req Express request (requires an authenticated session)
 * @returns {Promise<Array>} Company documents the user can view
 */
async function getAccessibleCompaniesForUser(req) {
  const Company = require('./models/Company');
  const user = req.session.user;
  const userId = parseInt(req.session.userId);
  const positionGroup = getEffectivePositionGroup(req);
  const allCompanies = await Company.find().sort({ companyName: 1 }).lean();

  if (positionGroup === 'ownership') return allCompanies;

  if (user?.accountType === 'employee') {
    return allCompanies.filter(c => c.companyId === user.companyId);
  }

  // Faction member: companies they direct...
  const directed = allCompanies.filter(c => c.directorPlayerId === userId);

  // ...plus any company they currently work at (by Torn ID across all rosters)
  const memberCompanyIds = new Set(directed.map(c => c.companyId));
  const dbUser = await User.findOne({ tornPlayerId: userId }, 'tornApiKey tornPlayerId');
  if (dbUser?.tornApiKey) {
    const workCompanyId = await detectUserCompany(userId, dbUser.tornApiKey);
    if (workCompanyId) {
      const workCompany = allCompanies.find(c => c.companyId === workCompanyId);
      if (workCompany && !memberCompanyIds.has(workCompanyId)) {
        directed.push(workCompany);
      }
    }
  }

  return directed;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Home page
app.get('/', async (req, res) => {
  let liveGroups = factionData.groups;
  let totalMembers = factionData.faction.memberCount;

  try {
    const factionKey = await getFactionApiKey();
    if (factionKey) {
      // Use existing cache to avoid hitting Torn API on every page load
      const cacheKey = 'home-faction-data';
      let cachedData = getCached(cacheKey);

      if (!cachedData) {
        // Deduplicate simultaneous requests to prevent API flooding
        cachedData = await deduplicateRequest(cacheKey, async () => {
          const encodedKey = encodeURIComponent(factionKey.trim());
          const tornRes = await axios.get(
            `https://api.torn.com/v2/faction/members?key=${encodedKey}`,
            { timeout: 10000 } // 10 second timeout to prevent hanging requests
          );

          const factionMembers = tornRes.data.members || [];
          const positionMap = {
            'Leader': 'Ownership',
            'Co-leader': 'Ownership',
            'Matriarch': 'Ownership',
            'Leadership': 'Leadership',
            'Warlord': 'Warlord',
            'Team Strategy': 'Strategy',
            'Team_Strategy': 'Strategy',
            'Team Strength': 'Strength',
            'Team Growth': 'Growth',
            'Recruit': 'Growth'
          };

          const counts = {};
          factionMembers.forEach(m => {
            const groupName = positionMap[m.position];
            if (groupName) counts[groupName] = (counts[groupName] || 0) + 1;
          });

          const result = {
            liveGroups: factionData.groups.map(g => ({ ...g, members: counts[g.name] ?? g.members })),
            totalMembers: factionMembers.length
          };

          // Cache for 5 minutes (same as other faction data)
          setCached(cacheKey, result, CACHE_TTL.FACTION_MEMBERS);
          return result;
        });
      }

      liveGroups = cachedData.liveGroups;
      totalMembers = cachedData.totalMembers;
    }
  } catch (err) {
    // Only log actual errors, suppress common transient network failures which are expected occasionally
    const transientErrors = ['timeout', '504', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'socket hang up'];
    const isTransient = transientErrors.some(errType => err.message.includes(errType));

    if (!isTransient) {
      console.error('Could not fetch live faction data for home page:', err.message);
    }
    // Fall back gracefully to static data when API fails
  }

  res.render('index', {
    user: req.session.user || null,
    faction: { ...factionData.faction, memberCount: totalMembers },
    groups: liveGroups.filter(g => g.name.toLowerCase() !== 'warlord')
  });
});

// Login page
app.get('/login', async (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  // Pass configured companies for the employee login dropdown (Company Name — Company ID)
  let companies = [];
  try {
    companies = await listCompanies();
  } catch (err) {
    console.error('Could not load companies for login page:', err.message);
  }
  res.render('login', { companies });
});

// Employee login API — for non-faction company employees
app.post('/api/login/employee', async (req, res) => {
  const { tornName, tornId, apiKey: rawApiKey, companyId, stayLoggedIn } = req.body;
  const apiKey = rawApiKey?.trim();

  if (!tornName || !tornId || !apiKey || !companyId) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  // Step 1: Test-user bypass (for testing employee accounts)
  const testUser = findTestUser(tornName, tornId);
  if (testUser) {
    // Verify the selected company matches the test user's authorized company
    if (parseInt(companyId) !== testUser.companyId) {
      return res.status(403).json({ error: `Test user ${testUser.tornName} is only authorized for company ${testUser.companyId}.` });
    }

    // Verify the company exists in the system
    const Company = require('./models/Company');
    const company = await Company.findOne({ companyId: testUser.companyId });
    if (!company) {
      return res.status(403).json({ error: `Company ${testUser.companyId} is not configured. Add it in Admin → Companies first.` });
    }

    // Use the TEST_API_KEY from .env if available
    const testApiKey = process.env.TEST_API_KEY?.trim();
    const savedKey = testApiKey || 'test-api-key-placeholder';

    // Upsert the test user record
    let user = await User.findOne({ tornPlayerId: testUser.tornId });
    if (user) {
      user.tornName = testUser.tornName;
      user.tornApiKey = savedKey;
      user.accountType = 'employee';
      user.companyId = testUser.companyId;
      user.username = testUser.tornName;
      user.lastSeen = new Date();
      user.tornKeyUpdatedAt = new Date();
      await user.save();
    } else {
      user = new User({
        tornPlayerId: testUser.tornId,
        tornName: testUser.tornName,
        tornApiKey: savedKey,
        username: testUser.tornName,
        accountType: 'employee',
        companyId: testUser.companyId,
        lastSeen: new Date()
      });
      await user.save();
    }

    // Create session
    req.session.userId = user.tornPlayerId;
    req.session.user = {
      id: user.tornPlayerId,
      username: testUser.tornName,
      tornName: testUser.tornName,
      accountType: 'employee',
      companyId: testUser.companyId,
      positionGroup: null,
      factionPosition: null,
      tornApiKey: savedKey,
      tornAvatar: null,
      isTestUser: true
    };

    if (stayLoggedIn) {
      req.session.stayLoggedIn = true;
      req.session.cookie.maxAge = STAY_LOGGED_IN_MAX_AGE;
    }

    console.log(`[TEST] Employee test login: ${testUser.tornName} (${testUser.tornId}) → company ${testUser.companyId}`);
    return res.json({ success: true, user: { username: testUser.tornName, isTestUser: true } });
  }

  // Step 2: Validate API key for real users
  const validation = await validateTornApiKey(apiKey);
  if (!validation.valid) {
    const code = parseInt(validation.error);
    if (!isNaN(code)) {
      return res.status(401).json({ error: formatTornApiError(code) });
    }
    return res.status(401).json({ error: `Invalid API key: ${validation.error}` });
  }

  // Step 3: Verify name and ID match
  if (validation.name !== tornName || validation.playerId !== tornId) {
    return res.status(401).json({ error: 'Torn name or ID does not match the API key.' });
  }

  // Step 4: Block faction members from employee login
  const factionCheck = await isPlayerInFaction(tornId);
  if (factionCheck.inFaction) {
    return res.status(403).json({ error: 'Faction members must use Faction Login. Employees of our companies who are not faction members should use this login.' });
  }

  // Step 5: Verify company membership
  const companyCheck = await isPlayerInCompany(tornId, companyId);
  if (!companyCheck.inCompany) {
    return res.status(403).json({ error: companyCheck.error || `You are not a member of ${companyCheck.companyName || 'the selected company'}. Access denied.` });
  }

  // Step 6: Upsert user record
  let user = await User.findOne({ tornPlayerId: tornId });
  if (user) {
    user.tornApiKey = apiKey;
    user.tornName = tornName;
    user.tornKeyUpdatedAt = new Date();
    user.lastSeen = new Date();
    user.accountType = 'employee';
    user.companyId = parseInt(companyId);
    await user.save();
  } else {
    user = new User({
      tornPlayerId: tornId,
      tornName: tornName,
      tornApiKey: apiKey,
      username: tornName,
      accountType: 'employee',
      companyId: parseInt(companyId),
      lastSeen: new Date()
    });
    await user.save();
  }

  // Step 7: Create session
  req.session.userId = user.tornPlayerId;
  req.session.user = {
    id: user.tornPlayerId,
    username: tornName,
    tornName: tornName,
    accountType: 'employee',
    companyId: parseInt(companyId),
    positionGroup: null,
    factionPosition: null,
    tornApiKey: user.tornApiKey,
    tornAvatar: validation.data?.profile_image ?? null,
    isTestUser: false
  };

  if (stayLoggedIn) {
    req.session.stayLoggedIn = true;
    req.session.cookie.maxAge = STAY_LOGGED_IN_MAX_AGE;
  }

  res.json({ success: true, user: { username: tornName } });
});

// Torn-based login API
app.post('/api/login', async (req, res) => {
  const { tornName, tornId, apiKey: rawApiKey, stayLoggedIn } = req.body;
  const apiKey = rawApiKey?.trim();

  if (!tornName || !tornId || !apiKey) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  // Step 1: Validate API key
  const validation = await validateTornApiKey(apiKey);
  if (!validation.valid) {
    return res.status(401).json({ error: `Invalid API key: ${validation.error}` });
  }

  // Step 2: Verify name and ID match
  if (validation.name !== tornName || validation.playerId !== tornId) {
    return res.status(401).json({ error: 'Torn name or ID does not match the API key.' });
  }

  // Step 3: Check if user is currently in the faction (REQUIRED FOR ALL LOGINS)
  const factionCheck = await isPlayerInFaction(tornId);
  if (!factionCheck.inFaction) {
    return res.status(403).json({ error: 'You are not a current member of SSG faction. Access denied.' });
  }

  // Step 4: Check if user exists in database
  let user = await User.findOne({ tornPlayerId: tornId });

  if (user) {
    // Existing user - update API key and login (ensure faction account type)
    user.tornApiKey = apiKey;
    user.tornName = tornName;
    user.tornKeyUpdatedAt = new Date();
    user.lastSeen = new Date();
    user.accountType = 'faction';
    user.companyId = null;
    await user.save();
  } else {
    // Create new user
    user = new User({
      tornPlayerId: tornId,
      tornName: tornName,
      tornApiKey: apiKey,
      username: tornName,
      accountType: 'faction',
      companyId: null,
      lastSeen: new Date()
    });
    await user.save();
  }

  // Step 4: Fetch faction position from Torn API
  let factionPosition = null;
  let positionGroup = null;
  try {
    const factionCheck = await isPlayerInFaction(tornId);
    if (factionCheck.inFaction && factionCheck.member) {
      factionPosition = factionCheck.member.position;
      positionGroup = getPositionGroup(factionPosition);
    }
  } catch (err) {
    console.log('Could not fetch faction position for user:', err.message);
  }

  // Step 5: Create session
  req.session.userId = user.tornPlayerId;
  req.session.user = {
    id: user.tornPlayerId,
    username: tornName,
    tornName: tornName,
    accountType: 'faction',
    companyId: user.companyId || null,
    factionPosition: factionPosition,
    positionGroup: positionGroup,
    tornApiKey: user.tornApiKey,
    // Avatar is in profile_image field
    tornAvatar: validation.data?.profile_image ?? null
  };

  console.log('Session tornAvatar:', req.session.user.tornAvatar);

  // Step 6: Handle "Stay logged in" option
  if (stayLoggedIn) {
    req.session.stayLoggedIn = true;
    req.session.cookie.maxAge = STAY_LOGGED_IN_MAX_AGE;
  }

  res.json({ success: true, user: { username: tornName } });
});

// Dashboard
app.get('/dashboard', isAuthenticated, async (req, res) => {
  const isEmployee = req.session.user?.accountType === 'employee';
  const positionGroup = getEffectivePositionGroup(req);
  const factionPosition = req.session.user?.factionPosition;
  const isImpersonating = hasPositionGroup(req.session.user, 'ownership') && req.session.impersonateRole;

  if (isEmployee) {
    // Employee accounts skip the faction gate and get the employee dashboard
    const user = await User.findOne({ tornPlayerId: req.session.userId });
    const factionKey = await getFactionApiKey();

    return res.render('dashboard', {
      user: req.session.user,
      accessibleTraining: [], // Employees get no training access
      tornApiKey: user?.tornApiKey || null,
      userEmail: null,
      isOwner: false,
      realIsOwner: false,
      isLeadership: false,
      isWarlord: false,
      hasFactionKey: !!factionKey,
      factionPosition: null,
      isImpersonating: false,
      impersonatedRole: null,
      availableRoles: [],
      isCompaniesAccess: true, // Employees see the Companies nav item (their own company)
      isEmployee: true,
      isTestUser: !!req.session.user?.isTestUser,
      isUtilityLoaning: false
    });
  }

  // Check if user is in faction (all faction members get basic access)
  let canAccess = !!positionGroup;
  if (!canAccess) {
    const factionCheck = await isPlayerInFaction(req.session.userId);
    canAccess = factionCheck.inFaction;
  }

  if (!canAccess) return res.redirect('/?error=no_access');

  const user = await User.findOne({ tornPlayerId: req.session.userId });

  // Calculate permissions based on EFFECTIVE impersonated role
  const isOwner = positionGroup === 'ownership';
  const realIsOwner = hasPositionGroup(req.session.user, 'ownership');
  const isLeadership = ['ownership', 'leadership'].includes(positionGroup);
  const isWarlordRole = ['ownership', 'leadership', 'warlord'].includes(positionGroup);

  // Companies page access: every faction member can view (they see their own
  // companies — directed and/or worked at); employees see their logged-in company.
  const accessibleCompanies = await getAccessibleCompaniesForUser(req);
  const isCompaniesAccess = accessibleCompanies.length > 0;

  const factionKey = await getFactionApiKey();

  const accessibleTraining = TRAINING_CHANNELS.filter(ch =>
    positionGroup && ch.positionGroups.includes(positionGroup)
  );

  res.render('dashboard', {
    user: req.session.user,
    accessibleTraining,
    tornApiKey: user?.tornApiKey || null,
    userEmail: user?.email || null,
    isOwner,
    realIsOwner,
    isLeadership,
    isWarlord: isWarlordRole,
    hasFactionKey: !!factionKey,
    factionPosition: factionPosition,
    isImpersonating,
    impersonatedRole: req.session.impersonateRole || null,
    availableRoles: Object.keys(POSITIONS),
    isCompaniesAccess,
    isEmployee: false,
    isTestUser: false,
    isUtilityLoaning: await isUtilityLoaningUser(req.session.user)
  });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.redirect('/');
  });
});

// ─── API: Keep-alive ping ─────────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ ok: true });
});


// ─── API: Save personal Torn API key ─────────────────────────────────────────
app.post('/api/torn/key', isAuthenticated, async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(400).json({ error: 'API key is required' });
  }
  try {
    const encodedKey = encodeURIComponent(apiKey.trim());
    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=basic&key=${encodedKey}`
    );
    if (tornRes.data.error) {
      return res.status(400).json({ error: 'Invalid Torn API key: ' + tornRes.data.error.error });
    }
    await User.findOneAndUpdate(
      { tornPlayerId: req.session.userId },
      {
        tornApiKey: apiKey.trim(),
        tornPlayerId: tornRes.data.player_id,
        tornName: tornRes.data.name,
        tornKeyUpdatedAt: new Date()
      },
      { upsert: true }
    );
    // Update session
    req.session.user.tornApiKey = apiKey.trim();
    res.json({ success: true, player: tornRes.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Save faction API key (Ownership only) ───────────────────────────────
app.post('/api/torn/faction-key', isAuthenticated, isOwnership, async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(400).json({ error: 'API key is required' });
  }
  try {
    const encodedKey = encodeURIComponent(apiKey.trim());
    const tornRes = await axios.get(
      `https://api.torn.com/faction/?selections=basic&key=${encodedKey}`
    );
    if (tornRes.data.error) {
      return res.status(400).json({ error: 'Invalid faction API key: ' + tornRes.data.error.error });
    }
    await FactionConfig.findOneAndUpdate(
      { key: 'config' },
      { tornFactionApiKey: apiKey.trim(), setBy: req.session.userId, updatedAt: new Date() },
      { upsert: true }
    );
    res.json({ success: true, faction: tornRes.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Save FFScouter API key ──────────────────────────────────────────────
app.post('/api/user/ffscouter-key', isAuthenticated, async (req, res) => {
  const { ffScouterKey } = req.body;

  if (!ffScouterKey || ffScouterKey.trim() === '') {
    return res.status(400).json({ error: 'FFScouter API key is required' });
  }

  // Basic validation: must be at least 8 characters (FFScouter keys vary)
  const trimmedKey = ffScouterKey.trim();

  try {
    // Save the key directly - validation happens when fetching targets
    await User.findOneAndUpdate(
      { tornPlayerId: req.session.userId },
      {
        ffScouterKey: trimmedKey,
        updatedAt: new Date()
      },
      { returnDocument: 'after' }
    );

    console.log(`FFScouter key saved for user ${req.session.userId}`);
    res.json({ success: true, message: 'FFScouter API key saved successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save FFScouter key: ' + err.message });
  }
});

// ─── API: Fetch FFScouter targets ─────────────────────────────────────────────
app.get('/api/ffscouter/targets', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.ffScouterKey) {
      return res.status(400).json({ error: 'No FFScouter API key saved. Please add your key in the Targets section first.' });
    }

    const { inactiveonly, minlevel, maxlevel, minff, maxff, factionless, limit, preset } = req.query;

    // Build params for FFScouter API
    const params = { key: dbUser.ffScouterKey };

    // FFScouter spec: when preset is specified, only 'key' and 'limit' are allowed
    if (preset && preset !== '') {
      params.preset = preset;
      if (limit) params.limit = Math.min(parseInt(limit), 50);
    } else {
      // Custom filters - include inactiveonly and other params
      if (inactiveonly !== undefined) params.inactiveonly = inactiveonly;
      else params.inactiveonly = 1; // default to inactive players

      if (minlevel) params.minlevel = parseInt(minlevel);
      if (maxlevel) params.maxlevel = parseInt(maxlevel);
      if (minff) params.minff = parseFloat(minff);
      if (maxff) params.maxff = parseFloat(maxff);
      if (factionless !== undefined) params.factionless = parseInt(factionless);
      if (limit) params.limit = Math.min(parseInt(limit), 50);
    }

    //console.log(`[Targets] Calling FFScouter with params:`, JSON.stringify(params));

    let ffRes;
    try {
      ffRes = await axios.get('https://ffscouter.com/api/v1/get-targets', {
        params,
        timeout: 15000
      });
    } catch (axiosErr) {
      console.log(`[Targets] FFScouter error:`, axiosErr.response?.data || axiosErr.message);
      const errData = axiosErr.response?.data;
      if (errData?.error) {
        return res.status(axiosErr.response?.status || 400).json({ error: 'FFScouter: ' + errData.error });
      }
      throw axiosErr;
    }

    if (ffRes.data?.error) {
      return res.status(400).json({ error: 'FFScouter API error: ' + ffRes.data.error });
    }

    let targets = ffRes.data.targets || ffRes.data || [];

    res.json({
      targets,
      filterThreshold: null
    });
  } catch (err) {
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Invalid FFScouter API key. Please update your key in the Targets section.' });
    }
    if (err.response?.status === 404) {
      return res.json({ targets: [], message: 'No targets found matching the specified criteria.', filterThreshold: null });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'FFScouter API timed out. Please try again.' });
    }
    res.status(500).json({ error: 'Failed to fetch targets: ' + err.message });
  }
});

// ─── API: Check FFScouter key status ─────────────────────────────────────────
app.get('/api/user/check-ffscouter-key', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId }, 'ffScouterKey');
    res.json({ hasKey: !!dbUser?.ffScouterKey });
  } catch (err) {
    res.json({ hasKey: false });
  }
});

// ─── API: Save user email address ─────────────────────────────────────────────
app.post('/api/user/email', isAuthenticated, async (req, res) => {
  const { email } = req.body;

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (email && email.trim() !== '' && !emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  try {
    await User.findOneAndUpdate(
      { tornPlayerId: req.session.userId },
      {
        email: email ? email.trim() : null,
        updatedAt: new Date()
      },
      { returnDocument: 'after' }
    );

    res.json({ success: true, message: email ? 'Email saved successfully' : 'Email cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save email: ' + err.message });
  }
});

// ─── API: Personal Torn stats ─────────────────────────────────────────────────
app.get('/api/torn/user', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved. Please add your key first.' });
    }
    const [tornRes, battlestatsRes] = await Promise.all([
      axios.get(
        `https://api.torn.com/user/?selections=basic,profile,bars,personalstats&key=${encodeURIComponent(dbUser.tornApiKey)}`
      ),
      axios.get(
        `https://api.torn.com/user/?selections=battlestats&key=${encodeURIComponent(dbUser.tornApiKey)}`
      )
    ]);

    // Compute effective battle stats from modifiers
    if (!tornRes.data.error && tornRes.data.personalstats && !battlestatsRes.data.error) {
      // Battlestats data is at the top level of the response, with _modifier fields containing the percentage boost
      const bs = battlestatsRes.data;
      const ps = tornRes.data.personalstats;
      
      // The battlestats API returns modifier percentages in the _modifier fields (e.g. strength_modifier: 20 = 20%)
      const strengthMod = parseFloat(bs.strength_modifier) || 0;
      const defenseMod = parseFloat(bs.defense_modifier) || 0;
      const speedMod = parseFloat(bs.speed_modifier) || 0;
      const dexterityMod = parseFloat(bs.dexterity_modifier) || 0;
      
      const effectiveStrength = (ps.strength || 0) * (1 + strengthMod / 100);
      const effectiveDefense = (ps.defense || 0) * (1 + defenseMod / 100);
      const effectiveSpeed = (ps.speed || 0) * (1 + speedMod / 100);
      const effectiveDexterity = (ps.dexterity || 0) * (1 + dexterityMod / 100);
      const effectiveTotal = effectiveStrength + effectiveDefense + effectiveSpeed + effectiveDexterity;
      
      tornRes.data.effectiveStats = {
        strength: Math.round(effectiveStrength),
        defense: Math.round(effectiveDefense),
        speed: Math.round(effectiveSpeed),
        dexterity: Math.round(effectiveDexterity),
        total: Math.round(effectiveTotal),
        modifiers: {
          strength: strengthMod,
          defense: defenseMod,
          speed: speedMod,
          dexterity: dexterityMod
        }
      };
    }

    const factionKey = await getFactionApiKey();
    if (factionKey) {
      try {
        const factionRes = await axios.get(
          `https://api.torn.com/v2/faction/members?key=${encodeURIComponent(factionKey)}`
        );
        const myMemberData = factionRes.data.members?.find(m => m.id === tornRes.data.player_id);
        if (myMemberData) {
          tornRes.data.revive_setting = myMemberData.revive_setting;
        }
      } catch (err) {
        console.error('Could not enrich with faction data:', err.message);
      }
    }

    res.json(tornRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Save personal stat snapshot and return increase ─────────────────────
app.post('/api/user/stats/snapshot', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }

    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=personalstats&key=${encodeURIComponent(dbUser.tornApiKey)}`
    );
    if (tornRes.data.error) {
      return res.status(400).json({ error: tornRes.data.error.error });
    }

    const ps = tornRes.data.personalstats || {};
    const current = {
      strength: ps.strength || 0,
      defense: ps.defense || 0,
      speed: ps.speed || 0,
      dexterity: ps.dexterity || 0,
      totalStats: ps.totalstats || 0
    };

    // Find the most recent previous snapshot
    const lastSnapshot = await UserStatSnapshot.findOne({ tornPlayerId: req.session.userId })
      .sort({ timestamp: -1 })
      .lean();

    // Save the new snapshot
    await UserStatSnapshot.create({
      tornPlayerId: req.session.userId,
      ...current
    });

    // Calculate differences
    const diff = {
      strength: 0,
      defense: 0,
      speed: 0,
      dexterity: 0,
      totalStats: 0
    };

    if (lastSnapshot) {
      diff.strength = current.strength - lastSnapshot.strength;
      diff.defense = current.defense - lastSnapshot.defense;
      diff.speed = current.speed - lastSnapshot.speed;
      diff.dexterity = current.dexterity - lastSnapshot.dexterity;
      diff.totalStats = current.totalStats - lastSnapshot.totalStats;
    }

    res.json({
      current,
      previous: lastSnapshot || null,
      diff,
      isFirstSnapshot: !lastSnapshot
    });
  } catch (err) {
    console.error('Stat snapshot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get last stat increase ─────────────────────────────────────────────
app.get('/api/user/stats/last-increase', isAuthenticated, async (req, res) => {
  try {
    const snapshots = await UserStatSnapshot.find({ tornPlayerId: req.session.userId })
      .sort({ timestamp: -1 })
      .limit(2)
      .lean();

    if (snapshots.length < 2) {
      return res.json({ diff: null, message: 'Need at least 2 snapshots to calculate increase.' });
    }

    const current = snapshots[0];
    const previous = snapshots[1];

    const diff = {
      strength: current.strength - previous.strength,
      defense: current.defense - previous.defense,
      speed: current.speed - previous.speed,
      dexterity: current.dexterity - previous.dexterity,
      totalStats: current.totalStats - previous.totalStats
    };

    res.json({ current, previous, diff });
  } catch (err) {
    console.error('Last increase error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Personal honors, merits, awards ────────────────────────────────────
app.get('/api/torn/honors', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }
    const encodedKey = encodeURIComponent(dbUser.tornApiKey);
    const [userRes, tornRes] = await Promise.all([
      axios.get(`https://api.torn.com/user/?selections=honors,merits&key=${encodedKey}`),
      axios.get(`https://api.torn.com/torn/?selections=honors&key=${encodedKey}`)
    ]);
    if (userRes.data.error) {
      return res.status(400).json({ error: userRes.data.error.error });
    }
    res.json({
      honors_awarded: userRes.data.honors_awarded || [],
      honors_time: userRes.data.honors_time || {},
      merits: userRes.data.merits || {},
      all_honors: tornRes.data.honors || {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Personal crime XP (merits) ─────────────────────────────────────────
app.get('/api/torn/crimeexp', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=criminalrecord&key=${encodeURIComponent(dbUser.tornApiKey)}`
    );
    if (tornRes.data.error) {
      return res.status(400).json({ error: tornRes.data.error.error });
    }
    res.json(tornRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Personal crime skills ──────────────────────────────────────────────
app.get('/api/torn/crimeskills', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/v2/user/skills?key=${encodeURIComponent(dbUser.tornApiKey)}`
    );
    if (tornRes.data.error) {
      return res.status(400).json({ error: tornRes.data.error.error });
    }
    res.json(tornRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Faction stats ───────────────────────────────────────────────────────
app.get('/api/torn/faction', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) {
      return res.status(400).json({ error: 'No faction API key configured.' });
    }
    const encodedKey = encodeURIComponent(factionKey.trim());

    const tornRes = await axios.get(
      `https://api.torn.com/v2/faction/?selections=basic,members&key=${encodedKey}`
    );
    // Get user profile fields from database with timeout protection
    let profileMap = {};
    try {
      // Add timeout and only fetch needed fields
      const dbUsers = await User.find({}, 'tornPlayerId bloodType timeZone email').maxTimeMS(5000);
      dbUsers.forEach(u => {
        profileMap[u.tornPlayerId] = {
          bloodType: u.bloodType,
          timeZone: u.timeZone,
          email: u.email
        };
      });
    } catch (dbErr) {
      // Gracefully fall back if database is slow/unavailable - don't break entire faction page
      console.warn('Database timeout when fetching user profiles:', dbErr.message);
      // Continue without profile data rather than failing completely
    }

    // Enrich response with profile data
    if (tornRes.data.members) {
      tornRes.data.members = tornRes.data.members.map(m => ({
        ...m,
        bloodType: profileMap[m.id]?.bloodType || null,
        timeZone: profileMap[m.id]?.timeZone || null,
        email: profileMap[m.id]?.email || null
      }));
    }

    res.json(tornRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Faction travel status ───────────────────────────────────────────────
app.get('/api/torn/faction-travel', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const encodedKey = encodeURIComponent(factionKey.trim());
    const factionRes = await axios.get(
      `https://api.torn.com/v2/faction/members?key=${encodedKey}`
    );
    const members = factionRes.data.members || [];
    const travelingMembers = members.filter(m => m.status?.state === 'Traveling');

    const dbUsers = await User.find({ tornApiKey: { $ne: null } }, 'tornApiKey tornPlayerId tornName');

    const travelResults = await Promise.allSettled(
      dbUsers.map(async u => {
        const factionMember = travelingMembers.find(m => m.id === u.tornPlayerId);
        if (!factionMember) return null;
        try {
          const tornRes = await axios.get(
            `https://api.torn.com/user/?selections=travel&key=${encodeURIComponent(u.tornApiKey)}`
          );
          if (tornRes.data.error) return null;
          return {
            id: u.tornPlayerId,
            name: factionMember.name,
            position: factionMember.position,
            travel: tornRes.data.travel
          };
        } catch { return null; }
      })
    );

    const enriched = travelResults.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value);
    const enrichedIds = new Set(enriched.map(e => e.id));
    const basicOnly = travelingMembers
      .filter(m => !enrichedIds.has(m.id))
      .map(m => ({ id: m.id, name: m.name, position: m.position, description: m.status.description, travel: null }));

    res.json({
      traveling: [...enriched, ...basicOnly].sort((a, b) => a.name.localeCompare(b.name)),
      total: travelingMembers.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Faction member crime skills ─────────────────────────────────────────
app.get('/api/faction/member-skills', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) {
      return res.status(400).json({ error: 'No faction API key configured.' });
    }

    // Get faction members first
    const encodedKey = encodeURIComponent(factionKey.trim());
    const factionRes = await axios.get(
      `https://api.torn.com/v2/faction/?selections=basic,members&key=${encodedKey}`
    );
    const members = factionRes.data.members || [];

    // Get users with API keys from DB
    const dbUsers = await User.find({ tornApiKey: { $ne: null } }, 'tornApiKey tornPlayerId tornName');
    const dbByTornId = {};
    dbUsers.forEach(u => { if (u.tornPlayerId) dbByTornId[u.tornPlayerId] = u; });

    // The crime skills we care about
    const SKILL_KEYS = [
      'bootlegging', 'burglary', 'card_skimming', 'cracking', 'disposal',
      'forgery', 'graffiti', 'hunting', 'hustling', 'pickpocketing',
      'racing', 'reviving', 'search_for_cash', 'shoplifting', 'scammin', 'arson'
    ];

    // Fetch skills for each member that has an API key
    const results = await Promise.allSettled(
      members.map(async (m) => {
        const dbUser = dbByTornId[m.id];
        if (!dbUser?.tornApiKey) {
          return {
            player_id: m.id,
            name: m.name,
            position: m.position,
            level: m.level,
            days_in_faction: m.days_in_faction,
            skills: null
          };
        }

        try {
          const skillsRes = await axios.get(
            `https://api.torn.com/v2/user/skills?key=${encodeURIComponent(dbUser.tornApiKey)}`,
            { timeout: 10000 }
          );

          if (skillsRes.data.error) {
            return {
              player_id: m.id,
              name: m.name,
              position: m.position,
              level: m.level,
              days_in_faction: m.days_in_faction,
              skills: null
            };
          }

          // Extract crime skills from the response
          // The API returns skills as an array of objects, e.g.:
          // { "skills": [ { "name": "Bootlegging", "level": 25.75 }, ... ] }
          const skillsArray = skillsRes.data.skills || [];
          
          // Build a lookup map from the array: name -> level
          const skillMap = {};
          if (Array.isArray(skillsArray)) {
            skillsArray.forEach(skill => {
              if (skill && skill.name) {
                // Normalize the name: lowercase, replace spaces with underscores
                const normalized = skill.name.toLowerCase().replace(/\s+/g, '_');
                skillMap[normalized] = skill.level || 0;
              }
            });
          }
          
          const extracted = {};
          SKILL_KEYS.forEach(key => {
            extracted[key] = skillMap[key] || 0;
          });

          return {
            player_id: m.id,
            name: m.name,
            position: m.position,
            level: m.level,
            days_in_faction: m.days_in_faction,
            skills: extracted
          };
        } catch {
          return {
            player_id: m.id,
            name: m.name,
            position: m.position,
            level: m.level,
            days_in_faction: m.days_in_faction,
            skills: null
          };
        }
      })
    );

    const skillData = results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    res.json({ skills: skillData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Travel status from Torn ────────────────────────────────────────────
app.get('/api/torn/travel', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=travel&key=${encodeURIComponent(dbUser.tornApiKey)}`
    );
    if (tornRes.data.error) {
      return res.status(400).json({ error: tornRes.data.error.error });
    }
    res.json(tornRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Torn item catalog ──────────────────────────────────────────────────
app.get('/api/torn/items', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(dbUser.tornApiKey)}`
    );
    if (tornRes.data.error) {
      return res.status(400).json({ error: tornRes.data.error.error });
    }
    res.json(tornRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Userscript install endpoint ────────────────────────────────────────────
app.get('/js/ssg-stock-observer.user.js', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const scriptPath = path.join(__dirname, 'public', 'js', 'ssg-stock-observer.user.js');

  fs.readFile(scriptPath, 'utf8', (err, data) => {
    if (err) {
      return res.status(404).send('Userscript not found');
    }
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Content-Disposition', 'attachment; filename="ssg-stock-observer.user.js"');
    res.send(data);
  });
});

// ─── API: YATA foreign stock data ────────────────────────────────────────────
app.get('/api/yata/travel', isAuthenticated, async (req, res) => {
  try {
    const yataRes = await axios.get('https://yata.yt/api/v1/travel/export/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000,
      maxRedirects: 5,
      withCredentials: false
    });
    res.json({ ...yataRes.data, source: 'yata' });
  } catch (err) {
    console.error('YATA API error, trying Prometheus fallback:', err.message);
    try {
      const promRes = await axios.get('https://api.prombot.co.uk/api/travel', {
        headers: { 'User-Agent': 'SSG-Dashboard/1.0', 'Accept': 'application/json' },
        timeout: 15000
      });
      res.json({ ...promRes.data, source: 'prometheus' });
    } catch (promErr) {
      console.error('Prometheus API fallback also failed:', promErr.message);
      if (err.code === 'ECONNABORTED' || promErr.code === 'ECONNABORTED') {
        res.status(504).json({ error: 'Travel data APIs timed out. Please try again.' });
      } else {
        res.status(500).json({ error: 'Travel data APIs unavailable.', details: `YATA: ${err.message}, Prometheus: ${promErr.message}` });
      }
    }
  }
});

// ─── API: Travel Profits Calculator ───────────────────────────────────────────
app.get('/api/travel-profits', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    const apiKey = dbUser?.tornApiKey?.trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }

    let travelData;
    try {
      const yataRes = await axios.get('https://yata.yt/api/v1/travel/export/', {
        headers: { 'User-Agent': 'SSG-Dashboard/1.0' },
        timeout: 15000
      });
      travelData = yataRes.data;
    } catch (err) {
      try {
        const promRes = await axios.get('https://api.prombot.co.uk/api/travel', {
          headers: { 'User-Agent': 'SSG-Dashboard/1.0' },
          timeout: 15000
        });
        travelData = promRes.data;
      } catch (promErr) {
        return res.status(500).json({ error: 'Travel data APIs unavailable.' });
      }
    }

    const itemsRes = await axios.get(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(apiKey)}`, {
      timeout: 30000
    });

    const itemsData = itemsRes.data;
    if (itemsData.error) {
      return res.status(400).json({ error: 'Torn API error: ' + itemsData.error.error });
    }

    const itemCatalog = {};
    Object.entries(itemsData.items || {}).forEach(([id, item]) => {
      itemCatalog[id] = {
        id: parseInt(id),
        name: item.name,
        type: item.type,
        marketValue: item.market_value || 0
      };
    });

    const standardTravelTimes = {
      mex: 26, cay: 35, can: 41, haw: 134, uni: 159,
      arg: 167, swi: 175, jap: 225, chi: 242, uae: 271, sou: 297
    };
    const airstripTravelTimes = {
      mex: 18, cay: 25, can: 29, haw: 94, uni: 111,
      arg: 117, swi: 123, jap: 158, chi: 169, uae: 190, sou: 208
    };
    const privateTravelTimes = {
      mex: 13, cay: 18, can: 20, haw: 67, uni: 80,
      arg: 83, swi: 88, jap: 113, chi: 121, uae: 135, sou: 149
    };

    const currentMinute = new Date().getMinutes();
    let minutesUntilRestock = currentMinute < 30 ? 30 - currentMinute : 60 - currentMinute;

    const stockData = travelData.stocks || {};
    const profits = [];

    Object.entries(stockData).forEach(([countryCode, countryData]) => {
      const standardTime = standardTravelTimes[countryCode] || 120;
      const airstripTime = airstripTravelTimes[countryCode] || Math.round(standardTime * 0.7);
      const privateTime = privateTravelTimes[countryCode] || Math.round(standardTime * 0.5);

      (countryData.stocks || []).forEach(stockItem => {
        const catalogItem = itemCatalog[stockItem.id] || itemCatalog[String(stockItem.id)] || itemCatalog[Number(stockItem.id)];
        const outOfStock = !stockItem.quantity || stockItem.quantity <= 0;

        // Skip items not in the catalog and with no market value (can't calculate profit)
        if (!catalogItem || catalogItem.marketValue <= 0) return;

        const profit = catalogItem.marketValue - stockItem.cost;

        const profitPercent = ((profit / stockItem.cost) * 100);
        const estimatedRestockIn = minutesUntilRestock;
        const nextRestockTime = new Date();
        nextRestockTime.setMinutes(nextRestockTime.getMinutes() + estimatedRestockIn);
        const travelTimeStandard = standardTime;
        const minutesUntilLeave = Math.max(0, estimatedRestockIn - travelTimeStandard);
        const leaveTime = new Date();
        leaveTime.setMinutes(leaveTime.getMinutes() + minutesUntilLeave);
        const leaveTimeStr = leaveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        profits.push({
          id: stockItem.id,
          name: catalogItem.name,
          type: catalogItem.type,
          country: countryCode,
          countryName: countryData.name || countryCode,
          quantity: stockItem.quantity,
          outOfStock: outOfStock,
          buyPrice: stockItem.cost,
          marketValue: catalogItem.marketValue,
          profit: profit,
          profitPercent: profitPercent,
          estimatedRestockIn: estimatedRestockIn,
          nextRestockTime: nextRestockTime.toISOString(),
          bestLeaveTime: leaveTimeStr,
          minutesUntilLeave: minutesUntilLeave,
          profitPerMinute: {
            standard: profit / standardTime,
            airstrip: profit / airstripTime,
            private: profit / privateTime
          },
          travelTimes: {
            standard: standardTime,
            airstrip: airstripTime,
            private: privateTime
          }
        });
      });
    });

    profits.sort((a, b) => b.profitPerMinute.standard - a.profitPerMinute.standard);

    res.json({
      profits,
      lastUpdated: new Date().toISOString(),
      summary: {
        totalItems: profits.length,
        totalPotentialProfit: profits.reduce((sum, p) => sum + (p.profit * p.quantity), 0),
        avgProfitPercent: profits.length > 0
          ? profits.reduce((sum, p) => sum + p.profitPercent, 0) / profits.length
          : 0
      }
    });
  } catch (err) {
    console.error('Travel Profits API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch travel profits data: ' + err.message });
  }
});

// ─── API: War debug - raw data inspection ────────────────────────────────────
app.get('/api/torn/wars-debug', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const warsRes = await axios.get(`https://api.torn.com/v2/faction/?selections=wars&key=${factionKey}`);
    const warData = warsRes.data;
    const rankedWar = warData.wars?.ranked;
    const warStart = rankedWar?.start || 0;
    const warEnd = rankedWar?.end || null;
    const warFactions = rankedWar?.factions || [];
    const enemyFaction = warFactions.find(f => f.id !== SSG_FACTION_ID);
    const enemyFactionId = enemyFaction?.id || null;

    // Fetch attacks during the war window and show result distribution
    let warAttacks = [];
    let nextUrl = `https://api.torn.com/v2/faction/attacks?limit=100&sort=desc&key=${factionKey}`;
    let reachedWarStart = false;
    let pageCount = 0;

    while (nextUrl && !reachedWarStart && pageCount < 5) {
      const attacksRes = await axios.get(nextUrl);
      const attacks = attacksRes.data.attacks || [];
      const prevLink = attacksRes.data._metadata?.links?.prev;
      pageCount++;

      for (const attack of attacks) {
        if (attack.started < warStart) { reachedWarStart = true; break; }
        if (warEnd && attack.started > warEnd) continue;
        if (attack.is_ranked_war && attack.attacker?.faction?.id === SSG_FACTION_ID) {
          const defFactionId = attack.defender?.faction?.id ?? null;
          if (!enemyFactionId || defFactionId === enemyFactionId) {
            warAttacks.push({
              id: attack.id,
              attacker: attack.attacker?.name,
              defender: attack.defender?.name,
              defenderFaction: attack.defender?.faction,
              result: attack.result,
              respect_gain: attack.respect_gain,
              is_ranked_war: attack.is_ranked_war,
              started: attack.started
            });
          }
        }
      }
      nextUrl = !reachedWarStart && prevLink ? prevLink + `&key=${factionKey}` : null;
    }

    // Count result types
    const resultCounts = {};
    warAttacks.forEach(a => {
      resultCounts[a.result] = (resultCounts[a.result] || 0) + 1;
    });

    res.json({
      rankedWar: rankedWar || null,
      enemyFactionId,
      warAttackCount: warAttacks.length,
      resultDistribution: resultCounts,
      sampleWarAttacks: warAttacks.slice(0, 10)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: War hits tracking ───────────────────────────────────────────────────
app.get('/api/torn/wars', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const warsRes = await axios.get(`https://api.torn.com/v2/faction/?selections=wars&key=${factionKey}`);
    const warData = warsRes.data;
    const rankedWar = warData.wars?.ranked;
    const warStart = rankedWar?.start || 0;
    const warEnd = rankedWar?.end || null; // null means war is still ongoing

    if (!warStart) {
      return res.json({ war: null, memberHits: [], totalWarAttacks: 0 });
    }

    // Determine the enemy faction ID from the war data (factions is an array)
    const warFactions = rankedWar?.factions || [];
    const enemyFaction = warFactions.find(f => f.id !== SSG_FACTION_ID);
    const enemyFactionId = enemyFaction?.id || null;

    let allAttacks = [];
    let nextUrl = `https://api.torn.com/v2/faction/attacks?limit=100&sort=desc&key=${factionKey}`;
    let reachedWarStart = false;

    while (nextUrl && !reachedWarStart) {
      const attacksRes = await axios.get(nextUrl);
      const attacks = attacksRes.data.attacks || [];
      const prevLink = attacksRes.data._metadata?.links?.prev;

      for (const attack of attacks) {
        // Stop once we've gone past the war start time
        if (attack.started < warStart) { reachedWarStart = true; break; }

        // Skip attacks that happened after the war ended (post-war attacks)
        if (warEnd && attack.started > warEnd) continue;

        // Only count: ranked war attacks, by SSG members, against the enemy faction
        const defenderFactionId = attack.defender?.faction?.id ?? null;
        const isValidTarget = attack.is_ranked_war &&
          attack.attacker?.faction?.id === SSG_FACTION_ID &&
          (!enemyFactionId || defenderFactionId === enemyFactionId);

        if (isValidTarget) {
          const isWin = attack.result === 'Attacked' || attack.result === 'Hospitalized';
          const isAssist = attack.result === 'Assist';
          if (isWin || isAssist) {
            allAttacks.push({ ...attack, _isAssist: isAssist });
          }
        }
      }

      nextUrl = !reachedWarStart && prevLink ? prevLink + `&key=${factionKey}` : null;
    }

    const hitCounts = {};
    allAttacks.forEach(a => {
      const id = a.attacker.id;
      const name = a.attacker.name;
      if (!hitCounts[id]) hitCounts[id] = { id, name, hits: 0, assists: 0, respect: 0 };
      if (a._isAssist) {
        hitCounts[id].assists++;
      } else {
        hitCounts[id].hits++;
        hitCounts[id].respect += a.respect_gain || 0;
      }
    });

    const memberHits = Object.values(hitCounts).sort((a, b) => b.hits - a.hits || b.assists - a.assists);

    res.json({
      war: warData.wars?.ranked || null,
      memberHits,
      totalWarAttacks: memberHits.reduce((sum, m) => sum + m.hits, 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: War enemy stats (FFScouter get-stats) ───────────────────────────────
app.get('/api/war/enemy-stats', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    // First check if there's an active war
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const warsRes = await axios.get(`https://api.torn.com/v2/faction/?selections=wars&key=${factionKey}`);
    const rankedWar = warsRes.data.wars?.ranked;

    if (!rankedWar || !rankedWar.start) {
      return res.json({ enemies: [], message: 'No active war found.' });
    }

    // Get enemy faction ID
    const warFactions = rankedWar.factions || [];
    const enemyFaction = warFactions.find(f => f.id !== SSG_FACTION_ID);
    const enemyFactionId = enemyFaction?.id;

    if (!enemyFactionId) {
      return res.json({ enemies: [], message: 'No enemy faction found.' });
    }

    // Find a user with FFScouter key
    const dbUser = await User.findOne({ ffScouterKey: { $ne: null } }, 'ffScouterKey');
    if (!dbUser?.ffScouterKey) {
      return res.status(400).json({ error: 'No FFScouter API key available. Please save one in the Targets section.' });
    }

    // Fetch the enemy faction's full roster from Torn first so enemy stats are
    // available even before any war attacks have been logged (important when a
    // war has just been matched).
    const warStart = rankedWar.start;
    const warEnd = rankedWar.end || null;
    const tornMemberMap = {};
    const enemyMembersMap = new Map();

    try {
      const encodedFactionKey = encodeURIComponent(factionKey.trim());
      const enemyFactionRes = await axios.get(
        `https://api.torn.com/v2/faction/${enemyFactionId}?selections=basic,members&key=${encodedFactionKey}`
      );

      // Torn API v2 returns members as an object keyed by player ID (fall back
      // to a plain array just in case). Normalize to a real array of members.
      const rawEnemyMembers = enemyFactionRes.data.members || {};
      const enemyMembers = Array.isArray(rawEnemyMembers)
        ? rawEnemyMembers
        : Object.values(rawEnemyMembers);

      console.log('[Enemy Stats] Found', enemyMembers.length, 'enemy faction members.');

      enemyMembers.forEach(m => {
        if (!m.id) return;
        tornMemberMap[m.id] = {
          level: m.level,
          status: m.status?.description || m.status?.state || 'Unknown',
          statusState: m.status?.state || 'Unknown',
          statusColor: m.status?.color || null,
          name: m.name,
          isRevivable: m.is_revivable
        };
        enemyMembersMap.set(m.id, m.name || null);
      });
    } catch (err) {
      console.error('Error fetching enemy faction members:', err.message);
    }

    // Fall back to scanning war attacks to pick up any enemy members who may
    // have been missed by the roster (e.g. recent joiners/leavers), but never
    // require attacks to have happened before showing stats.
    let nextUrl = `https://api.torn.com/v2/faction/attacks?limit=100&sort=desc&key=${factionKey}`;
    let reachedWarStart = false;

    while (nextUrl && !reachedWarStart) {
      const attacksRes = await axios.get(nextUrl);
      const attacks = attacksRes.data.attacks || [];
      const prevLink = attacksRes.data._metadata?.links?.prev;

      for (const attack of attacks) {
        if (attack.started < warStart) { reachedWarStart = true; break; }
        if (warEnd && attack.started > warEnd) continue;

        if (!attack.is_ranked_war) continue;

        const candidates = [];
        if (attack.defender?.faction?.id === enemyFactionId) {
          candidates.push([attack.defender.id, attack.defender.name]);
        }
        if (attack.attacker?.faction?.id === enemyFactionId) {
          candidates.push([attack.attacker.id, attack.attacker.name]);
        }
        for (const [pid, pname] of candidates) {
          if (pid && !enemyMembersMap.has(pid)) {
            enemyMembersMap.set(pid, pname || null);
          }
        }
      }

      nextUrl = !reachedWarStart && prevLink ? prevLink + `&key=${factionKey}` : null;
    }

    if (enemyMembersMap.size === 0) {
      return res.json({ enemies: [], message: 'No enemy members found for this war.' });
    }

    // Get player IDs for FFScouter stats lookup, batching in chunks so we stay
    // within FFScouter's per-request target limit (205).
    const targetIdsList = Array.from(enemyMembersMap.keys());
    const FF_BATCH_SIZE = 150;
    const statsMap = {};

    for (let i = 0; i < targetIdsList.length; i += FF_BATCH_SIZE) {
      const chunk = targetIdsList.slice(i, i + FF_BATCH_SIZE);
      const targetIds = chunk.join(',');

      const ffRes = await axios.get('https://ffscouter.com/api/v1/get-stats', {
        params: { key: dbUser.ffScouterKey, targets: targetIds },
        timeout: 15000
      });

      if (ffRes.data?.error) {
        return res.status(400).json({ error: 'FFScouter error: ' + ffRes.data.error });
      }

      // FFScouter returns an array directly (not nested under .stats)
      const ffStats = Array.isArray(ffRes.data) ? ffRes.data : (ffRes.data?.stats || []);
      if (Array.isArray(ffStats)) {
        ffStats.forEach(s => {
          if (s.player_id) statsMap[s.player_id] = s;
        });
      }
    }

    // Process enemy members with data from both Torn API and FFScouter
    const enemies = Array.from(enemyMembersMap.entries()).map(([id, attackName]) => {
      const tornData = tornMemberMap[id] || {};
      const stats = statsMap[id] || {};
      // Name priority: Torn API > FFScouter > Attack data > fallback
      const name = tornData.name || stats.name || attackName || `Player ${id}`;
      // Level and status from Torn API (more reliable)
      const level = tornData.level || stats.level || 0;
      const status = tornData.status || stats.status || 'Unknown';
      // Battle stats estimate from FFScouter only
      const totalStats = stats.bs_estimate || 0;
      const fairFight = stats.fair_fight || null;

      return {
        id: parseInt(id),
        name: name,
        level: level,
        totalStats: totalStats,
        fairFight: fairFight,
        status: status,
        statusState: tornData.statusState || 'Unknown',
        statusColor: tornData.statusColor || null,
        travel: null,
        isRevivable: tornData.isRevivable !== undefined ? tornData.isRevivable : null
      };
    });

    // Cache the result
    setCached('war-enemy-stats', { enemies, enemyFactionId, enemyFactionName: enemyFaction?.name }, CACHE_TTL.FACTION_MEMBERS);

    res.json({
      enemies,
      enemyFactionId,
      enemyFactionName: enemyFaction?.name
    });
  } catch (err) {
    console.error('Enemy stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: War target comparison (Ownership only) ─────────────────────────────
app.get('/api/war/target-comparison', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    // Check for active war
    const warsRes = await axios.get(`https://api.torn.com/v2/faction/?selections=wars&key=${factionKey}`);
    const rankedWar = warsRes.data.wars?.ranked;
    if (!rankedWar || !rankedWar.start) {
      return res.status(400).json({ error: 'No active war found.' });
    }

    const warFactions = rankedWar.factions || [];
    const enemyFaction = warFactions.find(f => f.id !== SSG_FACTION_ID);
    const enemyFactionId = enemyFaction?.id;
    const enemyFactionName = enemyFaction?.name || 'Unknown';
    if (!enemyFactionId) {
      return res.status(400).json({ error: 'No enemy faction found.' });
    }

    // Get SSG members with effective battle stats
    const factionRes = await axios.get(`https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`);
    // Torn API v2 returns members as an object keyed by player ID
    const factionMembersArr = Object.values(factionRes.data.members || {});

    const dbUsers = await User.find({ tornApiKey: { $ne: null } }, 'tornApiKey tornPlayerId tornName');
    const dbByTornId = {};
    dbUsers.forEach(u => { if (u.tornPlayerId) dbByTornId[u.tornPlayerId] = u; });

    const ssgMembers = [];
    for (const m of factionMembersArr) {
      const dbUser = dbByTornId[m.id];
      if (!dbUser?.tornApiKey) continue;

      try {
        const [basicRes, battleRes] = await Promise.all([
          axios.get(`https://api.torn.com/user/?selections=basic,personalstats&key=${dbUser.tornApiKey}`),
          axios.get(`https://api.torn.com/user/?selections=battlestats&key=${dbUser.tornApiKey}`)
        ]);

        if (basicRes.data.error || battleRes.data.error) continue;

        const ps = basicRes.data.personalstats || {};
        const bs = battleRes.data;
        
        // Calculate effective stats with modifiers
        const strengthMod = parseFloat(bs.strength_modifier) || 0;
        const defenseMod = parseFloat(bs.defense_modifier) || 0;
        const speedMod = parseFloat(bs.speed_modifier) || 0;
        const dexterityMod = parseFloat(bs.dexterity_modifier) || 0;

        const effectiveStrength = Math.round((ps.strength || 0) * (1 + strengthMod / 100));
        const effectiveDefense = Math.round((ps.defense || 0) * (1 + defenseMod / 100));
        const effectiveSpeed = Math.round((ps.speed || 0) * (1 + speedMod / 100));
        const effectiveDexterity = Math.round((ps.dexterity || 0) * (1 + dexterityMod / 100));
        const effectiveTotal = effectiveStrength + effectiveDefense + effectiveSpeed + effectiveDexterity;

        ssgMembers.push({
          id: m.id,
          name: basicRes.data.name || m.name,
          totalStats: effectiveTotal,
          position: m.position
        });
      } catch (err) {
        console.error(`Error fetching stats for member ${m.id}:`, err.message);
      }
    }

    // Get enemy members from the enemy faction's full roster (matching the Enemy
    // Stats table) so the comparison is based on the war faction's members
    // rather than only on players who have appeared in war attacks.
    const enemyMemberMap = new Map();

    try {
      const encodedFactionKey = encodeURIComponent(factionKey.trim());
      const enemyFactionRes = await axios.get(
        `https://api.torn.com/v2/faction/${enemyFactionId}?selections=basic,members&key=${encodedFactionKey}`
      );

      const rawEnemyMembers = enemyFactionRes.data.members || {};
      const enemyFactionMembers = Array.isArray(rawEnemyMembers)
        ? rawEnemyMembers
        : Object.values(rawEnemyMembers);

      enemyFactionMembers.forEach(m => {
        if (m.id) enemyMemberMap.set(m.id, m.name || null);
      });
    } catch (err) {
      console.error('Error fetching enemy faction members for comparison:', err.message);
    }

    // Fall back to scanning war attacks to pick up any enemy members who may
    // have been missed by the roster (e.g. recent joiners/leavers).
    let nextUrl = `https://api.torn.com/v2/faction/attacks?limit=100&sort=desc&key=${factionKey}`;
    let reachedWarStart = false;

    while (nextUrl && !reachedWarStart) {
      const attacksRes = await axios.get(nextUrl);
      const attacks = attacksRes.data.attacks || [];
      const prevLink = attacksRes.data._metadata?.links?.prev;

      for (const attack of attacks) {
        if (attack.started < rankedWar.start) { reachedWarStart = true; break; }
        if (rankedWar.end && attack.started > rankedWar.end) continue;

        if (!attack.is_ranked_war) continue;

        const candidates = [];
        if (attack.defender?.faction?.id === enemyFactionId) {
          candidates.push([attack.defender.id, attack.defender.name]);
        }
        if (attack.attacker?.faction?.id === enemyFactionId) {
          candidates.push([attack.attacker.id, attack.attacker.name]);
        }
        for (const [pid, pname] of candidates) {
          if (pid && !enemyMemberMap.has(pid)) {
            enemyMemberMap.set(pid, pname || null);
          }
        }
      }

      nextUrl = !reachedWarStart && prevLink ? prevLink + `&key=${factionKey}` : null;
    }

    if (enemyMemberMap.size === 0) {
      return res.status(400).json({ error: 'No enemy members found for this war.' });
    }

    // Find a user with FFScouter key
    const dbUserWithKey = await User.findOne({ ffScouterKey: { $ne: null } }, 'ffScouterKey');
    if (!dbUserWithKey?.ffScouterKey) {
      return res.status(400).json({ error: 'No FFScouter API key available. Please save one in the Targets section.' });
    }

    // Fetch FFScouter stats in batches to stay within the per-request limit (205).
    const targetIdsList = Array.from(enemyMemberMap.keys());
    const FF_BATCH_SIZE = 150;
    const statsMap = {};

    for (let i = 0; i < targetIdsList.length; i += FF_BATCH_SIZE) {
      const chunk = targetIdsList.slice(i, i + FF_BATCH_SIZE);
      const targetIds = chunk.join(',');

      const ffRes = await axios.get('https://ffscouter.com/api/v1/get-stats', {
        params: { key: dbUserWithKey.ffScouterKey, targets: targetIds },
        timeout: 15000
      });

      if (ffRes.data?.error) {
        return res.status(400).json({ error: 'FFScouter error: ' + ffRes.data.error });
      }

      const ffStats = Array.isArray(ffRes.data) ? ffRes.data : (ffRes.data?.stats || []);
      if (Array.isArray(ffStats)) {
        ffStats.forEach(s => {
          if (s.player_id) statsMap[s.player_id] = s;
        });
      }
    }

    // Build enemy members array
    const enemyMembers = Array.from(enemyMemberMap.entries()).map(([id, attackName]) => {
      const stats = statsMap[id] || {};
      const name = stats.name || attackName || `Player ${id}`;
      const totalStats = stats.bs_estimate || 0;
      return {
        id: parseInt(id),
        name,
        totalStats
      };
    });

    // Sort members by position, enemies by stats (descending)
    const positionOrder = {
      'Leader': 0, 'Co-leader': 1, 'Matriarch': 2, 'Leadership': 3, 'Warlord': 4,
      'Team_Strategy': 5, 'Team Strategy': 6, 'Team Strength': 7, 'Team Growth': 8, 'Recruit': 9
    };

    ssgMembers.sort((a, b) => {
      const aO = positionOrder[a.position] ?? 99;
      const bO = positionOrder[b.position] ?? 99;
      return aO !== bO ? aO - bO : a.name.localeCompare(b.name);
    });

    enemyMembers.sort((a, b) => (b.totalStats || 0) - (a.totalStats || 0));

    // Calculate hit matrix (member can hit if their stats >= 98% of enemy stats)
    const hitMatrix = ssgMembers.map(member => {
      const hits = enemyMembers.map(enemy => {
        const canHit = member.totalStats >= (enemy.totalStats * 0.98);
        return canHit ? '✅' : '❌';
      });
      return {
        memberName: member.name,
        memberId: member.id,
        hits
      };
    });

    // Format table for Discord
    const colWidth = 22;
    const headerRow = ['Member'.padEnd(colWidth), ...enemyMembers.map(e => {
      const label = e.name.length > 12 ? e.name.substring(0, 11) + '…' : e.name;
      return label.padEnd(colWidth);
    })].join(' | ');

    const separator = '─'.repeat(headerRow.length);

    const dataRows = hitMatrix.map(row => {
      const memberLabel = row.memberName.length > 20 ? row.memberName.substring(0, 19) + '…' : row.memberName;
      return [memberLabel.padEnd(colWidth), ...row.hits.map(h => h.padEnd(colWidth))].join(' | ');
    });

    const tableText = [headerRow, separator, ...dataRows].join('\n');

    // Send email
    const { sendWarTargetComparison } = require('./services/snapshotService');
    const emailResult = await sendWarTargetComparison(tableText, enemyFactionName);

    res.json({
      success: true,
      tableText,
      enemyFactionName,
      memberCount: ssgMembers.length,
      enemyCount: enemyMembers.length,
      emailResult
    });
  } catch (err) {
    console.error('War target comparison error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Member total stats ──────────────────────────────────────────────────
app.get('/api/admin/member-stats', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    // Exclude employee (non-faction) accounts from leadership views
    const dbUsers = await User.find({ tornApiKey: { $ne: null }, accountType: { $ne: 'employee' } }, 'tornApiKey username');

    const results = await Promise.allSettled(
      dbUsers.map(async (u) => {
        try {
          const tornRes = await axios.get(
            `https://api.torn.com/user/?selections=basic,personalstats&key=${u.tornApiKey}`
          );
          if (tornRes.data.error) return null;
          return {
            name: tornRes.data.name,
            player_id: tornRes.data.player_id,
            level: tornRes.data.level,
            totalstats: tornRes.data.personalstats?.totalstats || 0,
            strength: tornRes.data.personalstats?.strength || 0,
            defense: tornRes.data.personalstats?.defense || 0,
            speed: tornRes.data.personalstats?.speed || 0,
            dexterity: tornRes.data.personalstats?.dexterity || 0,
            manuallabor: tornRes.data.personalstats?.manuallabor || 0,
            intelligence: tornRes.data.personalstats?.intelligence || 0,
            endurance: tornRes.data.personalstats?.endurance || 0,
          };
        } catch { return null; }
      })
    );

    res.json({
      stats: results.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: War member overview ─────────────────────────────────────────────────
app.get('/api/war/member-overview', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const factionRes = await axios.get(`https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`);
    const factionMembers = factionRes.data.members || [];

    const dbUsers = await User.find({}, 'tornPlayerId tornName tornApiKey lastSeen tornKeyUpdatedAt');
    const dbByTornId = {};
    dbUsers.forEach(u => { if (u.tornPlayerId) dbByTornId[u.tornPlayerId] = u; });

    const enrichResults = await Promise.allSettled(
      factionMembers.map(async m => {
        const dbUser = dbByTornId[m.id];
        const base = {
          id: m.id,
          name: m.name,
          level: m.level,
          position: m.position,
          days_in_faction: m.days_in_faction,
          last_action: m.last_action,
          revive_setting: m.revive_setting,
          status: m.status,
          hasApiKey: !!dbUser?.tornApiKey,
          lastSeen: dbUser?.lastSeen || null,
          tornKeyUpdatedAt: dbUser?.tornKeyUpdatedAt || null,
          property: null,
          job: null,
          energy: null,
          cooldowns: null,
          tornLastAction: null
        };

        if (!dbUser?.tornApiKey) return base;

        try {
          const [v1Res, v2Res] = await Promise.all([
            axios.get(`https://api.torn.com/user/?selections=basic,profile,bars&key=${dbUser.tornApiKey}`),
            axios.get(`https://api.torn.com/v2/user/?selections=cooldowns&key=${dbUser.tornApiKey}`)
          ]);
          if (!v1Res.data.error) {
            base.property = v1Res.data.property || null;
            base.job = v1Res.data.job || null;
            base.energy = v1Res.data.energy || null;
            base.tornLastAction = v1Res.data.last_action || null;
          }
          if (!v2Res.data.error) {
            base.cooldowns = v2Res.data.cooldowns || null;
          }
        } catch { /* enrichment failed */ }

        return base;
      })
    );

    res.json({
      members: enrichResults.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Admin member overview ───────────────────────────────────────────────
app.get('/api/admin/member-overview', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const factionRes = await axios.get(`https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`);
    const factionMembers = factionRes.data.members || [];

    const dbUsers = await User.find({}, 'tornPlayerId tornName tornApiKey lastSeen tornKeyUpdatedAt');
    const dbByTornId = {};
    dbUsers.forEach(u => { if (u.tornPlayerId) dbByTornId[u.tornPlayerId] = u; });

    const enrichResults = await Promise.allSettled(
      factionMembers.map(async m => {
        const dbUser = dbByTornId[m.id];
        const base = {
          id: m.id,
          name: m.name,
          level: m.level,
          position: m.position,
          days_in_faction: m.days_in_faction,
          last_action: m.last_action,
          revive_setting: m.revive_setting,
          status: m.status,
          hasApiKey: !!dbUser?.tornApiKey,
          lastSeen: dbUser?.lastSeen || null,
          tornKeyUpdatedAt: dbUser?.tornKeyUpdatedAt || null,
          property: null,
          job: null,
          energy: null,
          cooldowns: null,
          tornLastAction: null,
          // Battle stats (only for members with API key)
          strength: null,
          defense: null,
          speed: null,
          dexterity: null,
          totalstats: null
        };

        if (!dbUser?.tornApiKey) return base;

        try {
          const [v1Res, v2Res, statsRes] = await Promise.all([
            axios.get(`https://api.torn.com/user/?selections=basic,profile,bars&key=${dbUser.tornApiKey}`),
            axios.get(`https://api.torn.com/v2/user/?selections=cooldowns&key=${dbUser.tornApiKey}`),
            axios.get(`https://api.torn.com/user/?selections=personalstats&key=${dbUser.tornApiKey}`)
          ]);
          if (!v1Res.data.error) {
            base.property = v1Res.data.property || null;
            base.job = v1Res.data.job || null;
            base.energy = v1Res.data.energy || null;
            base.tornLastAction = v1Res.data.last_action || null;
          }
          if (!v2Res.data.error) {
            base.cooldowns = v2Res.data.cooldowns || null;
          }
          if (!statsRes.data.error && statsRes.data.personalstats) {
            const ps = statsRes.data.personalstats;
            base.strength = ps.strength || 0;
            base.defense = ps.defense || 0;
            base.speed = ps.speed || 0;
            base.dexterity = ps.dexterity || 0;
            base.totalstats = ps.totalstats || 0;
            base.manuallabor = ps.manuallabor || 0;
            base.intelligence = ps.intelligence || 0;
            base.endurance = ps.endurance || 0;
          }
        } catch { /* enrichment failed */ }

        return base;
      })
    );

    res.json({
      members: enrichResults.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Weapon & Armor Inventory ──────────────────────────────────────────────
app.get('/api/admin/weapon-armor-inventory', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    // Fetch armor and weapon data
    let armorData = [];
    let weaponsData = [];

    try {
      const encodedKey = encodeURIComponent(factionKey);
      const armorRes = await axios.get(`https://api.torn.com/faction/?selections=armor&key=${encodedKey}`);
      armorData = armorRes.data.armor || [];
    } catch (err) {
      console.error('Error fetching armor data:', err.message);
    }

    try {
      const weaponsRes = await axios.get(`https://api.torn.com/faction/?selections=weapons&key=${encodeURIComponent(factionKey)}`);
      weaponsData = weaponsRes.data.weapons || [];
    } catch (err) {
      console.error('Error fetching weapon data:', err.message);
    }

    // Build inventory items
    const items = [];

    // Add armor items
    armorData.forEach(item => {
      const name = (item.name || '').toLowerCase();
      let slot = null;
      if (name.includes('helmet') || name.includes('hood') || name.includes('hat')) slot = 'head';
      else if (name.includes('armor') || name.includes('vest') || name.includes('suit') || name.includes('jacket') || name.includes('coat') || name.includes('poncho')) slot = 'body';
      else if (name.includes('glove') || name.includes('gloves') || name.includes('mitts') || name.includes('hand')) slot = 'gloves';
      else if (name.includes('pant') || name.includes('trouser') || name.includes('jean') || name.includes('leg') || name.includes('short')) slot = 'pants';
      else if (name.includes('boot') || name.includes('shoe') || name.includes('sneaker') || name.includes('sand') || name.includes('foot')) slot = 'boots';

      if (slot) {
        items.push({
          name: item.name,
          type: 'Armor',
          slot: slot,
          total: item.quantity || 0,
          loaned: item.loaned || 0,
          available: item.available || 0
        });
      }
    });

    // Add weapon items
    weaponsData.forEach(item => {
      const slot = (item.type || '').toLowerCase();
      let weaponSlot = null;
      if (slot === 'primary') weaponSlot = 'primary';
      else if (slot === 'secondary') weaponSlot = 'secondary';
      else if (slot === 'melee') weaponSlot = 'melee';

      if (weaponSlot) {
        items.push({
          name: item.name,
          type: 'Weapon',
          slot: weaponSlot,
          total: item.quantity || 0,
          loaned: item.loaned || 0,
          available: item.available || 0
        });
      }
    });

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Medical Inventory ─────────────────────────────────────────────────────
app.get('/api/admin/medical-inventory', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    // Fetch medical data from faction API
    let medicalData = [];

    try {
      const medicalRes = await axios.get(`https://api.torn.com/faction/?selections=medical&key=${factionKey}`);
      medicalData = medicalRes.data.medical || [];
    } catch (err) {
      console.error('Error fetching medical data:', err.message);
    }

    // Build inventory items - only show name and quantity
    const items = medicalData.map(item => ({
      name: item.name || 'Unknown',
      quantity: item.quantity || 0
    }));

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── API: Drug Inventory ────────────────────────────────────────────────────────
app.get('/api/admin/drug-inventory', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    // Fetch drugs data from faction API
    let drugData = [];

    try {
      const drugRes = await axios.get(`https://api.torn.com/faction/?selections=drugs&key=${factionKey}`);
      drugData = drugRes.data.drugs || [];
    } catch (err) {
      console.error('Error fetching drug data:', err.message);
    }

    // Build inventory items - only show name and quantity
    const items = drugData.map(item => ({
      name: item.name || 'Unknown',
      quantity: item.quantity || 0
    }));

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OC 2.0 Item Roles (Utilities armory) ─────────────────────────────────────
// Each organized crime has a set of Tools (loaned out from the Utilities armory and
// returned after the crime) and Materials (consumed / used up during the crime — no
// return needed). An item can be a tool in one crime and a material in another
// (e.g. Hand Drill), so classification is keyed by crime name, NOT only by item.
// Quantities (e.g. "2 x Jemmy") are collapsed — we only need the canonical name.
const OC_ITEM_ROLES = {
  'First Aid and Abet':    { tools: ['Lockpicks'],                          materials: ['Shaving Foam'] },
  'Mob Mentality':         { tools: ['Jemmy'],                              materials: [] },
  'Pet Project':           { tools: ['Net', 'Lockpicks'],                   materials: ['Dog Treats'] },
  'Thou Shalt Not Steal':  { tools: ['Lockpicks', 'Cassock'],               materials: ['Cell Phone'] },
  'Cash Me If You Can':    { tools: [],                                     materials: ['ID Badge', 'ATM Key'] },
  'Best of the Lot':       { tools: ['Lockpicks', 'Police Badge'],          materials: [] },
  'Smoke and Wing Mirrors':{ tools: ['DSLR Camera', 'RF Detector'],         materials: [] },
  'Market Forces':         { tools: [],                                     materials: ['Gasoline'] },
  'Gaslight the Way':      { tools: ['Construction Helmet'],                materials: ['ID Badge'] },
  'Snow Blind':            { tools: [],                                     materials: ['PCP'] },
  'Plucking the Lotus Petal': { tools: [],                                  materials: ['Blank Casino Chips'] },
  'Stage Fright':          { tools: ['Binoculars'],                         materials: [] },
  'Guardian Angels':       { tools: [],                                     materials: ['Hand Drill'] },
  'Honey Trap':            { tools: ['Billfold'],                           materials: [] },
  'Counter Offer':         { tools: ['Wire Cutters', 'Lockpicks'],          materials: ['Zip Ties', 'Polymorphic Virus'] },
  'No Reserve':            { tools: ['Bolt Cutters'],                       materials: ['Spray Paint', 'Chloroform'] },
  'Bidding War':           { tools: ['Jemmy', 'Dental Mirror'],             materials: ['C4 Explosive', 'Flash Grenade'] },
  'Leave No Trace':        { tools: ['Police Badge'],                       materials: [] },
  'Dish It Out':           { tools: ['Bolt Cutters', 'Wire Cutters'],       materials: ['Thermite', 'Ipecac Syrup'] },
  'Sneaky Git Grab':       { tools: ['Wireless Dongle'],                    materials: ['Tunneling Virus'] },
  'Blast from the Past':   { tools: ['Core Drill'],                         materials: ['Zip Ties', 'Shaped Charge', 'Firewalk Virus'] },
  'Window of Opportunity': { tools: ['Wire Cutters', 'Ladder', 'Angle Grinder'], materials: ['Razor Wire', 'Floor Cleaner'] },
  'Break the Bank':        { tools: ['Hand Drill'],                         materials: ['Zip Ties'] },
  'Stacking the Deck':     { tools: ['Jemmy'],                              materials: ['Smoke Grenade', 'ID Badge', 'Stealth Virus'] },
  'Manifest Cruelty':      { tools: ['Cigar Cutter', 'Car Battery'],        materials: ['Zip Ties', 'Stealth Virus'] },
  'Ace in the Hole':       { tools: [],                                     materials: ['ID Badge'] },
  'Gone Fission':          { tools: ['DSLR Camera', 'Cut-Throat Razor'],    materials: ['Zip Ties', 'Thermite', 'C4 Explosive'] }
};

// Normalize an item name for matching (case/punctuation/whitespace insensitive)
function normalizeItemName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(?:x\d+|\d+\s*x)\b/gi, ' ') // strip "2 x" / "2x" quantity markers
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Check whether the given item is a Tool or Material for a specific crime
function isCrimeItemType(crimeName, itemName, column) {
  const roles = OC_ITEM_ROLES[crimeName];
  if (!roles || !Array.isArray(roles[column])) return false;
  const target = normalizeItemName(itemName);
  if (!target) return false;
  return roles[column].some(n => {
    const norm = normalizeItemName(n);
    if (!norm) return false;
    if (norm === target) return true;
    // Lenient fallback for short/plural mismatches (e.g. "Lockpick" vs "Lockpicks").
    // Only applied when one name is reasonably long to avoid false positives.
    return (target.length >= 4 && (target.includes(norm) || norm.includes(target)));
  });
}

// Check whether an item is associated with a specific crime at all — i.e. it is
// either a Tool (loaned out and returned) or a Material (consumed) for that crime.
// Items such as personal-crime tools (e.g. Bucket, Cemetery Key) are NOT part of any
// OC, so although the holding member may have an active/complete crime, the loaned
// item itself is unrelated to that OC and should be reported as "No OC".
function isCrimeItem(crimeName, itemName) {
  return isCrimeItemType(crimeName, itemName, 'tools') ||
         isCrimeItemType(crimeName, itemName, 'materials');
}
// ─── API: Faction Loans (Armor & Weapons) ──────────────────────────────────────
app.get('/api/admin/faction-loans', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    // Fetch faction members list
    const factionRes = await axios.get(`https://api.torn.com/v2/faction/members?key=${encodeURIComponent(factionKey)}`);
    const factionMembers = factionRes.data.members || [];

    // Build member map with position
    const memberMap = {};
    factionMembers.forEach(m => {
      memberMap[m.id] = {
        id: m.id,
        name: m.name,
        position: m.position
      };
    });

    // Initialize loan tracking for each member
    const loansData = {};
    Object.entries(memberMap).forEach(([id, member]) => {
      loansData[id] = {
        ...member,
        primary: null,
        secondary: null,
        melee: null,
        head: null,
        body: null,
        gloves: null,
        pants: null,
        boots: null
      };
    });

    // Fetch armor and weapon data
    let armorData = [];
    let weaponsData = [];

    try {
      const armorRes = await axios.get(`https://api.torn.com/faction/?selections=armor&key=${factionKey}`);
      armorData = armorRes.data.armor || [];
    } catch (err) {
      console.error('Error fetching armor data:', err.message);
    }

    try {
      const weaponsRes = await axios.get(`https://api.torn.com/faction/?selections=weapons&key=${factionKey}`);
      weaponsData = weaponsRes.data.weapons || [];
    } catch (err) {
      console.error('Error fetching weapon data:', err.message);
    }

    // Process armor loans
    armorData.forEach(item => {
      if (!item.loaned_to || item.loaned === 0) return;

      const name = (item.name || '').toLowerCase();
      let armorSlot = null;

      // Determine slot from item name since type is just "Defensive"
      if (name.includes('helmet') || name.includes('hood') || name.includes('hat')) armorSlot = 'head';
      else if (name.includes('armor') || name.includes('vest') || name.includes('suit') || name.includes('jacket') || name.includes('coat') || name.includes('poncho')) armorSlot = 'body';
      else if (name.includes('glove') || name.includes('gloves') || name.includes('mitts') || name.includes('hand')) armorSlot = 'gloves';
      else if (name.includes('pant') || name.includes('trouser') || name.includes('jean') || name.includes('leg') || name.includes('short')) armorSlot = 'pants';
      else if (name.includes('boot') || name.includes('shoe') || name.includes('sneaker') || name.includes('sand') || name.includes('foot')) armorSlot = 'boots';

      if (!armorSlot) return;

      // loaned_to can be a string of comma-separated IDs or a single ID
      const ids = typeof item.loaned_to === 'string'
        ? item.loaned_to.split(',').map(id => id.trim())
        : [String(item.loaned_to)];

      ids.forEach(id => {
        if (loansData[id] && armorSlot) {
          loansData[id][armorSlot] = item.name;
        }
      });
    });

    // Process weapon loans
    weaponsData.forEach(item => {
      if (!item.loaned_to || item.loaned === 0) return;

      const slot = (item.type || '').toLowerCase();
      let weaponSlot = null;
      if (slot === 'primary') weaponSlot = 'primary';
      else if (slot === 'secondary') weaponSlot = 'secondary';
      else if (slot === 'melee') weaponSlot = 'melee';

      if (!weaponSlot) return;

      // loaned_to can be a string of comma-separated IDs or a single ID
      const ids = typeof item.loaned_to === 'string'
        ? item.loaned_to.split(',').map(id => id.trim())
        : [String(item.loaned_to)];

      ids.forEach(id => {
        if (loansData[id] && weaponSlot) {
          loansData[id][weaponSlot] = item.name;
        }
      });
    });

    // Calculate totals
    const totals = {
      primary: 0,
      secondary: 0,
      melee: 0,
      head: 0,
      body: 0,
      gloves: 0,
      pants: 0,
      boots: 0,
      total: 0
    };

    Object.values(loansData).forEach(member => {
      ['primary', 'secondary', 'melee', 'head', 'body', 'gloves', 'pants', 'boots'].forEach(slot => {
        if (member[slot]) {
          totals[slot]++;
          totals.total++;
        }
      });
    });

    // Build armory inventory summary from the API data
    const armoryItems = [];

    // Add armor items
    armorData.forEach(item => {
      const name = (item.name || '').toLowerCase();
      let slot = null;
      if (name.includes('helmet') || name.includes('hood') || name.includes('hat')) slot = 'head';
      else if (name.includes('armor') || name.includes('vest') || name.includes('suit') || name.includes('jacket') || name.includes('coat') || name.includes('poncho')) slot = 'body';
      else if (name.includes('glove') || name.includes('gloves') || name.includes('mitts') || name.includes('hand')) slot = 'gloves';
      else if (name.includes('pant') || name.includes('trouser') || name.includes('jean') || name.includes('leg') || name.includes('short')) slot = 'pants';
      else if (name.includes('boot') || name.includes('shoe') || name.includes('sneaker') || name.includes('sand') || name.includes('foot')) slot = 'boots';

      if (slot) {
        armoryItems.push({
          name: item.name,
          type: 'Armor',
          slot: slot,
          total: item.quantity || 0,
          loaned: item.loaned || 0,
          available: item.available || 0
        });
      }
    });

    // Add weapon items
    weaponsData.forEach(item => {
      const slot = (item.type || '').toLowerCase();
      let weaponSlot = null;
      if (slot === 'primary') weaponSlot = 'primary';
      else if (slot === 'secondary') weaponSlot = 'secondary';
      else if (slot === 'melee') weaponSlot = 'melee';

      if (weaponSlot) {
        armoryItems.push({
          name: item.name,
          type: 'Weapon',
          slot: weaponSlot,
          total: item.quantity || 0,
          loaned: item.loaned || 0,
          available: item.available || 0
        });
      }
    });

    res.json({
      members: Object.values(loansData),
      totals,
      armoryItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Utilities Inventory & Loans (Utilities armory + OC tie-in) ──────────
app.get('/api/admin/utilities-inventory', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    // Fetch the Utilities armory inventory from the Torn faction API
    let utilitiesData = [];
    try {
      const utilsRes = await axios.get(`https://api.torn.com/faction/?selections=utilities&key=${encodeURIComponent(factionKey)}`);
      const raw = utilsRes.data;
      if (Array.isArray(raw?.utilities)) utilitiesData = raw.utilities;
      else if (Array.isArray(raw?.items)) utilitiesData = raw.items;
      else if (Array.isArray(raw)) utilitiesData = raw;
    } catch (err) {
      console.error('Error fetching utilities data:', err.message);
    }

    // Fetch faction members for id -> name mapping
    let memberMap = {};
    try {
      const membersRes = await axios.get(`https://api.torn.com/v2/faction/members?key=${encodeURIComponent(factionKey)}`);
      const members = membersRes.data.members || [];
      members.forEach(m => { memberMap[m.id] = m.name; });
    } catch (err) {
      console.error('Error fetching faction members:', err.message);
    }

    // Build inventory summary (mirrors the Weapon & Armor tab)
    const items = utilitiesData.map(item => ({
      id: item.id || null,
      name: item.name || 'Unknown',
      type: item.type || '',
      total: item.quantity || 0,
      loaned: item.loaned || 0,
      available: item.available || 0
    }));

    // Collect loans (each utilities item loaned out to member(s))
    const playerIds = new Set();
    const loanTasks = [];
    utilitiesData.forEach(item => {
      if (!item.loaned_to || item.loaned === 0) return;
      let ids = [];
      if (typeof item.loaned_to === 'string') ids = item.loaned_to.split(',').map(s => s.trim());
      else if (Array.isArray(item.loaned_to)) ids = item.loaned_to;
      else ids = [String(item.loaned_to)];

      ids.forEach(id => {
        const playerId = parseInt(id);
        if (isNaN(playerId)) return;
        if (!playerIds.has(playerId)) playerIds.add(playerId);
        loanTasks.push({ playerId, itemId: item.id || null, itemName: item.name || 'Unknown' });
      });
    });

    // Best-effort refresh of OC data so loan -> crime mapping stays current (non-fatal)
    try {
      const { refreshFactionCrimes } = require('./services/tornCrimesService');
      await refreshFactionCrimes(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
    } catch (err) {
      console.error('Utilities tab: OC refresh error (non-fatal):', err.message);
    }
// Load the most recent tracked crime for each loaned player
    const playerCrimeMap = {};
    for (const playerId of [...playerIds]) {
      try {
        const crime = await OrganizedCrime.findOne({
          factionId: SSG_FACTION_ID,
          'participants.playerId': playerId
        }).sort({ timeStarted: -1 }).lean();
        playerCrimeMap[playerId] = crime;
      } catch (err) {
        console.error(`Utilities tab: error loading crime for player ${playerId}:`, err.message);
        playerCrimeMap[playerId] = null;
      }
    }

    // Assemble per-loan records tied to the player and their OC
    const loans = loanTasks.map(task => {
      const crime = playerCrimeMap[task.playerId];
      let role = '';
      let ocRoleMatch = false;
      let consumed = false;

      if (crime) {
        const participant = (crime.participants || []).find(p => p.playerId === task.playerId);
        role = participant?.role || '';
        ocRoleMatch = !!(participant?.tool) && normalizeItemName(participant.tool) === normalizeItemName(task.itemName);
        // An item is "consumed" only if the ITEM ITSELF is a material of the crime.
        // It must NOT be inferred from the participant's role tool column: a member's
        // role may require a material (e.g. "Dog Treats" in Pet Project), but that has
        // no bearing on a DIFFERENT item that member is holding (e.g. a Cemetery Key).
        consumed = isCrimeItemType(crime.crimeName, task.itemName, 'materials');
      }

      let status;
      let requiresReturn;
      if (crime && consumed) {
        status = 'CONSUMED';
        requiresReturn = false;
      } else if (crime && isCrimeItem(crime.crimeName, task.itemName)) {
        // The item is a tool required by / associated with the member's OC.
        if (crime.isComplete) {
          status = 'RETURN DUE';
          requiresReturn = true;
        } else {
          status = 'IN USE';
          requiresReturn = true;
        }
      } else {
        // No tracked crime, or the item is not part of that crime (e.g. a personal-crime
        // item like a Bucket or Cemetery Key held by a member who also has an OC on file).
        // The item is not tied to any OC → report as "No OC".
        status = 'NO OC';
        requiresReturn = true;
      }

      return {
        playerId: task.playerId,
        playerName: memberMap[task.playerId] || ('#' + task.playerId),
        itemId: task.itemId,
        itemName: task.itemName,
        crimeId: crime?.crimeId ?? null,
        crimeName: crime?.crimeName ?? '',
        role: role,
        ocRoleMatch: ocRoleMatch,
        crimeStatus: crime?.status ?? '',
        isComplete: crime?.isComplete ?? true,
        timeStarted: crime?.timeStarted ?? null,
        timeReady: crime?.timeReady ?? null,
        timeCompleted: crime?.timeCompleted ?? null,
        consumed: consumed,
        requiresReturn: requiresReturn,
        status: status
      };
    });

    res.json({
      items,
      memberCount: playerIds.size,
      loans
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES ARMORY REQUEST TICKETS
// ═══════════════════════════════════════════════════════════════════════════════
// Members request a Utilities armory item from a dropdown on My Day. Each request
// is stored as an AppNotification (type 'utilities_request') that appears on the
// My Day of everyone with the Utility Loaning permission until it is fulfilled.
// Fulfilment creates a 'utilities_fulfilled' notification targeted to the requester
// and deletes the open request. The Utilities armory page reflects the actual loan
// automatically through the existing Torn API integration.

// ─── Helper: Fetch the available Utilities armory items (name, id, available) ──
async function fetchUtilitiesArmoryItems() {
  const factionKey = await getFactionApiKey();
  if (!factionKey) return [];
  let utilitiesData = [];
  try {
    const utilsRes = await axios.get(`https://api.torn.com/faction/?selections=utilities&key=${encodeURIComponent(factionKey)}`);
    const raw = utilsRes.data;
    if (Array.isArray(raw?.utilities)) utilitiesData = raw.utilities;
    else if (Array.isArray(raw?.items)) utilitiesData = raw.items;
    else if (Array.isArray(raw)) utilitiesData = raw;
  } catch (err) {
    console.error('Error fetching utilities data:', err.message);
  }
    return utilitiesData.map(item => ({
    id: item.id || null,
    name: item.name || 'Unknown',
    available: item.available || 0,
    loaned: item.loaned || 0,
    total: item.quantity || 0
  }));
}

// ─── API: List available utilities armory items (for the request dropdown) ────
app.get('/api/utilities/available', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const items = await fetchUtilitiesArmoryItems();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Open a new utilities item request (ticket) ──────────────────────────
app.post('/api/utilities/requests', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const { itemId, itemName } = req.body || {};
    if (!itemId && !itemName) {
      return res.status(400).json({ error: 'An item must be selected.' });
    }
    const requesterId = parseInt(req.session.userId);
    const dbUser = await User.findOne({ tornPlayerId: requesterId });
    const requesterName = dbUser?.tornName || dbUser?.username || ('#' + requesterId);

    // Prevent duplicate open requests from the same requester for the same item
    const dupFilter = { type: 'utilities_request', requesterId };
    if (itemId) dupFilter.itemId = itemId;
    else dupFilter.itemName = itemName;
    const existing = await AppNotification.findOne(dupFilter);
    if (existing) {
      return res.status(409).json({ error: 'You already have an open request for this item.' });
    }

    const notification = await AppNotification.create({
      type: 'utilities_request',
      title: `🧰 Utilities Request: ${itemName}`,
      message: `${requesterName} is requesting ${itemName} from the Utilities armory.`,
      requesterId,
      requesterName,
      itemId: itemId || null,
      itemName,
      recipientId: null
    });

    res.status(201).json({ success: true, request: notification });
  } catch (err) {
    console.error('Error creating utilities request:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get utilities requests (requester's own + all open for holders) ─────
app.get('/api/utilities/requests', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const userId = parseInt(req.session.userId);
    const canLoan = await isUtilityLoaningUser(req.session.user);

    const myRequests = await AppNotification.find({
      type: 'utilities_request',
      requesterId: userId
    }).sort({ createdAt: -1 }).lean();

    let allOpenRequests = [];
    let fulfilledRequests = [];
    if (canLoan) {
      allOpenRequests = await AppNotification.find({ type: 'utilities_request' })
        .sort({ createdAt: -1 }).lean();
    }
    // The requester's fulfillment notifications
    fulfilledRequests = await AppNotification.find({
      type: 'utilities_fulfilled',
      recipientId: userId
    }).sort({ createdAt: -1 }).lean();

    res.json({ canLoan, myRequests, allOpenRequests, fulfilledRequests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Fulfil a utilities request (creates requester notification + deletes) ─
app.post('/api/utilities/requests/:id/fulfill', isAuthenticated, isFactionMember, isUtilityLoaning, async (req, res) => {
  try {
    const request = await AppNotification.findOne({
      _id: req.params.id,
      type: 'utilities_request'
    });
    if (!request) {
      return res.status(404).json({ error: 'Request not found or already fulfilled.' });
    }

    const fulfilledBy = req.session.user?.tornName || req.session.user?.username || ('#' + req.session.userId);

    // Notify the requester (only if they're still a faction member with an account)
    const requester = await User.findOne({ tornPlayerId: request.requesterId });
    if (requester) {
      await AppNotification.create({
        type: 'utilities_fulfilled',
        title: `✅ Your Utilities Request Was Fulfilled`,
        message: `${request.itemName} has been loaned to you by ${fulfilledBy}.`,
        requesterId: request.requesterId,
        requesterName: request.requesterName,
        itemId: request.itemId,
        itemName: request.itemName,
        recipientId: request.requesterId
      });
    }

    // Remove the open request
    await AppNotification.deleteOne({ _id: request._id });

    res.json({ success: true });
  } catch (err) {
    console.error('Error fulfilling utilities request:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Cancel / delete an open utilities request ──────────────────────────
app.delete('/api/utilities/requests/:id', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const request = await AppNotification.findOne({
      _id: req.params.id,
      type: 'utilities_request'
    });
    if (!request) {
      return res.status(404).json({ error: 'Request not found or already fulfilled.' });
    }
    const userId = parseInt(req.session.userId);
    const canLoan = await isUtilityLoaningUser(req.session.user);
    // Only the requester or a Utility Loaning holder can cancel
    if (request.requesterId !== userId && !canLoan) {
      return res.status(403).json({ error: 'You can only cancel your own requests.' });
    }
    await AppNotification.deleteOne({ _id: request._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Level progress via HOF ──────────────────────────────────────────────
app.get('/api/torn/levelprogress', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }

    const CACHE_DURATION = 24 * 60 * 60 * 1000;
    if (dbUser.levelProgressCache && dbUser.levelProgressCachedAt &&
      Date.now() - new Date(dbUser.levelProgressCachedAt).getTime() < CACHE_DURATION) {
      return res.json(dbUser.levelProgressCache);
    }

    const hofRes = await axios.get(
      `https://api.torn.com/v2/user/hof?key=${encodeURIComponent(dbUser.tornApiKey)}`
    );
    if (hofRes.data.error) {
      return res.status(400).json({ error: hofRes.data.error.error });
    }

    const level = hofRes.data.hof.level.value;
    const rank = hofRes.data.hof.level.rank;

    if (level >= 100) {
      const result = { level, rank, progress: 100, display: '100.00' };
      await User.findOneAndUpdate(
        { tornPlayerId: req.session.userId },
        { levelProgressCache: result, levelProgressCachedAt: new Date() }
      );
      return res.json(result);
    }

    const currentTime = Math.floor(Date.now() / 1000);

    async function findInactiveAtLevel(targetLevel, startRank) {
      const searchBuffer = targetLevel < 20 ? 2000 : 500;
      let offset = Math.max(0, startRank - searchBuffer);
      offset = Math.floor(offset / 100) * 100;

      const THRESHOLDS = [
        365 * 24 * 60 * 60, 180 * 24 * 60 * 60, 90 * 24 * 60 * 60, 30 * 24 * 60 * 60
      ];

      for (const threshold of THRESHOLDS) {
        let searchOffset = offset;
        let passedTarget = false;

        for (let attempt = 0; attempt < 100; attempt++) {
          const hofPage = await axios.get(
            `https://api.torn.com/v2/torn/hof?limit=100&offset=${searchOffset}&cat=level&key=${encodeURIComponent(dbUser.tornApiKey)}`
          );

          if (hofPage.data?.error?.code === 5) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }

          const players = hofPage.data.hof || [];
          if (!players.length) break;

          const levels = players.map(p => p.level);
          const minLevel = Math.min(...levels);
          const maxLevel = Math.max(...levels);

          for (const player of players) {
            if (player.level === targetLevel && (currentTime - player.last_action) > threshold) {
              return player.position;
            }
          }

          if (maxLevel < targetLevel) {
            searchOffset = Math.max(0, searchOffset - 100);
          } else if (minLevel > targetLevel) {
            searchOffset += 100;
          } else {
            if (passedTarget) {
              searchOffset = Math.max(0, searchOffset - 200);
              passedTarget = false;
            } else {
              passedTarget = true;
              searchOffset += 100;
            }
          }

          await new Promise(resolve => setTimeout(resolve, 650));
        }
      }
      return null;
    }

    const lowerPos = await findInactiveAtLevel(level - 1, Math.max(0, rank - 5000));
    const currentPos = await findInactiveAtLevel(level, rank);

    if (!lowerPos || !currentPos) {
      return res.json({ level, rank, progress: null, display: String(level) });
    }

    let relative = (lowerPos - rank) / (lowerPos - currentPos);
    relative = Math.min(Math.round(relative * 100) / 100, 0.99);
    const display = (level + relative).toFixed(2);

    const result = { level, rank, progress: Math.round(relative * 100), display };

    await User.findOneAndUpdate(
      { tornPlayerId: req.session.userId },
      { levelProgressCache: result, levelProgressCachedAt: new Date() }
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Faction application ─────────────────────────────────────────────────
app.post('/api/apply', async (req, res) => {
  const { answers, tornName, tornId, allYes } = req.body;

  if (!tornName || !tornId) {
    return res.status(400).json({ error: 'Torn name and ID are required.' });
  }

  const questions = [
    'Have you read our expectations, and are you comfortable agreeing to them?',
    'Do you agree to setup and apply to the faction in Torn Stats within 24 hours of acceptance?',
    'Do you agree to join and actively participate, daily, in team communications?',
    'Do you agree that if you\'re under level 15, you will get to level 15 within 3 weeks of acceptance?',
    'Do you agree that once you\'re over level 15, you will do atleast one stat jump (candy, happy, console, etc.) weekly?'
  ];

  const answerLines = questions.map((q, i) => {
    const answer = answers[`q${i + 1}`];
    const icon = answer === 'yes' ? '✅' : '❌';
    return `${i + 1}. ${q}\n   ${icon} ${answer === 'yes' ? 'Agreed' : 'Did not agree'}`;
  });

  const flag = allYes ? '✅ All conditions agreed' : '⚠️ One or more conditions NOT agreed';
  const message = [
    '📋 **New Faction Application**', '',
    `**Torn Name:** ${tornName}`,
    `**Torn ID:** ${tornId}`,
    `**Profile:** https://www.torn.com/profiles.php?XID=${tornId}`, '',
    `**Status:** ${flag}`, '',
    '**Answers:**',
    ...answerLines, '',
    `**Faction Page:** https://www.torn.com/factions.php?step=profile&ID=53272`
  ].join('\n');

  try {
    console.log(`✅ Application received from ${tornName} (${tornId})`);

    // ── (Commented out) Discord Webhook ───────────────────────────────────
    // Discord is currently disabled due to a temporary IP ban.
    // Uncomment this block when the ban is lifted.
    //
    // if (process.env.DISCORD_WEBHOOK_URL) { ... }

    // ── Send email notification via Resend ────────────────────────────────
    const notifyEmails = getNotifyEmails();
    if (notifyEmails.length > 0) {
      const emailResult = await sendEmail({
        to: notifyEmails,
        subject: `📋 New Faction Application: ${tornName} (${tornId})`,
        text: message
      });
      console.log(`[Application] Email notification result:`, JSON.stringify(emailResult));
    } else {
      console.log(`[Application] No NOTIFY_EMAILS configured — skipping email send`);
    }

    // ── Save in-app notification ──────────────────────────────────────────
    try {
      const notification = new AppNotification({
        type: 'application',
        title: `📋 New Application: ${tornName}`,
        message: `Application received from ${tornName} (${tornId})\nStatus: ${allYes ? 'All conditions agreed' : '⚠️ Some conditions not agreed'}`,
        applicantName: tornName,
        applicantId: parseInt(tornId),
        allYes: allYes,
        answers: answers
      });
      await notification.save();
      console.log(`[Application] In-app notification saved (ID: ${notification._id})`);
    } catch (notifErr) {
      console.error('[Application] Failed to save in-app notification:', notifErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Application error:', err.message);
    res.status(500).json({ error: 'Failed to send notifications.' });
  }
});

// ─── API: Racing stats ────────────────────────────────────────────────────────
app.get('/api/torn/races', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 1000);
    const allRaces = [];
    let offset = 0;
    const pageSize = 100;

    while (allRaces.length < limit) {
      const tornRes = await axios.get(
        `https://api.torn.com/v2/user/races?limit=${pageSize}&offset=${offset}&key=${encodeURIComponent(dbUser.tornApiKey)}`
      );
      if (tornRes.data.error) {
        return res.status(400).json({ error: tornRes.data.error.error });
      }
      const page = tornRes.data.races || [];
      if (!page.length) break;
      allRaces.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    return res.json({
      player_id: dbUser.tornPlayerId,
      races: allRaces.slice(0, limit)
    });
  } catch (err) {
    console.error('[/api/torn/races]', err.message);
    return res.status(500).json({ error: 'Server error fetching races.' });
  }
});

// ─── API: Bank Rates ──────────────────────────────────────────────────────────
app.get('/api/torn/bank-rates', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved. Please add your key first.' });
    }

    const isTestUser = !!req.session?.user?.isTestUser;
    const encodedKey = encodeURIComponent(dbUser.tornApiKey);

    // Fetch bank rates
    const bankRes = await axios.get('https://api.torn.com/torn/?selections=bank&key=' + encodedKey);

    if (bankRes.data.error) {
      return res.status(400).json({ error: 'Failed to fetch bank rates: ' + bankRes.data.error.error });
    }

    const bankData = bankRes.data.bank || {};

    // Get Bank Investment merit level (0-10)
    let bankInvestmentMerit = 0;
    let meritBonus = 0;

    // Test users use placeholder API keys — always force merits to 0.
    // Also make the merits fetch non-fatal for real users, so a missing
    // "Personal User Data" permission doesn't break the entire bank rates page.
    if (!isTestUser) {
      try {
        const userRes = await axios.get('https://api.torn.com/user/?selections=merits&key=' + encodedKey);
        if (!userRes.data.error) {
          const meritsData = userRes.data.merits || {};
          // Try different possible key formats based on API response
          bankInvestmentMerit = meritsData['Bank Interest'] ||
            meritsData['Bank_Interest'] ||
            meritsData['Bank Investment'] ||
            meritsData['Bank_Investment'] ||
            meritsData['bankinterest'] ||
            meritsData['bankinvestment'] ||
            0;
          meritBonus = bankInvestmentMerit * 5; // 5% per merit level
        }
      } catch (meritErr) {
        // Non-fatal: bank rates still work without the merit bonus
        console.log('Could not fetch merits for bank rates:', meritErr.message);
      }
    }

    // Calculate rates with merits applied
    const baseRates = {
      '1_week': bankData['1w'] || 0,
      '2_weeks': bankData['2w'] || 0,
      '1_month': bankData['1m'] || 0,
      '2_months': bankData['2m'] || 0,
      '3_months': bankData['3m'] || 0
    };

    // Apply merit bonus to get effective rates
    const meritMultiplier = 1 + (bankInvestmentMerit * 0.05);
    const ratesWithMerits = {
      '1_week': baseRates['1_week'] * meritMultiplier,
      '2_weeks': baseRates['2_weeks'] * meritMultiplier,
      '1_month': baseRates['1_month'] * meritMultiplier,
      '2_months': baseRates['2_months'] * meritMultiplier,
      '3_months': baseRates['3_months'] * meritMultiplier
    };

    const now = new Date();

    const result = {
      baseRates: baseRates,
      rates: ratesWithMerits, // Return rates with merits applied
      bankInvestmentMerit: bankInvestmentMerit,
      meritBonus: meritBonus,
      lastUpdated: now.toISOString()
    };

    res.json(result);
  } catch (err) {
    console.error('[/api/torn/bank-rates]', err.message);
    return res.status(500).json({ error: 'Server error fetching bank rates.' });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
async function startServer() {
  try {
    const fixedPort = 3000;

    const net = require('net');
    const checkPort = (port) => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(port, () => {
          server.once('close', () => {
            resolve(true);
          });
          server.close();
        });
        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    };

    const isPortAvailable = await checkPort(fixedPort);
    if (!isPortAvailable) {
      console.log(`Port ${fixedPort} is already in use.`);
      console.log('Use: netstat -ano | findstr :${fixedPort}');
      console.log('Then: taskkill /PID <PID> /F');
      process.exit(1);
    }

    const server = app.listen(fixedPort, () => {
      console.log(`SSG Server listening on http://localhost:${fixedPort}`);
      // Start the weekly snapshot scheduler
      startScheduler();
    });

    process.on('SIGINT', () => {
      console.log('\nShutting down gracefully...');
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down gracefully...');
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    });

    process.on('uncaughtException', (err) => {
      console.error('Uncaught Exception:', err);
      server.close(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection:', reason);
      server.close(() => process.exit(1));
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// ═══════════════════════════════════════════════════════════════════════════════
// MY DAY DASHBOARD API
// ═══════════════════════════════════════════════════════════════════════════════

// ─── API: Get personalized "My Day" dashboard data ──────────────────────────
// ─── API: TCSE Stock Exchange ─────────────────────────────────────────────────
app.get('/api/torn/stocks', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved. Please add your key first.' });
    }

    const encodedKey = encodeURIComponent(dbUser.tornApiKey);
    const response = await axios.get('https://api.torn.com/torn/?selections=stocks&key=' + encodedKey);

    if (response.data.error) {
      return res.status(400).json({ error: 'Failed to fetch stock data: ' + response.data.error.error });
    }

    const apiStocks = response.data.stocks || {};

    // Debug: Log the first stock's raw structure to see available fields
    const firstStockKey = Object.keys(apiStocks)[0];
    if (firstStockKey) {
      //console.log('[/api/torn/stocks] Sample stock raw data:', JSON.stringify(apiStocks[firstStockKey], null, 2));
    }

    // Build enriched stock list using Torn API's built-in benefit data
    const stocks = Object.entries(apiStocks).map(([id, stock]) => {
      const stockId = parseInt(id);
      const acronym = stock.acronym || '';
      const price = stock.current_price || stock.price || 0;

      // Use the Torn API's benefit field if available
      const benefit = stock.benefit || {};
      const benefitRequirement = benefit.requirement || 0;
      const benefitDescription = benefit.description || '';
      const benefitFrequency = benefit.frequency || 0;  // number, e.g. 31 or 7
      const benefitType = benefit.type || '';           // "active" or "passive"

      // Determine if this is an index fund (no share requirement, per-share benefit)
      const isIndexFund = benefitRequirement === 0 && benefitDescription.length > 0;

      // Determine if the stock is tiered:
      // - "active" type = Tiered: you buy shares in increments (e.g. 35k for tier 1,
      //   another 35k to double your dividend). You claim the reward periodically.
      // - "passive" type = Not Tiered: one-time constant benefit, buy the required
      //   shares once and the benefit is permanent.
      // - Index funds (requirement = 0) are per-share, not tiered.
      const benefitTiered = benefitType === 'active' && benefitRequirement > 0;

      // Required shares and total cost
      const requiredShares = benefitRequirement > 0 ? benefitRequirement : null;
      const totalCost = requiredShares ? requiredShares * price : null;

      // Build dividend/reward description
      let dividend = benefitDescription;
      if (benefitFrequency > 0 && dividend) {
        dividend += ` (every ${benefitFrequency} days)`;
      }

      return {
        id: stockId,
        name: stock.name || 'Unknown',
        acronym: acronym,
        price: price,
        marketCap: stock.market_cap || 0,
        totalShares: stock.total_shares || 0,
        availableShares: stock.available_shares || 0,
        investors: stock.investors || 0,
        isIndexFund: isIndexFund,
        isTiered: benefitTiered,
        requiredShares: requiredShares,
        totalCost: totalCost,
        dividend: dividend || '',
      };
    });

    res.json({ stocks });
  } catch (err) {
    console.error('[/api/torn/stocks]', err.message);
    res.status(500).json({ error: 'Failed to fetch stock data: ' + err.message });
  }
});

app.get('/api/my-day', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const userId = parseInt(req.session.userId);
    const dbUser = await User.findOne({ tornPlayerId: userId });
    const factionKey = await getFactionApiKey();

    const result = {
      energy: null,
      nerve: null,
      activeOc: null,
             ocItemNeeded: null,
       ocItemHave: null,
      ocItemChannelLink: null,
      war: null,
      hasApiKey: !!dbUser?.tornApiKey,
      canLoanUtilities: false,
      pendingRequests: [],
      myRequestStatus: [],
      fulfilledRequests: [],
      loanedItems: []
    };

                          // 1. Fetch user bars (nerve, energy) if they have an API key
    let playerItems = [];
    if (dbUser?.tornApiKey) {
      try {
          const tornRes = await axios.get(
            `https://api.torn.com/user/?selections=bars&key=${encodeURIComponent(dbUser.tornApiKey)}`,
            { timeout: 10000 }
          );
          if (!tornRes.data.error) {
            result.energy = tornRes.data.energy || null;
            result.nerve = tornRes.data.nerve || null;
          }
        } catch (err) {
          console.error('My Day: Error fetching user bars:', err.message);
        }
        // 1b. Separately fetch player inventory items (non-fatal if this fails)
        try {
          const itemsRes = await axios.get(
            `https://api.torn.com/user/?selections=items&key=${encodeURIComponent(dbUser.tornApiKey)}`,
            { timeout: 10000 }
          );
          if (!itemsRes.data.error && itemsRes.data.items) {
            if (Array.isArray(itemsRes.data.items)) {
              playerItems = itemsRes.data.items.filter(i => (i.quantity || 0) > 0);
            } else if (typeof itemsRes.data.items === 'object') {
              playerItems = Object.entries(itemsRes.data.items)
                .filter(([, q]) => (q || 0) > 0)
                .map(([id]) => ({ id: parseInt(id) }));
            }
          }
        } catch (err) {
          console.error('My Day: Error fetching user items:', err.message);
        }
    }

    // 2. Check for active OC participation
    if (factionKey) {
      try {
        // First, try to refresh OC data from Torn API to ensure we have current data
        // This is needed because OC data may not have been synced to the database yet
        const { refreshFactionCrimes } = require('./services/tornCrimesService');
        try {
          await refreshFactionCrimes(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
        } catch (refreshErr) {
          // Non-fatal: if refresh fails, we'll still check the database for existing data
          console.error('My Day: OC refresh error (non-fatal):', refreshErr.message);
        }

        // Find pending/active crimes where this user is a participant
        const activeCrimes = await OrganizedCrime.find({
          isComplete: false,
          'participants.playerId': userId
        }).sort({ timeStarted: -1 }).limit(1).lean();

        if (activeCrimes.length > 0) {
          const crime = activeCrimes[0];
          const participant = crime.participants.find(p => p.playerId === userId);

          result.activeOc = {
            crimeId: crime.crimeId,
            crimeName: crime.crimeName,
            role: participant?.role || 'Unknown',
            initiated: crime.initiated,
            timeLeft: crime.timeLeft
          };

          // Check if this participant's role requires an item/tool
          if (participant && participant.tool && participant.tool !== 'N/A') {
            result.ocItemNeeded = participant.tool;
            result.ocItemChannelLink = 'https://discord.com/channels/1432576178383753309/1461808457869951077';

            // Determine if the player currently has this item for their OC.
            // Priority of signals (most authoritative first):
            //   1. toolAvailable — the crime slot tells us the item is checked in/available
            //      for this member right now (item_requirement.is_available). This works even
            //      if the inventory call below is empty/fails.
            //   2. toolId in inventory — we know the exact required item ID (item_requirement.id).
            //   3. Legacy name-based catalog lookup — only for records saved before toolId existed.
            result.ocItemHave = participant.toolAvailable === true;

            if (!result.ocItemHave && playerItems.length > 0) {
              // playerItems contains entries like { id: <int> } or { item_id: <int> }
              const playerItemIds = new Set(
                playerItems.map(i => String(i.id || i.item_id))
              );

              if (participant.toolId) {
                // Authoritative path: exact item ID from the v2 crime API — no name catalog lookup.
                result.ocItemHave = playerItemIds.has(String(participant.toolId));
              } else {
                // Legacy fallback: records created before toolId existed only have a display name
                // (e.g. "Picklocks"). Resolve it to an ID via the Torn item catalog.
                let catalogNameToId = {};
                try {
                  const catalogRes = await axios.get(
                    `https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(factionKey)}`
                  );
                  if (!catalogRes.data.error && catalogRes.data.items) {
                    Object.entries(catalogRes.data.items).forEach(([id, item]) => {
                      if (item.name) {
                        catalogNameToId[normalizeItemName(item.name)] = parseInt(id);
                      }
                    });
                  }
                } catch (err) {
                  console.error('My Day: Error fetching item catalog for ocItemHave:', err.message);
                }

                // Find the item ID matching the needed item name, then check inventory
                const neededItemId = catalogNameToId[normalizeItemName(participant.tool)];
                result.ocItemHave = !!neededItemId && playerItemIds.has(String(neededItemId));
              }
            }

            // Diagnostic logging to help trace why the ownership check returned its value
            console.log(
              '[My Day] OC item check',
              JSON.stringify({
                userId,
                role: participant.role,
                tool: participant.tool,
                toolId: participant.toolId,
                toolAvailable: participant.toolAvailable,
                playerItemCount: playerItems.length,
                ocItemHave: result.ocItemHave
              })
            );
          }
        }
      } catch (err) {
        console.error('My Day: Error checking OC participation:', err.message);
      }
    }

    // 3. Check war status
    if (factionKey) {
      try {
        const warsRes = await axios.get(
          `https://api.torn.com/v2/faction/?selections=wars&key=${encodeURIComponent(factionKey)}`,
          { timeout: 10000 }
        );
        const rankedWar = warsRes.data.wars?.ranked;
        if (rankedWar && rankedWar.start) {
          const warEnd = rankedWar.end || null;
          const isActive = !warEnd || warEnd > Math.floor(Date.now() / 1000);
          if (isActive) {
            const warFactions = rankedWar.factions || [];
            const enemyFaction = warFactions.find(f => f.id !== 53272);
            result.war = {
              enemy: enemyFaction?.name || 'Unknown',
              start: rankedWar.start,
              end: rankedWar.end,
              isActive: true
            };
          }
        }
      } catch (err) {
        console.error('My Day: Error checking war status:', err.message);
      }
    }

    // 4. Utilities armory request tickets
    try {
      result.canLoanUtilities = await isUtilityLoaningUser(req.session.user);

      // Requester's own open requests + fulfillment notifications
      result.myRequestStatus = await AppNotification.find({
        type: 'utilities_request',
        requesterId: userId
      }).sort({ createdAt: -1 }).lean();
      result.fulfilledRequests = await AppNotification.find({
        type: 'utilities_fulfilled',
        recipientId: userId
      }).sort({ createdAt: -1 }).lean();

      // Open requests visible to anyone with the Utility Loaning permission
      if (result.canLoanUtilities) {
        result.pendingRequests = await AppNotification.find({ type: 'utilities_request' })
          .sort({ createdAt: -1 }).lean();
      }
    } catch (err) {
      console.error('My Day: Error loading utilities requests:', err.message);
    }

    // 5. Utilities armory items currently loaned to this user
    try {
      result.loanedItems = [];
      if (factionKey) {
        const utilsRes = await axios.get(
          `https://api.torn.com/faction/?selections=utilities&key=${encodeURIComponent(factionKey)}`
        );
        const raw = utilsRes.data;
        let utilsData = [];
        if (Array.isArray(raw?.utilities)) utilsData = raw.utilities;
        else if (Array.isArray(raw?.items)) utilsData = raw.items;
        else if (Array.isArray(raw)) utilsData = raw;

        const myLoaned = [];
        utilsData.forEach(item => {
          if (!item.loaned_to || (item.loaned || 0) === 0) return;
          let ids = [];
          if (typeof item.loaned_to === 'string') ids = item.loaned_to.split(',').map(s => s.trim());
          else if (Array.isArray(item.loaned_to)) ids = item.loaned_to;
          else ids = [String(item.loaned_to)];

          const loanedToMe = ids.some(idStr => {
            const pid = parseInt(idStr);
            return !isNaN(pid) && pid === userId;
          });

          if (loanedToMe) {
            myLoaned.push({
              itemId: item.id || null,
              itemName: item.name || 'Unknown',
              total: item.quantity || 0,
              loaned: item.loaned || 0,
              available: item.available || 0
            });
          }
        });
        result.loanedItems = myLoaned;
      }
    } catch (err) {
      console.error('My Day: Error loading loaned utilities items:', err.message);
    }

    res.json(result);
  } catch (err) {
    console.error('My Day API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ORGANIZED CRIME TRACKING API
// ═══════════════════════════════════════════════════════════════════════════════

const {
  refreshFactionCrimes,
  getCrimesForFaction,
  getCrimeDetails,
  updateCheckpointRates,
  getParticipantHistory
} = require('./services/tornCrimesService');

// ─── API: Refresh OC crimes from Torn ─────────────────────────────────────────
app.post('/api/oc/refresh', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const { daysBack } = req.body;
    const startDate = daysBack ? new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000) : null;

    const result = await refreshFactionCrimes(startDate);

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── API: Get all OC crimes ───────────────────────────────────────────────────
app.get('/api/oc/crimes', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const { status, dateFrom, dateTo, sort, order, limit } = req.query;
    const filters = {};

    if (status && status !== 'all') filters.status = status;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    let crimes = await getCrimesForFaction(SSG_FACTION_ID, filters);

    // Sorting
    const sortBy = sort || 'timeStarted';
    const sortOrder = order === 'asc' ? 1 : -1;

    crimes.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (aVal < bVal) return -1 * sortOrder;
      if (aVal > bVal) return 1 * sortOrder;
      return 0;
    });

    // Limit
    if (limit) {
      crimes = crimes.slice(0, parseInt(limit));
    }

    res.json(crimes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get crime details ───────────────────────────────────────────────────
app.get('/api/oc/crimes/:crimeId', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const crime = await getCrimeDetails(parseInt(req.params.crimeId));
    res.json(crime);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── API: Update checkpoint pass rates ────────────────────────────────────────
app.put('/api/oc/crimes/:crimeId/checkpoints', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const { participantRates } = req.body;
    const result = await updateCheckpointRates(parseInt(req.params.crimeId), participantRates);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── API: Get participant history ─────────────────────────────────────────────
app.get('/api/oc/participants/:playerId', isAuthenticated, isFactionMember, async (req, res) => {
  try {
    const history = await getParticipantHistory(parseInt(req.params.playerId), SSG_FACTION_ID);
    res.json(history);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── API: Bulk update member profiles (Ownership only) ─────────────────────────
app.put('/api/admin/members/profiles', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const { updates } = req.body;

    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ error: 'Invalid updates array' });
    }

    // Create bulk operations - only update changed fields
    const bulkOps = updates.map(update => ({
      updateOne: {
        filter: { tornPlayerId: update.tornPlayerId },
        update: {
          $set: {
            ...(update.bloodType !== undefined && { bloodType: update.bloodType }),
            ...(update.timeZone !== undefined && { timeZone: update.timeZone })
          }
        },
        upsert: false
      }
    }));

    const result = await User.bulkWrite(bulkOps);

    res.json({
      success: true,
      modified: result.modifiedCount,
      matched: result.matchedCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoints:
app.post('/api/admin/snapshot', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  const result = await takeSnapshot(req.session.userId);
  res.json(result);
});

app.get('/api/admin/snapshot/:date', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  const snapshot = await getSnapshotByDate(req.params.date);
  snapshot ? res.json(snapshot) : res.status(404).json({ error: 'Not found' });
});

app.get('/api/admin/snapshot/diff/:startDate/:endDate', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  const diff = await getSnapshotDifferences(req.params.startDate, req.params.endDate);
  diff ? res.json(diff) : res.status(404).json({ error: 'Not found' });
});

app.get('/api/admin/snapshot/latest', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  const snapshot = await getLatestSnapshot();
  snapshot ? res.json(snapshot) : res.status(404).json({ error: 'No snapshots' });
});

app.get('/api/admin/snapshot/csv/:startDate/:endDate', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  const diff = await getSnapshotDifferences(req.params.startDate, req.params.endDate);
  if (!diff) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="weekly_progress_${req.params.startDate}_to_${req.params.endDate}.csv"`);
  res.send(generateCSVContent(diff.differences));
});

app.get('/api/admin/snapshot/latest/csv', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const snapshots = await getRealSnapshots(2);
    if (snapshots.length < 2) {
      return res.status(404).json({ error: 'Need at least 2 snapshots to generate CSV' });
    }

    const current = snapshots[0];
    const previous = snapshots[1];

    const diffRows = computeDiff(previous.memberStats, current.memberStats);
    const csvContent = buildDiffCSV(diffRows, previous.snapshotDate, current.snapshotDate);

    const startDate = previous.snapshotDate.toISOString().split('T')[0];
    const endDate = current.snapshotDate.toISOString().split('T')[0];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="weekly_progress_latest_${startDate}_to_${endDate}.csv"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Latest CSV export error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Test snapshot run (unique ID, won't collide with real snapshots) ────
app.post('/api/admin/snapshot/test-run', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  const result = await takeTestSnapshot(req.session.userId);
  res.json(result);
});

// ─── API: Force send existing snapshot CSV via email ─────────────────────────────
app.post('/api/admin/snapshot/send-email', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const { startDate, endDate, emailTo } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate parameters are required' });
    }

    const diff = await getSnapshotDifferences(startDate, endDate);
    if (!diff) {
      return res.status(404).json({ error: 'No snapshot data found for the specified dates' });
    }

    const csvContent = generateCSVContent(diff.differences);
    const sendResults = await sendWeeklyReport(csvContent, `Weekly Snapshot Report ${startDate} to ${endDate}`, false, null, emailTo);

    res.json({
      success: true,
      message: 'Email send initiated',
      sendResults,
      recordCount: diff.differences.length
    });
  } catch (err) {
    console.error('Force email send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS API (Ownership only)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── API: Get recent notifications (Ownership only) ──────────────────────────
app.get('/api/notifications', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const type = req.query.type; // optional filter: 'application' or 'weekly_report'

    const filter = {};
    if (type) filter.type = type;

    const notifications = await AppNotification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Add read status for current user
    const userId = parseInt(req.session.userId);
    const enriched = notifications.map(n => ({
      ...n,
      isRead: n.readBy.includes(userId)
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Mark notification as read (Ownership only) ──────────────────────────
app.post('/api/notifications/:id/read', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const userId = parseInt(req.session.userId);
    const notification = await AppNotification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Add user to readBy if not already there
    if (!notification.readBy.includes(userId)) {
      notification.readBy.push(userId);
      await notification.save();
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get unread notification count (Ownership only) ──────────────────────
app.get('/api/notifications/unread-count', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const userId = parseInt(req.session.userId);
    const count = await AppNotification.countDocuments({ readBy: { $ne: userId } });
    res.json({ unreadCount: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Delete a notification (Ownership only) ─────────────────────────────
app.delete('/api/notifications/:id', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const result = await AppNotification.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS API
// ═══════════════════════════════════════════════════════════════════════════════

// ─── API: Get latest announcement (all authenticated members) ────────────────
app.get('/api/announcements/latest', isAuthenticated, async (req, res) => {
  try {
    const announcement = await Announcement.findOne()
      .sort({ createdAt: -1 })
      .lean();

    res.json(announcement || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get all announcements (all authenticated members) ──────────────────
app.get('/api/announcements', isAuthenticated, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const announcements = await Announcement.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Create announcement (Leadership/Ownership only) ────────────────────
app.post('/api/announcements', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Announcement message is required.' });
    }

    const announcement = new Announcement({
      message: message.trim(),
      authorId: parseInt(req.session.userId),
      authorName: req.session.user.username || req.session.user.tornName
    });

    await announcement.save();

    res.json({ success: true, announcement });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Update announcement (Leadership/Ownership only) ────────────────────
app.put('/api/announcements/:id', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Announcement message is required.' });
    }

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found.' });
    }

    announcement.message = message.trim();
    announcement.updatedAt = new Date();
    await announcement.save();

    res.json({ success: true, announcement });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Delete announcement (Leadership/Ownership only) ────────────────────
app.delete('/api/announcements/:id', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const result = await Announcement.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Announcement not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY TRACKING API
// ═══════════════════════════════════════════════════════════════════════════════

// ─── API: List all companies (all faction members; filtered to what they can see) ──
app.get('/api/companies', isAuthenticated, async (req, res) => {
  try {
    const accessible = await getAccessibleCompaniesForUser(req);
    res.json(accessible);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get full company data ──────────────────────────────────────────────
app.get('/api/company/:companyId', isAuthenticated, async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const userId = parseInt(req.session.userId);

    // Access check: company must be in the user's accessible set
    // (ownership: all; directors/employees/faction members: their own)
    const accessible = await getAccessibleCompaniesForUser(req);
    if (!accessible.some(c => c.companyId === companyId)) {
      return res.status(403).json({ error: 'Access denied. You can only view companies you direct, work at, or that employ you.' });
    }

    const data = await getCompanyData(companyId, userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Add company (Ownership only) ───────────────────────────────────────
app.post('/api/admin/companies', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const { companyId, directorPlayerId } = req.body;

    if (!companyId || !directorPlayerId) {
      return res.status(400).json({ error: 'companyId and directorPlayerId are required.' });
    }

    const result = await addCompany(parseInt(companyId), parseInt(directorPlayerId), req.session.userId);

    if (result.success) {
      res.json({ success: true, company: result.company });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Remove company (Ownership only) ────────────────────────────────────
app.delete('/api/admin/companies/:companyId', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const removed = await removeCompany(parseInt(req.params.companyId));
    if (removed) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Company not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Set company director (Ownership only) ──────────────────────────────
// Corrects a stale/wrong director record. Verifies the new director is in the
// faction, resolves their name, and updates the company record immediately.
app.put('/api/admin/companies/:companyId/director', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const { directorPlayerId } = req.body;
    const parsedDirectorId = parseInt(directorPlayerId);

    if (!parsedDirectorId) {
      return res.status(400).json({ error: 'directorPlayerId is required.' });
    }

    const Company = require('./models/Company');
    const company = await Company.findOne({ companyId });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Verify the new director is a member of the faction (same check as addCompany)
    const factionCheck = await verifyDirectorInFaction(parsedDirectorId);
    if (!factionCheck.valid) {
      return res.status(400).json({ error: 'New director is not a member of SSG faction or could not be verified.' });
    }

    const previousDirector = company.directorName || company.directorPlayerId;
    company.directorPlayerId = parsedDirectorId;
    company.directorName = factionCheck.member?.name || `Player ${parsedDirectorId}`;
    await company.save();

    console.log(`[Company ${companyId}] Director manually set by ownership: ${previousDirector} → ${company.directorName} (${parsedDirectorId})`);
    res.json({ success: true, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Delete employee data (Ownership only) ───────────────────────────────
app.delete('/api/admin/employees/:playerId', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId);

    // Find the employee user record
    const employee = await User.findOne({ tornPlayerId: playerId });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found in the database.' });
    }

    // Safety: only allow deleting employee accounts, never faction members
    if (employee.accountType !== 'employee') {
      return res.status(403).json({ error: 'Only employee (non-faction) accounts can be deleted.' });
    }

    // Delete the employee's user record
    await User.deleteOne({ tornPlayerId: playerId });

    // Clean up their stat snapshots
    await UserStatSnapshot.deleteMany({ tornPlayerId: playerId });

    // Clean up any employee_removal notifications for this employee
    await AppNotification.deleteMany({ type: 'employee_removal', employeeId: playerId });

    console.log(`[Admin] Employee ${employee.tornName} (${playerId}) data deleted by ${req.session.userId}.`);
    res.json({ success: true, message: `Employee ${employee.tornName} (${playerId}) has been removed.` });
  } catch (err) {
    console.error('Employee deletion error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Role Impersonation (Ownership only) ─────────────────────────────────
app.post('/api/user/impersonate', isAuthenticated, isOwnership, async (req, res) => {
  const { role } = req.body;

  if (role && !Object.keys(POSITIONS).includes(role)) {
    return res.status(400).json({ error: 'Invalid role specified' });
  }

  if (role) {
    req.session.impersonateRole = role;
    res.json({ success: true, message: `Now viewing as ${role} role`, impersonatedRole: role });
  } else {
    delete req.session.impersonateRole;
    res.json({ success: true, message: 'Impersonation disabled', impersonatedRole: null });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// STOCK OBSERVATION API (for Tampermonkey userscript)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── API: Submit stock observations from torn.com/travel.php ──────────────────
app.post('/api/stock-observe', express.json(), async (req, res) => {
  try {
    const { playerId, playerName, country, observedAt, stocks } = req.body;

    // Adjusted validation: Allow stocks to be missing or empty for flight location tracking
    if (!playerId || !country) {
      return res.status(400).json({ error: 'Missing required fields: playerId, country' });
    }

    const cleanStocks = Array.isArray(stocks) ? stocks : [];

    // Validate entries ONLY if there are actually items in the array (when landed)
    if (cleanStocks.length > 0) {
      for (const s of cleanStocks) {
        // Removed !s.id restriction to match the relaxed Mongoose schema
        if (!s.name || s.quantity === undefined || s.cost === undefined) {
          return res.status(400).json({ error: 'Each stock entry must have name, quantity, cost' });
        }
      }
    }

    // Create the observation document
    const observation = new StockObservation({
      playerId,
      playerName: playerName || '',
      country: country.toLowerCase(),
      observedAt: observedAt || Math.floor(Date.now() / 1000),
      stocks: cleanStocks.map(s => {
        // If the userscript sends id "0" or 0 (no real item ID), generate a stable
        // name-based ID so items are not all collapsed under the same key during analysis.
        const hasRealId = s.id && s.id !== '0' && s.id !== 0;
        const stableId = hasRealId
          ? String(s.id)
          : (s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_');
        return {
          id: stableId,
          name: s.name,
          quantity: s.quantity,
          cost: s.cost
        };
      })
    });

    await observation.save();

    // Cleanup old observations to keep DB lean (keep only last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    StockObservation.deleteMany({ receivedAt: { $lt: sevenDaysAgo } }).catch(() => { });

    res.json({
      success: true,
      id: observation._id,
      type: cleanStocks.length > 0 ? 'market_update' : 'flight_heartbeat'
    });
  } catch (err) {
    console.error('Stock observation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get stockout estimates for a given country ──────────────────────────
app.get('/api/stockout-estimates', async (req, res) => {
  try {
    const country = req.query.country?.toLowerCase();
    const itemId = req.query.itemId ? parseInt(req.query.itemId) : null;

    if (!country) {
      return res.status(400).json({ error: 'Country parameter is required' });
    }

    // Fetch the last 2 observations for this country to calculate burn rate
    const matchFilter = { country };
    if (itemId) matchFilter['stocks.id'] = itemId;

    const observations = await StockObservation.find(matchFilter)
      .sort({ receivedAt: -1 })
      .limit(50)
      .lean();

    if (observations.length < 2) {
      return res.json({
        country,
        estimates: [],
        message: 'Not enough observations yet. Need at least 2.'
      });
    }

    // Build stock snapshots per item from each observation
    const itemSnapshots = {};
    observations.forEach(obs => {
      obs.stocks.forEach(s => {
        if (!itemSnapshots[s.id]) itemSnapshots[s.id] = [];
        itemSnapshots[s.id].push({
          quantity: s.quantity,
          cost: s.cost,
          name: s.name,
          time: new Date(obs.receivedAt).getTime()
        });
      });
    });

    // Calculate burn rate and stockout estimate for each item
    const estimates = [];
    Object.entries(itemSnapshots).forEach(([id, snapshots]) => {
      if (snapshots.length < 2) return;

      // Sort by time ascending
      snapshots.sort((a, b) => a.time - b.time);

      const newest = snapshots[snapshots.length - 1];
      const oldest = snapshots[0];
      const timeDiffMs = newest.time - oldest.time;
      const timeDiffMin = timeDiffMs / (60 * 1000);

      if (timeDiffMin <= 0) return;

      const qtyDiff = oldest.quantity - newest.quantity;
      const burnRatePerMin = qtyDiff > 0 ? qtyDiff / timeDiffMin : 0;

      let stockoutIn = null;
      let stockoutConfidence = 'unreliable';

      if (burnRatePerMin > 0 && newest.quantity > 0) {
        stockoutIn = Math.round(newest.quantity / burnRatePerMin);

        // Determine confidence based on number of observations and time span
        const obsCount = snapshots.length;
        const hoursSpanned = timeDiffMin / 60;
        if (obsCount >= 10 && hoursSpanned >= 1) {
          stockoutConfidence = 'confident';
        } else if (obsCount >= 5 && hoursSpanned >= 0.5) {
          stockoutConfidence = 'estimated';
        }
      }

      estimates.push({
        id: parseInt(id),
        name: newest.name,
        currentQuantity: newest.quantity,
        currentCost: newest.cost,
        burnRatePerMin: Math.round(burnRatePerMin * 100) / 100,
        stockoutInMinutes: stockoutIn,
        observationsUsed: snapshots.length,
        timeSpanMinutes: Math.round(timeDiffMin),
        confidence: stockoutConfidence,
        lastObserved: new Date(newest.time).toISOString()
      });
    });

    // Sort: most confident first, then soonest stockout
    estimates.sort((a, b) => {
      const confidenceOrder = { confident: 0, estimated: 1, unreliable: 2 };
      const confDiff = (confidenceOrder[a.confidence] || 2) - (confidenceOrder[b.confidence] || 2);
      if (confDiff !== 0) return confDiff;
      return (a.stockoutInMinutes || Infinity) - (b.stockoutInMinutes || Infinity);
    });

    res.json({ country, estimates });
  } catch (err) {
    console.error('Stockout estimates error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Stock analysis for restock times and predictions ───────────────────
// (stockAnalysisService and stockDataSourceService already required at top of file)

// ─── API: Get detailed stock analysis for a country (hybrid: YATA + userscript) ─
app.get('/api/restock-analysis', async (req, res) => {
  try {
    const country = req.query.country?.toLowerCase();
    if (!country) {
      return res.status(400).json({ error: 'Country parameter is required' });
    }

    const analysis = await stockAnalysisService.analyzeCountry(country);
    if (analysis.status === 'no_data') {
      return res.json({
        country,
        status: 'no_data',
        message: 'No stock data available. YATA/Prometheus may be unavailable and no userscript observations exist.',
        items: []
      });
    }

    res.json(analysis);
  } catch (err) {
    console.error('Restock analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get travel recommendations based on stock analysis ────────────────
app.get('/api/travel-recommendations', async (req, res) => {
  try {
    const maxItems = parseInt(req.query.max) || 20;
    const recommendations = await stockAnalysisService.getTravelRecommendations(maxItems);
    res.json({
      generatedAt: new Date().toISOString(),
      count: recommendations.length,
      recommendations
    });
  } catch (err) {
    console.error('Travel recommendations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Stock Advisory - hybrid YATA + userscript data ─────────────────────
// Returns per-country stock data with deterministic restock countdown,
// burn rates from userscript observations, and departure recommendations.
app.get('/api/stock/advisory', isAuthenticated, async (req, res) => {
  try {
    const country = req.query.country?.toLowerCase();

    if (country) {
      // Single country advisory
      const analysis = await stockAnalysisService.analyzeCountry(country);
      const restockCountdown = stockDataSourceService.getRestockCountdown();

      return res.json({
        ...analysis,
        restockCountdown,
        generatedAt: new Date().toISOString(),
      });
    }

    // All countries advisory
    const countries = ['mex', 'cay', 'can', 'haw', 'uni', 'arg', 'swi', 'jap', 'chi', 'uae', 'sou'];
    const restockCountdown = stockDataSourceService.getRestockCountdown();
    const results = {};

    await Promise.allSettled(
      countries.map(async (c) => {
        try {
          results[c] = await stockAnalysisService.analyzeCountry(c);
        } catch (err) {
          results[c] = { country: c, status: 'error', error: err.message, items: [] };
        }
      })
    );

    res.json({
      countries: results,
      restockCountdown,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Stock advisory error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Restock countdown (deterministic, no auth needed for polling) ───────
app.get('/api/stock/restock-countdown', isAuthenticated, (req, res) => {
  const countdown = stockDataSourceService.getRestockCountdown();
  res.json(countdown);
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAT SCRIPT BACKEND API — COMMENTED OUT FOR FUTURE USE
// ═══════════════════════════════════════════════════════════════════════════════
//
// const crypto = require('crypto');
//
// function generateCatToken() {
//   return crypto.randomBytes(32).toString('hex');
// }
//
// async function authenticateCatRequest(req, res, next) {
//   const authHeader = req.headers.authorization;
//   if (!authHeader || !authHeader.startsWith('Bearer ')) {
//     return res.status(401).json({ error: 'Missing or invalid authorization header' });
//   }
//   const token = authHeader.split(' ')[1];
//   try {
//     const catUser = await CatUser.findOne({ authToken: token });
//     if (!catUser) {
//       return res.status(401).json({ error: 'Invalid auth token' });
//     }
//     catUser.lastActive = new Date();
//     await catUser.save();
//     req.catUser = catUser;
//     next();
//   } catch (err) {
//     res.status(500).json({ error: 'Auth error: ' + err.message });
//   }
// }
//
// app.post('/api/cat/register', async (req, res) => {
//   try {
//     const { apiKey } = req.body;
//     if (!apiKey || !apiKey.trim()) {
//       return res.status(400).json({ error: 'Torn API key is required' });
//     }
//     const validation = await validateTornApiKey(apiKey.trim());
//     if (!validation.valid) {
//       return res.status(401).json({ error: 'Invalid Torn API key: ' + validation.error });
//     }
//     const playerId = validation.playerId;
//     const playerName = validation.name;
//     const factionCheck = await isPlayerInFaction(playerId);
//     if (!factionCheck.inFaction) {
//       return res.status(403).json({ error: 'You are not a member of SSG faction' });
//     }
//     let catUser = await CatUser.findOne({ playerId });
//     if (catUser) {
//       catUser.authToken = generateCatToken();
//       catUser.playerName = playerName;
//       catUser.lastActive = new Date();
//       await catUser.save();
//       return res.json({ success: true, token: catUser.authToken, playerId: catUser.playerId, playerName: catUser.playerName, factionId: catUser.factionId });
//     }
//     catUser = new CatUser({ playerId, playerName, factionId: SSG_FACTION_ID, authToken: generateCatToken() });
//     await catUser.save();
//     res.json({ success: true, token: catUser.authToken, playerId: catUser.playerId, playerName: catUser.playerName, factionId: catUser.factionId });
//   } catch (err) {
//     console.error('[CAT] Register error:', err.message);
//     res.status(500).json({ error: err.message });
//   }
// });
//
// app.get('/api/cat/calls', authenticateCatRequest, async (req, res) => {
//   try {
//     const factionId = req.catUser.factionId;
//     const calls = await CatCall.find({ factionId }).sort({ createdAt: -1 }).lean();
//     const now = Math.floor(Date.now() / 1000);
//     const enrichedCalls = calls.map(call => {
//       const isAwake = call.hospitalUntil ? now >= call.hospitalUntil : false;
//       const timeRemaining = call.hospitalUntil ? Math.max(0, call.hospitalUntil - now) : 0;
//       return { id: call._id, callerId: call.callerId, callerName: call.callerName, targetId: call.targetId, targetName: call.targetName, hospitalUntil: call.hospitalUntil, isAwake, timeRemaining, createdAt: call.createdAt };
//     });
//     enrichedCalls.sort((a, b) => {
//       if (a.isAwake !== b.isAwake) return a.isAwake ? -1 : 1;
//       return a.timeRemaining - b.timeRemaining;
//     });
//     res.json({ calls: enrichedCalls });
//   } catch (err) {
//     console.error('[CAT] Get calls error:', err.message);
//     res.status(500).json({ error: err.message });
//   }
// });
//
// app.post('/api/cat/calls', authenticateCatRequest, async (req, res) => {
//   try {
//     const { targetId, targetName, hospitalUntil } = req.body;
//     if (!targetId || !targetName) {
//       return res.status(400).json({ error: 'targetId and targetName are required' });
//     }
//     const factionId = req.catUser.factionId;
//     const existingCall = await CatCall.findOne({ factionId, targetId });
//     if (existingCall) {
//       existingCall.callerId = req.catUser.playerId;
//       existingCall.callerName = req.catUser.playerName;
//       existingCall.targetName = targetName;
//       existingCall.hospitalUntil = hospitalUntil || null;
//       existingCall.isAwake = false;
//       existingCall.updatedAt = new Date();
//       await existingCall.save();
//       return res.json({ success: true, call: existingCall, updated: true });
//     }
//     const call = new CatCall({ factionId, callerId: req.catUser.playerId, callerName: req.catUser.playerName, targetId, targetName, hospitalUntil: hospitalUntil || null, isAwake: false });
//     await call.save();
//     res.json({ success: true, call, updated: false });
//   } catch (err) {
//     console.error('[CAT] Create call error:', err.message);
//     res.status(500).json({ error: err.message });
//   }
// });
//
// app.delete('/api/cat/calls/:id', authenticateCatRequest, async (req, res) => {
//   try {
//     const call = await CatCall.findById(req.params.id);
//     if (!call) return res.status(404).json({ error: 'Call not found' });
//     if (call.factionId !== req.catUser.factionId) return res.status(403).json({ error: 'Not authorized to delete this call' });
//     await CatCall.findByIdAndDelete(req.params.id);
//     res.json({ success: true });
//   } catch (err) {
//     console.error('[CAT] Delete call error:', err.message);
//     res.status(500).json({ error: err.message });
//   }
// });
//
// app.put('/api/cat/calls/:id/timer', authenticateCatRequest, async (req, res) => {
//   try {
//     const { hospitalUntil } = req.body;
//     const call = await CatCall.findById(req.params.id);
//     if (!call) return res.status(404).json({ error: 'Call not found' });
//     if (call.factionId !== req.catUser.factionId) return res.status(403).json({ error: 'Not authorized' });
//     call.hospitalUntil = hospitalUntil || null;
//     call.isAwake = false;
//     call.updatedAt = new Date();
//     await call.save();
//     res.json({ success: true, call });
//   } catch (err) {
//     console.error('[CAT] Update timer error:', err.message);
//     res.status(500).json({ error: err.message });
//   }
// });
//
// app.post('/api/cat/status', authenticateCatRequest, async (req, res) => {
//   try {
//     const { playerId, playerName, status, details, until, untilSource, previousStatus, previousArea, departedAt, onlineStatus } = req.body;
//     if (!playerId) return res.status(400).json({ error: 'playerId is required' });
//     await CatStatus.findOneAndUpdate(
//       { factionId: req.catUser.factionId, playerId },
//       { factionId: req.catUser.factionId, playerId, playerName: playerName || '', status: status || 'Okay', details: details || null, until: until || null, untilSource: untilSource || null, previousStatus: previousStatus || null, previousArea: previousArea || null, departedAt: departedAt || null, onlineStatus: onlineStatus || 'offline', createdAt: new Date() },
//       { upsert: true }
//     );
//     res.json({ success: true });
//   } catch (err) {
//     console.error('[CAT] Status update error:', err.message);
//     res.status(500).json({ error: err.message });
//   }
// });
//
// app.get('/api/cat/war-data', authenticateCatRequest, async (req, res) => {
//   try {
//     const factionId = req.catUser.factionId;
//     const calls = await CatCall.find({ factionId }).sort({ createdAt: -1 }).lean();
//     const now = Math.floor(Date.now() / 1000);
//     const enrichedCalls = calls.map(call => ({
//       id: call._id, callerId: call.callerId, callerName: call.callerName, targetId: call.targetId, targetName: call.targetName,
//       hospitalUntil: call.hospitalUntil, isAwake: call.hospitalUntil ? now >= call.hospitalUntil : false,
//       timeRemaining: call.hospitalUntil ? Math.max(0, call.hospitalUntil - now) : 0, createdAt: call.createdAt
//     }));
//     enrichedCalls.sort((a, b) => { if (a.isAwake !== b.isAwake) return a.isAwake ? -1 : 1; return a.timeRemaining - b.timeRemaining; });
//     let enemyStats = null;
//     try { const cachedStats = getCached('war-enemy-stats'); if (cachedStats) enemyStats = cachedStats; } catch (e) { }
//     let warInfo = null;
//     try {
//       const factionKey = await getFactionApiKey();
//       if (factionKey) {
//         const warsRes = await axios.get(`https://api.torn.com/v2/faction/?selections=wars&key=${factionKey}`, { timeout: 5000 });
//         const rankedWar = warsRes.data.wars?.ranked;
//         if (rankedWar && rankedWar.start) {
//           const warEnd = rankedWar.end || null;
//           const isActive = !warEnd || warEnd > Math.floor(Date.now() / 1000);
//           if (isActive) {
//             const warFactions = rankedWar.factions || [];
//             const enemyFaction = warFactions.find(f => f.id !== SSG_FACTION_ID);
//             warInfo = { enemyFactionId: enemyFaction?.id || null, enemyFactionName: enemyFaction?.name || 'Unknown', start: rankedWar.start, end: rankedWar.end, isActive: true };
//           }
//         }
//       }
//     } catch (e) { }
//     let statuses = [];
//     try { statuses = await CatStatus.find({ factionId }).sort({ createdAt: -1 }).lean(); } catch (e) { }
//     res.json({ calls: enrichedCalls, enemyStats: enemyStats?.enemies || [], war: warInfo, statuses, serverTime: Math.floor(Date.now() / 1000) });
//   } catch (err) {
//     console.error('[CAT] War data error:', err.message);
//     res.status(500).json({ error: err.message });
//   }
// });
//
// app.get('/api/cat/script-version', (req, res) => {
//   res.json({ success: true, version: '1.0.0', minVersion: '1.0.0', updateUrl: 'https://ssg-server.onrender.com/js/ssg-cat-script.user.js' });
// });
//
// app.get('/js/ssg-cat-script.user.js', (req, res) => {
//   const fs = require('fs');
//   const scriptPath = path.join(__dirname, 'public', 'js', 'ssg-cat-script.user.js');
//   fs.readFile(scriptPath, 'utf8', (err, data) => {
//     if (err) return res.status(404).send('Userscript not found');
//     res.setHeader('Content-Type', 'application/javascript');
//     res.setHeader('Content-Disposition', 'attachment; filename="ssg-cat-script.user.js"');
//     res.send(data);
//   });
// });

module.exports = app;
