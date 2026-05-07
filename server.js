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
  buildDiffCSV
} = require('./services/snapshotService');
const { startScheduler } = require('./services/schedulerService');

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

const CHANNELS = {
  announcements: { id: '1466403384038002844', name: '📢 Announcements' },
  growth: { id: '1435061563118850199', name: '🌱 Growth Training' },
  strength: { id: '1454519260960391494', name: '💪 Strength Training' },
  strategy: { id: '1454519584445960234', name: '♟️ Strategy' },
  war: { id: '1435065561494196254', name: '⚔️ War Chat' },
};

// Torn faction positions mapped to permission groups
const POSITIONS = {
  ownership: ['Leader', 'Co-leader', 'Matriarch'],
  leadership: ['Leadership'],
  warlord: ['Warlord'],
  strategy: ['Team Strategy'],
  strength: ['Team Strength'],
  growth: ['Team Growth', 'Recruit'],
};

// Map faction position to permission group
function getPositionGroup(position) {
  for (const [group, positions] of Object.entries(POSITIONS)) {
    if (positions.includes(position)) return group;
  }
  return null;
}

const ROLE_CHANNEL_ACCESS = {
  ownership: ['announcements', 'growth', 'strength', 'strategy', 'war'],
  leadership: ['announcements', 'growth', 'strength', 'strategy', 'war'],
  warlord: ['announcements', 'growth', 'strength', 'strategy', 'war'],
  strategy: ['announcements', 'growth', 'strength', 'strategy', 'war'],
  strength: ['announcements', 'strength', 'war'],
  growth: ['announcements', 'growth', 'war'],
};

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
    if (config?.tornFactionApiKey) return config.tornFactionApiKey;
  } catch (err) {
    console.error('Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY || null;
}

// ─── HELPER: Validate Torn API key and get user data ─────────────────────────
async function validateTornApiKey(apiKey) {
  try {
    const res = await axios.get(`https://api.torn.com/user/?selections=basic,profile&key=${apiKey}`);
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

// ─── HELPER: Check if player is in SSG faction ───────────────────────────────
async function isPlayerInFaction(playerId) {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return { inFaction: false, error: 'No faction API key configured' };

    const res = await axios.get(
      `https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`
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
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      'http://localhost:3000',
      'https://ssg-server.onrender.com',
      process.env.ALLOWED_ORIGIN
    ].filter(Boolean);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.onrender.com')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
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

// ─── HELPER: Get accessible channels based on position group ──────────────────
function getAccessibleChannels(positionGroup) {
  if (!positionGroup) return [{ key: 'announcements', ...CHANNELS.announcements }];
  const channels = ROLE_CHANNEL_ACCESS[positionGroup];
  if (!channels) return [{ key: 'announcements', ...CHANNELS.announcements }];
  return channels.map(key => ({ key, ...CHANNELS[key] }));
}

// ─── HELPER: Check if position group has access to training channel ──────────
function hasTrainingAccess(positionGroup, trainingChannel) {
  return trainingChannel.positionGroups.includes(positionGroup);
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
          const tornRes = await axios.get(
            `https://api.torn.com/v2/faction/?selections=basic,members&key=${factionKey}`,
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
    groups: liveGroups
  });
});

// Login page
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login');
});

