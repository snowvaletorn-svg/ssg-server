const mongoose = require('mongoose');

const catUserSchema = new mongoose.Schema({
  playerId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  playerName: {
    type: String,
    required: true
  },
  factionId: {
    type: Number,
    required: true,
    index: true
  },
  authToken: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Auto-delete after 90 days of inactivity (matching original CAT behavior)
catUserSchema.methods.isExpired = function () {
  const daysInactive = (Date.now() - this.lastActive.getTime()) / (1000 * 60 * 60 * 24);
  return daysInactive > 90;
};

module.exports = mongoose.model('CatUser', catUserSchema);