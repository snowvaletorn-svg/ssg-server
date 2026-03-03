require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const mongoose = require('mongoose');
const factionData = require('./data/factions');
const User = require('./models/User');
const FactionConfig = require('./models/FactionConfig');

const isProduction = process.env.NODE_ENV === 'production';
const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const SSG_GUILD_ID = '1432576178383753309';

const CHANNELS = {
  announcements: { id: '1466403384038002844', name: '📢 Announcements' },
  growth:        { id: '1435061563118850199', name: '🌱 Growth Training' },
  strength:      { id: '1454519260960391494', name: '💪 Strength Training' },
  strategy:      { id: '1454519584445960234', name: '♟️ Strategy' },
  war:           { id: '1435065561494196254', name: '⚔️ War Chat' },
};

const ROLES = {
  ownership:  '1433161746365026334',
  leadership: '1462906795860295802',
  strategy:   '1435059774722015232',
  strength:   '1435060058063896698',
  growth:     '1435060175525384303',
};

const ROLE_CHANNEL_ACCESS = {
  [ROLES.ownership]:  ['announcements', 'growth', 'strength', 'strategy', 'war'],
  [ROLES.leadership]: ['announcements', 'growth', 'strength', 'strategy', 'war'],
  [ROLES.strategy]:   ['announcements', 'growth', 'strength', 'strategy', 'war'],
  [ROLES.strength]:   ['announcements', 'strength', 'war'],
  [ROLES.growth]:     ['announcements', 'growth', 'war'],
};

// ─── HELPER: Get faction API key (DB first, ENV fallback) ─────────────────────
async function getFactionApiKey() {
  try {
    const config = await FactionConfig.findOne({ key: 'config' });
    if (config?.tornFactionApiKey) return config.tornFactionApiKey;
  } catch (err) {
    console.error('Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY || null;
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

// ─── APP SETTINGS & MIDDLEWARE ────────────────────────────────────────────────
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── SESSION ──────────────────────────────────────────────────────────────────
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: {
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));

// ─── PASSPORT ────────────────────────────────────────────────────────────────
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email', 'guilds', 'guilds.members.read']
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      profile.accessToken = accessToken;
      const memberRes = await axios.get(
        `https://discord.com/api/v10/users/@me/guilds/${SSG_GUILD_ID}/member`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      profile.ssgRoles = memberRes.data.roles || [];
      profile.ssgNick  = memberRes.data.nick || profile.username;
    } catch (err) {
      console.error('Could not fetch SSG member data:', err.response?.data || err.message);
      profile.ssgRoles = [];
      profile.ssgNick  = profile.username;
    }

    try {
      await User.findOneAndUpdate(
        { discordId: profile.id },
        { discordId: profile.id, username: profile.username },
        { upsert: true, returnDocument: 'after' }
      );
    } catch (err) {
      console.error('MongoDB upsert error:', err.message);
    }

    return done(null, profile);
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.use(passport.initialize());
app.use(passport.session());

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const isAuthenticated = (req, res, next) => {
  if (!req.user) return res.redirect('/');
  next();
};

const isOwnership = (req, res, next) => {
  if (!req.user?.ssgRoles?.includes(ROLES.ownership)) {
    return res.status(403).json({ error: 'Ownership role required.' });
  }
  next();
};

// ─── HELPER ──────────────────────────────────────────────────────────────────
function getAccessibleChannels(ssgRoles) {
  const accessible = new Set();
  for (const roleId of ssgRoles) {
    const channels = ROLE_CHANNEL_ACCESS[roleId];
    if (channels) channels.forEach(ch => accessible.add(ch));
  }
  if (accessible.size === 0) accessible.add('announcements');
  return [...accessible].map(key => ({ key, ...CHANNELS[key] }));
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.render('index', {
    user: req.user,
    faction: factionData.faction,
    groups: factionData.groups
  });
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res, next) => {
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect('/dashboard');
    });
  }
);

app.get('/dashboard', isAuthenticated, async (req, res) => {
  const dbUser = await User.findOne({ discordId: req.user.id });
  const accessibleChannels = getAccessibleChannels(req.user.ssgRoles || []);
  const isOwner = req.user.ssgRoles?.includes(ROLES.ownership) || false;
  const factionKey = await getFactionApiKey();

  res.render('dashboard', {
    user: req.user,
    accessibleChannels,
    tornApiKey: dbUser?.tornApiKey || null,
    isOwner,
    hasFactionKey: !!factionKey
  });
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.redirect('/');
  });
});

// ─── API: Discord channel messages ───────────────────────────────────────────
app.get('/api/discord/channel/:channelId', isAuthenticated, async (req, res) => {
  const { channelId } = req.params;
  const allowed = Object.values(CHANNELS).map(c => c.id);
  if (!allowed.includes(channelId)) {
    return res.status(403).json({ error: 'Channel not permitted' });
  }
  const accessibleChannels = getAccessibleChannels(req.user.ssgRoles || []);
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
      { discordId: req.user.id },
      { tornApiKey: apiKey.trim() },
      { upsert: true }
    );
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
      { tornFactionApiKey: apiKey.trim(), setBy: req.user.id, updatedAt: new Date() },
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
    const dbUser = await User.findOne({ discordId: req.user.id });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved. Please add your key first.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=basic,profile,bars&key=${dbUser.tornApiKey}`
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

// ─── API: Personal crime XP (merits) ─────────────────────────────────────────
app.get('/api/torn/crimeexp', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ discordId: req.user.id });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/user/?selections=merits&key=${dbUser.tornApiKey}`
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
      return res.status(400).json({ error: 'No faction API key configured. An Ownership member must set it in their profile.' });
    }
    const tornRes = await axios.get(
      `https://api.torn.com/v2/faction/?selections=basic,members&key=${factionKey}`
    );
    res.json(tornRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Travel status from Torn ────────────────────────────────────────────
app.get('/api/torn/travel', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ discordId: req.user.id });
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

// ─── API: Torn item catalog (for categories) ──────────────────────────────────
app.get('/api/torn/items', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ discordId: req.user.id });
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
      headers: { 'User-Agent': 'SSG-Dashboard/1.0' },
      timeout: 10000
    });
    res.json(yataRes.data);
  } catch (err) {
    console.error('YATA API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch YATA travel data' });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SSG Server listening on http://localhost:${PORT}`);
});

module.exports = app;