// Torn-based login API
app.post('/api/login', async (req, res) => {
  const { tornName, tornId, apiKey, stayLoggedIn } = req.body;

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
    // Existing user - update API key and login
    user.tornApiKey = apiKey;
    user.tornName = tornName;
    user.tornKeyUpdatedAt = new Date();
    user.lastSeen = new Date();
    await user.save();
  } else {
    // Create new user
    user = new User({
      tornPlayerId: tornId,
      tornName: tornName,
      tornApiKey: apiKey,
      username: tornName,
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
  const positionGroup = req.session.user?.positionGroup;
  const factionPosition = req.session.user?.factionPosition;

  // Check if user is in faction (all faction members get basic access)
  let canAccess = !!positionGroup;
  if (!canAccess) {
    const factionCheck = await isPlayerInFaction(req.session.userId);
    canAccess = factionCheck.inFaction;
  }

  if (!canAccess) return res.redirect('/?error=no_access');

  const user = await User.findOne({ tornPlayerId: req.session.userId });
  const accessibleChannels = getAccessibleChannels(positionGroup);
  const isOwner = hasPositionGroup(req.session.user, 'ownership');
  const isLeadership = hasPositionGroup(req.session.user, 'leadership');
  const isWarlordRole = hasPositionGroup(req.session.user, 'warlord');
  const factionKey = await getFactionApiKey();

  const accessibleTraining = TRAINING_CHANNELS.filter(ch =>
    positionGroup && ch.positionGroups.includes(positionGroup)
  );

  res.render('dashboard', {
    user: req.session.user,
    accessibleChannels,
    accessibleTraining,
    tornApiKey: user?.tornApiKey || null,
    userEmail: user?.email || null,
    isOwner,
    isLeadership,
    isWarlord: isWarlordRole,
    hasFactionKey: !!factionKey,
    factionPosition: factionPosition
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
    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=basic&key=${apiKey.trim()}`
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
    const tornRes = await axios.get(
      `https://api.torn.com/faction/?selections=basic&key=${apiKey.trim()}`
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
    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=basic,profile,bars,personalstats&key=${dbUser.tornApiKey}`
    );

    const factionKey = await getFactionApiKey();
    if (factionKey) {
      try {
        const factionRes = await axios.get(
          `https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`
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

// ─── API: Personal honors, merits, awards ────────────────────────────────────
app.get('/api/torn/honors', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }
    const [userRes, tornRes] = await Promise.all([
      axios.get(`https://api.torn.com/user/?selections=honors,merits&key=${dbUser.tornApiKey}`),
      axios.get(`https://api.torn.com/torn/?selections=honors&key=${dbUser.tornApiKey}`)
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
      `https://api.torn.com/user/?selections=criminalrecord&key=${dbUser.tornApiKey}`
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
      `https://api.torn.com/v2/user/?selections=skills&key=${dbUser.tornApiKey}`
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
app.get('/api/torn/faction', isAuthenticated, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) {
      return res.status(400).json({ error: 'No faction API key configured.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/v2/faction/?selections=basic,members&key=${factionKey}`
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
app.get('/api/torn/faction-travel', isAuthenticated, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const factionRes = await axios.get(
      `https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`
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
            `https://api.torn.com/user/?selections=travel&key=${u.tornApiKey}`
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

// ─── API: Travel status from Torn ────────────────────────────────────────────
app.get('/api/torn/travel', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ tornPlayerId: req.session.userId });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=travel&key=${dbUser.tornApiKey}`
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
      `https://api.torn.com/torn/?selections=items&key=${dbUser.tornApiKey}`
    );
    if (tornRes.data.error) {
      return res.status(400).json({ error: tornRes.data.error.error });
    }
    res.json(tornRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    const itemsRes = await axios.get(`https://api.torn.com/torn/?selections=items&key=${apiKey}`, {
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
        if (stockItem.quantity <= 0) return;

        const catalogItem = itemCatalog[stockItem.id] || itemCatalog[String(stockItem.id)] || itemCatalog[Number(stockItem.id)];
        if (!catalogItem || catalogItem.marketValue <= 0) return;

        const profit = catalogItem.marketValue - stockItem.cost;
        if (profit <= 0) return;

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

// ─── API: War hits tracking ───────────────────────────────────────────────────
app.get('/api/torn/wars', isAuthenticated, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const warsRes = await axios.get(`https://api.torn.com/v2/faction/?selections=wars&key=${factionKey}`);
    const warData = warsRes.data;
    const warStart = warData.wars?.ranked?.start || 0;

    if (!warStart) {
      return res.json({ war: null, memberHits: [], totalWarAttacks: 0 });
    }

    let allAttacks = [];
    let nextUrl = `https://api.torn.com/v2/faction/attacks?limit=100&sort=desc&key=${factionKey}`;
    let reachedWarStart = false;

    while (nextUrl && !reachedWarStart) {
      const attacksRes = await axios.get(nextUrl);
      const attacks = attacksRes.data.attacks || [];
      const prevLink = attacksRes.data._metadata?.links?.prev;

      for (const attack of attacks) {
        if (attack.started < warStart) { reachedWarStart = true; break; }
        if (attack.is_ranked_war && attack.attacker?.faction?.id === SSG_FACTION_ID) {
          allAttacks.push(attack);
        }
      }

      nextUrl = !reachedWarStart && prevLink ? prevLink + `&key=${factionKey}` : null;
    }

    const hitCounts = {};
    allAttacks.forEach(a => {
      const id = a.attacker.id;
      const name = a.attacker.name;
      if (!hitCounts[id]) hitCounts[id] = { id, name, hits: 0, respect: 0 };
      hitCounts[id].hits++;
      hitCounts[id].respect += a.respect_gain || 0;
    });

    res.json({
      war: warData.wars?.ranked || null,
      memberHits: Object.values(hitCounts).sort((a, b) => b.hits - a.hits),
      totalWarAttacks: allAttacks.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Member total stats ──────────────────────────────────────────────────
app.get('/api/admin/member-stats', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const dbUsers = await User.find({ tornApiKey: { $ne: null } }, 'tornApiKey username');

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
app.get('/api/war/member-overview', isAuthenticated, isWarlord, async (req, res) => {
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

// ─── API: Faction Loans (Armor & Weapons) ──────────────────────────────────────
app.get('/api/admin/faction-loans', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    // Fetch faction members list
    const factionRes = await axios.get(`https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`);
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
      `https://api.torn.com/v2/user/hof?key=${dbUser.tornApiKey}`
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
            `https://api.torn.com/v2/torn/hof?limit=100&offset=${searchOffset}&cat=level&key=${dbUser.tornApiKey}`
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
    const factionKey = await getFactionApiKey();
    if (!factionKey) {
      return res.status(500).json({ error: 'No faction API key configured' });
    }
const factionRes = await axios.get(
        `https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`
      );
      const factionMembers = factionRes.data.members || [];
      const ownershipPositions = POSITIONS.ownership;
      const ownershipMembers = factionMembers.filter(m => ownershipPositions.includes(m.position));

      // Get email addresses for ownership members from database
      const ownershipUserIds = ownershipMembers.map(m => m.id);
      const ownershipUsers = await User.find({
        tornPlayerId: { $in: ownershipUserIds },
        email: { $ne: null }
      }, 'email');

      await Promise.allSettled([
        // Send email to ownership members who have email addresses
        ...ownershipMembers.map(async member => {
          try {
            const user = await User.findOne({
              tornPlayerId: member.id,
              email: { $ne: null }
            }, 'email');

            if (user && user.email) {
              const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_PORT === '465',
                requireTLS: process.env.SMTP_PORT !== '465',
                disableIPv6: true,
                connectionTimeout: 10000,
                greetingTimeout: 5000,
                socketTimeout: 15000,
                auth: {
                  user: process.env.SMTP_USER,
                  pass: process.env.SMTP_PASS
                },
                tls: {
                  rejectUnauthorized: false
                }
              });

              await transporter.sendMail({
                from: process.env.SMTP_USER,
                to: user.email,
                subject: 'New Faction Application',
                text: `A new faction application has been received:\n\n${message}\n\nView application details: https://www.torn.com/factions.php?step=profile&ID=53272`
              });

              console.log(`Email sent to ${user.email} for application notification`);
            }
          } catch (err) {
            console.error(`Failed to send email to ${member.name}:`, err.message);
          }
        })
      ]);

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
        `https://api.torn.com/v2/user/races?limit=${pageSize}&offset=${offset}&key=${dbUser.tornApiKey}`
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

    // Fetch bank rates and user merits from Torn API
    const [bankRes, userRes] = await Promise.all([
      axios.get('https://api.torn.com/torn/?selections=bank&key=' + dbUser.tornApiKey),
      axios.get('https://api.torn.com/user/?selections=merits&key=' + dbUser.tornApiKey)
    ]);

    if (bankRes.data.error) {
      return res.status(400).json({ error: 'Failed to fetch bank rates: ' + bankRes.data.error.error });
    }
    if (userRes.data.error) {
      return res.status(400).json({ error: 'Failed to fetch merits: ' + userRes.data.error.error });
    }

    const bankData = bankRes.data.bank || {};
    const meritsData = userRes.data.merits || {};
    
    // Debug: Log the merits data structure
    //console.log('[/api/torn/bank-rates] Merits data:', JSON.stringify(meritsData));
    
    // Get Bank Investment merit level (0-10)
    // Try different possible key formats based on API response
    const bankInvestmentMerit = meritsData['Bank Interest'] || 
                                 meritsData['Bank_Interest'] || 
                                 meritsData['Bank Investment'] || 
                                 meritsData['Bank_Investment'] || 
                                 meritsData['bankinterest'] || 
                                 meritsData['bankinvestment'] || 
                                 0;
    const meritBonus = bankInvestmentMerit * 5; // 5% per merit level
    
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
app.post('/api/oc/refresh', isAuthenticated, async (req, res) => {
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
app.get('/api/oc/crimes', isAuthenticated, async (req, res) => {
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
app.get('/api/oc/crimes/:crimeId', isAuthenticated, async (req, res) => {
  try {
    const crime = await getCrimeDetails(parseInt(req.params.crimeId));
    res.json(crime);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── API: Update checkpoint pass rates ────────────────────────────────────────
app.put('/api/oc/crimes/:crimeId/checkpoints', isAuthenticated, async (req, res) => {
  try {
    const { participantRates } = req.body;
    const result = await updateCheckpointRates(parseInt(req.params.crimeId), participantRates);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── API: Get participant history ─────────────────────────────────────────────
app.get('/api/oc/participants/:playerId', isAuthenticated, async (req, res) => {
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


module.exports = app;
