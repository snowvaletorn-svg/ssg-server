const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Torn authentication (primary method)
  tornPlayerId:     { type: Number, required: true, unique: true },
  tornName:         { type: String, required: true },
  tornApiKey:       { type: String, required: true },
  tornKeyUpdatedAt: { type: Date,   default: Date.now },
  
  // Display name (defaults to Torn name)
  username:         { type: String, required: true },
  
  // Activity tracking
  lastSeen:         { type: Date,   default: Date.now },
  createdAt:        { type: Date,   default: Date.now },
  updatedAt:        { type: Date,   default: Date.now },
  
  // Cached data
  levelProgressCache: { type: Object, default: null },
  levelProgressCachedAt: { type: Date, default: null },
  bankRatesCache: { type: Object, default: null },
  bankRatesCachedAt: { type: Date, default: null },

  // Faction member profile fields
  bloodType: { type: String, default: null },
  timeZone: { type: String, default: null },
  email: { type: String, default: null },

  // FFScouter API key (per-user, for target finder feature)
  ffScouterKey: { type: String, default: null }
});

userSchema.pre('save', function(next) {
  try {
    this.updatedAt = Date.now();
    if (typeof next === 'function') {
      next();
    }
  } catch (err) {
    if (typeof next === 'function') {
      next(err);
    } else {
      throw err;
    }
  }
});

module.exports = mongoose.model('User', userSchema);