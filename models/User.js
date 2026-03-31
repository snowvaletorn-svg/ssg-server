const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  discordId:        { type: String, required: true, unique: true },
  username:         { type: String, required: true },
  tornApiKey:       { type: String, default: null },
  tornPlayerId:     { type: Number, default: null },
  tornName:         { type: String, default: null },
  tornKeyUpdatedAt: { type: Date,   default: null },
  lastSeen:         { type: Date,   default: null },
  createdAt:        { type: Date,   default: Date.now },
  updatedAt:        { type: Date,   default: Date.now },
  levelProgressCache: { type: Object, default: null },
  levelProgressCachedAt: { type: Date, default: null },
  bankRatesCache: { type: Object, default: null },
  bankRatesCachedAt: { type: Date, default: null }
});

userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', userSchema);
