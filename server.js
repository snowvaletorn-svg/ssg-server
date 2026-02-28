require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const factionData = require('./data/factions');

const isProduction = process.env.NODE_ENV === 'production';
const app = express();
const PORT = process.env.PORT || 3000;

// 1. SESSION STORE CONFIGURATION
// Use MongoDB in production (Render), MemoryStore locally
let sessionStore;

if (isProduction && process.env.MONGO_URI) {
  // Check if we are on Version 4+ (.create exists) or Version 3 (new MongoStore exists)
  if (typeof MongoStore.create === 'function') {
    sessionStore = MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: 'sessions',
      ttl: 14 * 24 * 60 * 60
    });
  } else {
    // Fallback for older versions (v3)
    sessionStore = new MongoStore({
      url: process.env.MONGO_URI,
      collection: 'sessions'
    });
  }
} else {
  sessionStore = new session.MemoryStore();
}

// 2. APP SETTINGS & MIDDLEWARE
app.set('trust proxy', 1); // Essential for Render HTTPS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 3. SESSION MIDDLEWARE
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: { 
    secure: isProduction, // Must be false for localhost HTTP
    sameSite: 'lax',      // Required for Discord OAuth redirect
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// 4. PASSPORT CONFIGURATION
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email', 'guilds']
  },
  (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    return done(null, profile);
  }
));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

app.use(passport.initialize());
app.use(passport.session());

// 5. AUTH MIDDLEWARE
const isAuthenticated = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
};

// 6. ROUTES
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
  (req, res) => {
    // Force session save before redirect to ensure production stability
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect('/dashboard');
    });
  }
);

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.render('dashboard', { user: req.user });
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.redirect('/');
  });
});

// 7. API ROUTES
app.get('/api/torn/user', isAuthenticated, async (req, res) => {
  try {
    const tornResponse = await axios.get('https://api.torn.com' + process.env.TORN_API_KEY);
    res.json(tornResponse.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. START SERVER
app.listen(PORT, () => {
  console.log(`SSG Server listening on http://localhost:${PORT}`);
});

module.exports = app;
