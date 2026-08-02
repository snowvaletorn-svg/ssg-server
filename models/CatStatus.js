const mongoose = require('mongoose');

const catStatusSchema = new mongoose.Schema({
  // The faction this status belongs to
  factionId: {
    type: Number,
    required: true,
    index: true
  },
  // The player whose status this is
  playerId: {
    type: Number,
    required: true
  },
  playerName: {
    type: String,
    default: ''
  },
  // Status fields
  status: {
    type: String, // 'Hospital', 'Okay', 'Traveling', 'Abroad', 'Jail', 'Federal', 'Fallen'
    default: 'Okay'
  },
  details: {
    type: String,
    default: null
  },
  until: {
    type: Number, // Unix timestamp (seconds) - when hospital/etc ends
    default: null
  },
  untilSource: {
    type: String, // 'absolute' or 'relative'
    default: null
  },
  previousStatus: {
    type: String,
    default: null
  },
  previousArea: {
    type: Number,
    default: null
  },
  departedAt: {
    type: Number, // Unix timestamp (ms)
    default: null
  },
  // Online status
  onlineStatus: {
    type: String, // 'online', 'idle', 'offline'
    default: 'offline'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Auto-purge: TTL index - documents expire after 2 hours
catStatusSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7200 });
// Compound index for queries
catStatusSchema.index({ factionId: 1, playerId: 1 });

module.exports = mongoose.model('CatStatus', catStatusSchema);