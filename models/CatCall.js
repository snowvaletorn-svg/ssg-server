const mongoose = require('mongoose');

const catCallSchema = new mongoose.Schema({
  // The faction this call belongs to (so calls are scoped per faction)
  factionId: {
    type: Number,
    required: true,
    index: true
  },
  // The player who made the call
  callerId: {
    type: Number,
    required: true
  },
  callerName: {
    type: String,
    required: true
  },
  // The target being called
  targetId: {
    type: Number,
    required: true
  },
  targetName: {
    type: String,
    required: true
  },
  // Hospital timer info - when the target is expected to wake
  hospitalUntil: {
    type: Number, // Unix timestamp (seconds)
    default: null
  },
  // Whether the target is currently awake (pulsing state)
  isAwake: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // When the call was last updated (e.g., hospital timer changed)
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for efficient queries: find active calls for a faction
catCallSchema.index({ factionId: 1, createdAt: -1 });
// Index for finding calls by target
catCallSchema.index({ factionId: 1, targetId: 1 });

module.exports = mongoose.model('CatCall', catCallSchema);