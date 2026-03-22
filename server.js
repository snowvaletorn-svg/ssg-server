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
const SSG_GUILD_ID   = '1432576178383753309';
const SSG_FACTION_ID = 53272;

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

const TRAINING_CHANNELS = [
  {
    id: '1435414594410512494',
    name: '📊 Stats Training',
    description: 'Advanced stat training guides and strategies.',
    roles: [ROLES.ownership, ROLES.leadership, ROLES.strategy, ROLES.strength]
  },
  {
    id: '1435416169946415194',
    name: '💰 Money Making Training',
    description: 'Guides on making money to fund your stats growth.',
    roles: [ROLES.ownership, ROLES.leadership, ROLES.strategy, ROLES.strength]
  },
  {
    id: '1435413325725958165',
    name: '⬆️ Level Training',
    description: 'Everything you need to know about leveling up fast.',
    roles: [ROLES.ownership, ROLES.leadership, ROLES.strategy, ROLES.strength, ROLES.growth]
  },
  {
    id: '1435414982316654746',
    name: '🔗 Chains',
    description: 'Detailed walkthrough on what chains are.',
    roles: [ROLES.ownership, ROLES.leadership, ROLES.strategy, ROLES.strength, ROLES.growth]
  },
  {
    id: '1435416378709508138',
    name: '🫆 Crimes Training',
    description: 'Guide for all members on Crimes in Torn.',
    roles: [ROLES.ownership, ROLES.leadership, ROLES.strategy, ROLES.strength, ROLES.growth]
  },
  {
    id: '1435416812706857225',
    name: '🗝️ Organized Crimes Training',
    description: 'Guide for all members on Organized Crimes in Torn.',
    roles: [ROLES.ownership, ROLES.leadership, ROLES.strategy, ROLES.strength, ROLES.growth]
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
  clientID:    process.env.DISCORD_CLIENT_ID,
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
      { discordId: profile.id, username: profile.username, lastSeen: new Date() },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    console.error('MongoDB upsert error:', err.message);
  }

  return done(null, profile);
}));

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

const isLeadershipOrOwnership = (req, res, next) => {
  const roles = req.user?.ssgRoles || [];
  if (!roles.includes(ROLES.ownership) && !roles.includes(ROLES.leadership)) {
    return res.status(403).json({ error: 'Leadership or Ownership role required.' });
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
app.get('/', async (req, res) => {
  let liveGroups   = factionData.groups;
  let totalMembers = factionData.faction.memberCount;

  try {
    const factionKey = await getFactionApiKey();
    if (factionKey) {
      const tornRes = await axios.get(
        `https://api.torn.com/v2/faction/?selections=basic,members&key=${factionKey}`
      );
      const factionMembers = tornRes.data.members || [];

      const positionMap = {
        'Leader':        'Ownership',
        'Co-leader':     'Ownership',
        'Matriarch':     'Ownership',
        'War Lord':      'Leadership',
        'Leadership':    'Leadership',
        'Team Strategy': 'Strategy',
        'Team Strength': 'Strength',
        'Team Growth':   'Growth',
        'Recruit':       'Growth'
      };

      const counts = {};
      factionMembers.forEach(m => {
        const groupName = positionMap[m.position];
        if (groupName) counts[groupName] = (counts[groupName] || 0) + 1;
      });

      liveGroups   = factionData.groups.map(g => ({ ...g, members: counts[g.name] ?? g.members }));
      totalMembers = factionMembers.length;
    }
  } catch (err) {
    console.error('Could not fetch live faction data for home page:', err.message);
  }

  res.render('index', {
    user:    req.user,
    faction: { ...factionData.faction, memberCount: totalMembers },
    groups:  liveGroups
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
  const ssgRoles    = req.user.ssgRoles || [];
  const allowedRoles = Object.values(ROLES);
  const hasRole     = ssgRoles.some(r => allowedRoles.includes(r));

  if (!hasRole) return res.redirect('/?error=no_access');

  await User.findOneAndUpdate({ discordId: req.user.id }, { lastSeen: new Date() });

  const dbUser             = await User.findOne({ discordId: req.user.id });
  const accessibleChannels = getAccessibleChannels(req.user.ssgRoles || []);
  const isOwner            = req.user.ssgRoles?.includes(ROLES.ownership)  || false;
  const isLeadership       = req.user.ssgRoles?.includes(ROLES.leadership) || false;
  const factionKey         = await getFactionApiKey();

  const accessibleTraining = TRAINING_CHANNELS.filter(ch =>
    ch.roles.some(r => (req.user.ssgRoles || []).includes(r))
  );

  res.render('dashboard', {
    user: req.user,
    accessibleChannels,
    accessibleTraining,
    tornApiKey:    dbUser?.tornApiKey || null,
    isOwner,
    isLeadership,
    hasFactionKey: !!factionKey
  });
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
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
      {
        tornApiKey:       apiKey.trim(),
        tornPlayerId:     tornRes.data.player_id,
        tornName:         tornRes.data.name,
        tornKeyUpdatedAt: new Date()
      },
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
    const dbUser = await User.findOne({ discordId: req.user.id });
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
      honors_time:    userRes.data.honors_time    || {},
      merits:         userRes.data.merits         || {},
      all_honors:     tornRes.data.honors         || {}
    });
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

// ─── API: Faction travel status ───────────────────────────────────────────────
app.get('/api/torn/faction-travel', isAuthenticated, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const factionRes      = await axios.get(
      `https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`
    );
    const members         = factionRes.data.members || [];
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
            id:       u.tornPlayerId,
            name:     factionMember.name,
            position: factionMember.position,
            travel:   tornRes.data.travel
          };
        } catch { return null; }
      })
    );

    const enriched    = travelResults.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value);
    const enrichedIds = new Set(enriched.map(e => e.id));
    const basicOnly   = travelingMembers
      .filter(m => !enrichedIds.has(m.id))
      .map(m => ({ id: m.id, name: m.name, position: m.position, description: m.status.description, travel: null }));

    res.json({
      traveling: [...enriched, ...basicOnly].sort((a, b) => a.name.localeCompare(b.name)),
      total:     travelingMembers.length
    });
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

