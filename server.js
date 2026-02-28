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
let sessionStore;

if (isProduction && process.env.MONGO_URI) {
  // Logic to handle different versions of connect-mongo (v3, v4, v5)
  // This avoids the "not a constructor" error by checking for .create first
  if (MongoStore.create) {
    sessionStore = MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: 'sessions',
      ttl: 14 * 24 * 60 * 60
    });
  } else {
    // If .create doesn't exist, we fall back to the constructor
    // but we ensure we are calling the right property
    const Store = MongoStore.default || MongoStore;
    sessionStore = new Store({
      mongoUrl: process.env.MONGO_URI,
      collectionName: 'sessions'
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
  // Force proxy to true in production to handle Render's SSL
  proxy: isProduction, 
  cookie: { 
    secure: isProduction, 
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    // Add this: it helps with .onrender.com domain restrictions
    domain: isProduction ? '.onrender.com' : undefined 
  }
}));

// 4. PASSPORT CONFIGURATION
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    // FORCE this to the full absolute URL for one test:
    callbackURL: "https://ssg-server.onrender.com/auth/discord/callback",
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
    // Manually save the session to the database (MongoDB)
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
