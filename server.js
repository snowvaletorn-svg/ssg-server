require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const factionData = require('./data/factions');
const User = require('./models/User');
const FactionConfig = require('./models/FactionConfig');

const isProduction = process.env.NODE_ENV === 'production';
const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const SSG_GUILD_ID = '1432576178383753309';
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
      const tornRes = await axios.get(
        `https://api.torn.com/v2/faction/?selections=basic,members&key=${factionKey}`
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

      liveGroups = factionData.groups.map(g => ({ ...g, members: counts[g.name] ?? g.members }));
      totalMembers = factionMembers.length;
    }
  } catch (err) {
    console.error('Could not fetch live faction data for home page:', err.message);
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

  // Step 3: Check if user exists in database
  let user = await User.findOne({ tornPlayerId: tornId });

  if (user) {
    // Existing user - update API key and login
    user.tornApiKey = apiKey;
    user.tornName = tornName;
    user.tornKeyUpdatedAt = new Date();
    user.lastSeen = new Date();
    await user.save();
  } else {
    // New user - check if they're in the faction
    const factionCheck = await isPlayerInFaction(tornId);
    if (!factionCheck.inFaction) {
      return res.status(403).json({ error: 'You are not a member of SSG faction. Please apply first.' });
    }

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

// ─── API: Discord channel messages ───────────────────────────────────────────
app.get('/api/discord/channel/:channelId', isAuthenticated, async (req, res) => {
  const { channelId } = req.params;
  const allowed = Object.values(CHANNELS).map(c => c.id);
  if (!allowed.includes(channelId)) {
    return res.status(403).json({ error: 'Channel not permitted' });
  }
  const accessibleChannels = getAccessibleChannels(req.session.user?.positionGroup);
  const hasAccess = accessibleChannels.some(c => c.id === channelId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to this channel' });
  }
  try {
    const response = await axios.get(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=10`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Discord API error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch messages', details: err.response?.data });
  }
});

// ─── API: Discord members ─────────────────────────────────────────────────────
app.get('/api/discord/members', isAuthenticated, async (req, res) => {
  try {
    const response = await axios.get(
      `https://discord.com/api/v10/guilds/${SSG_GUILD_ID}/members?limit=1000`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Discord members error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
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

    const dbUsers = await User.find({}, 'tornPlayerId tornName tornApiKey lastSeen tornKeyUpdatedAt discordId');
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

    const dbUsers = await User.find({}, 'tornPlayerId tornName tornApiKey lastSeen tornKeyUpdatedAt discordId');
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
    'Do you agree to join and actively participate, daily, in discord?',
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

    await Promise.allSettled(
      ownershipMembers.map(async member => {
        const dmChannel = await axios.post(
          'https://discord.com/api/v10/users/@me/channels',
          { recipient_id: member.user.id },
          { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );
        await axios.post(
          `https://discord.com/api/v10/channels/${dmChannel.data.id}/messages`,
          { content: message },
          { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );
      })
    );

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

    const tornRes = await axios.get(
      'https://api.torn.com/torn/?selections=bank&key=' + dbUser.tornApiKey
    );

    if (tornRes.data.error) {
      return res.status(400).json({ error: 'Failed to fetch bank rates: ' + tornRes.data.error.error });
    }

    const bankData = tornRes.data.bank || {};
    const rates = {
      '1_week': bankData['1w'] || 0,
      '2_weeks': bankData['2w'] || 0,
      '1_month': bankData['1m'] || 0,
      '2_months': bankData['2m'] || 0,
      '3_months': bankData['3m'] || 0
    };

    const now = new Date();
    const cacheDuration = 60 * 60 * 1000;
    const result = {
      rates: rates,
      lastUpdated: now.toISOString(),
      cacheExpiry: new Date(now.getTime() + cacheDuration).toISOString()
    };

    await User.findOneAndUpdate(
      { tornPlayerId: req.session.userId },
      { bankRatesCache: result, bankRatesCachedAt: now }
    );

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

module.exports = app;