// ─── API: War hits tracking ───────────────────────────────────────────────────
app.get('/api/torn/wars', isAuthenticated, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const warsRes  = await axios.get(`https://api.torn.com/v2/faction/?selections=wars&key=${factionKey}`);
    const warData  = warsRes.data;
    const warStart = warData.wars?.ranked?.start || 0;

    if (!warStart) {
      return res.json({ war: null, memberHits: [], totalWarAttacks: 0 });
    }

    let allAttacks      = [];
    let nextUrl         = `https://api.torn.com/v2/faction/attacks?limit=100&sort=desc&key=${factionKey}`;
    let reachedWarStart = false;

    while (nextUrl && !reachedWarStart) {
      const attacksRes = await axios.get(nextUrl);
      const attacks    = attacksRes.data.attacks || [];
      const prevLink   = attacksRes.data._metadata?.links?.prev;

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
      const id   = a.attacker.id;
      const name = a.attacker.name;
      if (!hitCounts[id]) hitCounts[id] = { id, name, hits: 0, respect: 0 };
      hitCounts[id].hits++;
      hitCounts[id].respect += a.respect_gain || 0;
    });

    res.json({
      war:              warData.wars?.ranked || null,
      memberHits:       Object.values(hitCounts).sort((a, b) => b.hits - a.hits),
      totalWarAttacks:  allAttacks.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Member total stats (Leadership/Ownership only) ─────────────────────
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
            name:       tornRes.data.name,
            player_id:  tornRes.data.player_id,
            level:      tornRes.data.level,
            totalstats: tornRes.data.personalstats?.totalstats || 0,
            strength:   tornRes.data.personalstats?.strength   || 0,
            defense:    tornRes.data.personalstats?.defense    || 0,
            speed:      tornRes.data.personalstats?.speed      || 0,
            dexterity:  tornRes.data.personalstats?.dexterity  || 0,
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

// ─── API: Admin member overview ───────────────────────────────────────────────
app.get('/api/admin/member-overview', isAuthenticated, isLeadershipOrOwnership, async (req, res) => {
  try {
    const factionKey = await getFactionApiKey();
    if (!factionKey) return res.status(400).json({ error: 'No faction API key configured.' });

    const factionRes     = await axios.get(`https://api.torn.com/v2/faction/?selections=members&key=${factionKey}`);
    const factionMembers = factionRes.data.members || [];

    const dbUsers    = await User.find({}, 'discordId username tornApiKey tornPlayerId tornName lastSeen tornKeyUpdatedAt');
    const dbByTornId = {};
    dbUsers.forEach(u => { if (u.tornPlayerId) dbByTornId[u.tornPlayerId] = u; });

    const enrichResults = await Promise.allSettled(
      factionMembers.map(async m => {
        const dbUser = dbByTornId[m.id];
        const base   = {
          id:               m.id,
          name:             m.name,
          level:            m.level,
          position:         m.position,
          days_in_faction:  m.days_in_faction,
          last_action:      m.last_action,
          revive_setting:   m.revive_setting,
          status:           m.status,
          hasApiKey:        !!dbUser?.tornApiKey,
          discordId:        dbUser?.discordId        || null,
          lastSeen:         dbUser?.lastSeen         || null,
          tornKeyUpdatedAt: dbUser?.tornKeyUpdatedAt || null,
          property:         null,
          job:              null,
          energy:           null,
          cooldowns:        null,
          tornLastAction:   null
        };

        if (!dbUser?.tornApiKey) return base;

        try {
          const [v1Res, v2Res] = await Promise.all([
            axios.get(`https://api.torn.com/user/?selections=basic,profile,bars&key=${dbUser.tornApiKey}`),
            axios.get(`https://api.torn.com/v2/user/?selections=cooldowns&key=${dbUser.tornApiKey}`)
          ]);
          if (!v1Res.data.error) {
            base.property       = v1Res.data.property     || null;
            base.job            = v1Res.data.job           || null;
            base.energy         = v1Res.data.energy        || null;
            base.tornLastAction = v1Res.data.last_action   || null;
          }
          if (!v2Res.data.error) {
            base.cooldowns = v2Res.data.cooldowns || null;
          }
        } catch { /* enrichment failed, return base */ }

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

// ─── API: Remove user from dashboard (Ownership only) ─────────────────────────
app.delete('/api/admin/user/:discordId', isAuthenticated, isOwnership, async (req, res) => {
  try {
    const { discordId } = req.params;
    if (discordId === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself.' });
    }
    const result = await User.findOneAndDelete({ discordId });
    if (!result) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ success: true, removed: result.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Level progress via HOF ──────────────────────────────────────────────
app.get('/api/torn/levelprogress', isAuthenticated, async (req, res) => {
  try {
    const dbUser = await User.findOne({ discordId: req.user.id });
    if (!dbUser?.tornApiKey) {
      return res.status(400).json({ error: 'No Torn API key saved.' });
    }

    const hofRes = await axios.get(
      `https://api.torn.com/v2/user/hof?key=${dbUser.tornApiKey}`
    );
    if (hofRes.data.error) {
      return res.status(400).json({ error: hofRes.data.error.error });
    }

    const level = hofRes.data.hof.level.value;
    const rank  = hofRes.data.hof.level.rank;

    if (level >= 100) {
      return res.json({ level, rank, progress: 100, display: '100.00' });
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const INACTIVE_THRESHOLD = 365 * 24 * 60 * 60;

    // Start searching near the user's rank and work outward
    async function findInactiveAtLevel(targetLevel, startRank) {
      // Start offset near where this level's players should be
      let offset = Math.max(0, startRank - 200);
      offset = Math.floor(offset / 100) * 100; // round to nearest 100

      for (let attempt = 0; attempt < 100; attempt++) {
        const hofPage = await axios.get(
          `https://api.torn.com/v2/torn/hof?limit=100&offset=${offset}&cat=level&key=${dbUser.tornApiKey}`
        );
        const players = hofPage.data.hof || [];
        if (!players.length) break;

        const levels = players.map(p => p.level);
        const minLevel = Math.min(...levels);
        const maxLevel = Math.max(...levels);

        // Find inactive player at target level in this batch
        for (const player of players) {
          if (player.level === targetLevel &&
              (currentTime - player.last_action) > INACTIVE_THRESHOLD) {
            return player.position;
          }
        }

        // Navigate based on where target level players would be
        if (maxLevel < targetLevel) {
          // All players here are lower level, go backwards (lower offset = higher level)
          offset = Math.max(0, offset - 100);
        } else if (minLevel > targetLevel) {
          // All players here are higher level, go forwards
          offset += 100;
        } else {
          // Target level exists in this range but no inactive found, keep going forward
          offset += 100;
        }
      }
      return null;
    }

    // For level N-1, those players are ranked higher (lower rank number) than level N
    // So search slightly above the user's rank for level-1, and at/below for current level
    const [lowerPos, currentPos] = await Promise.all([
      findInactiveAtLevel(level - 1, Math.max(0, rank - 500)),
      findInactiveAtLevel(level,     rank)
    ]);

    if (!lowerPos || !currentPos) {
      return res.json({ level, rank, progress: null, display: String(level) });
    }

    let relative = (lowerPos - rank) / (lowerPos - currentPos);
    relative     = Math.min(Math.round(relative * 100) / 100, 0.99);
    const display = (level + relative).toFixed(2);

    res.json({ level, rank, progress: Math.round(relative * 100), display });
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
    'Do you agree that once you\'re over level 15, you will do a stat jump (candy, happy, console, etc.) weekly?'
  ];

  const answerLines = questions.map((q, i) => {
    const answer = answers[`q${i + 1}`];
    const icon   = answer === 'yes' ? '✅' : '❌';
    return `${i + 1}. ${q}\n   ${icon} ${answer === 'yes' ? 'Agreed' : 'Did not agree'}`;
  });

  const flag    = allYes ? '✅ All conditions agreed' : '⚠️ One or more conditions NOT agreed';
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
    const membersRes = await axios.get(
      `https://discord.com/api/v10/guilds/${SSG_GUILD_ID}/members?limit=1000`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
    const ownershipMembers = membersRes.data.filter(m => m.roles.includes(ROLES.ownership));

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

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SSG Server listening on http://localhost:${PORT}`);
});

module.exports = app;
