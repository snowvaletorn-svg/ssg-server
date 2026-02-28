require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const factionData = require('./data/factions');  // ADD THIS LINE
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
const PORT = process.env.PORT || 3000;

const pg = require('pg');
const pgSession = require('connect-pg-simple')(session);

const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, // Use the "Internal Database URL" from Render
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Define the store conditionally
let sessionStore;

app.set('trust proxy', 1);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Configuration
if (isProduction) {
  sessionStore = new pgSession({
    pool: pgPool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  });
} else {
  // Use default MemoryStore for local testing to avoid PG errors
  sessionStore = new session.MemoryStore();
}

// Update your app.use(session(...))
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: { 
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Passport Configuration
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

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/');
  }
  next();
};

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    user: req.user,
    faction: factionData.faction,
    groups: factionData.groups
  });
});

// Discord OAuth Routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => {
    // Manually save the session before redirecting to ensure it's in the store
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect('/dashboard');
    });
  }
);

// Dashboard Route (Protected)
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.render('dashboard', { user: req.user });
});

// Logout Route
app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.redirect('/');
  });
});

app.get('/api/torn/user', isAuthenticated, async (req, res) => {
  try {
    const tornResponse = await axios.get(`https://api.torn.com/user/?selections=profile&key=${process.env.TORN_API_KEY}`);
    res.json(tornResponse.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`SSG Server listening on http://localhost:${PORT}`);
});
module.exports = app;