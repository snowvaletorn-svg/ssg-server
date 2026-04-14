const mongoose = require('mongoose');

const weeklySnapshotSchema = new mongoose.Schema({
  // Unique identifier for the snapshot
  snapshotId: { type: String, required: true, unique: true },
  
  // Date when the snapshot was taken
  snapshotDate: { type: Date, required: true },
  
  // Faction ID (always 53272 for SSG)
  factionId: { type: Number, required: true, default: 53272 },
  
  // Array of member stats at snapshot time
  memberStats: [{
    playerId: { type: Number, required: true },
    playerName: { type: String, required: true },
    totalStats: { type: Number, required: true },
    timestamp: { type: Date, required: true }
  }],
  
  // Metadata
  createdBy: { type: String, required: true }, // User ID who created it
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Pre-save hook to update timestamp
weeklySnapshotSchema.pre('save', function(next) {
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

module.exports = mongoose.model('WeeklySnapshot', weeklySnapshotSchema);