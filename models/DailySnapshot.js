const mongoose = require('mongoose');

// Daily snapshot of all member personalstats, used as the read model for the
// competition page (and any other "current state" leaderboard). Separate
// collection from WeeklySnapshot so the weekly leadership report and its diffs
// are never mixed with daily documents.
//
// Same member row shape as WeeklySnapshot: `personalstats` is the full Torn
// personalstats object (~214 stats) stored alongside the legacy totalStats.
const memberStatSchema = new mongoose.Schema({
  playerId: { type: Number, required: true },
  playerName: { type: String, required: true },
  totalStats: { type: Number, required: true },
  timestamp: { type: Date, required: true },
  personalstats: { type: mongoose.Schema.Types.Mixed, default: undefined },
  // Torn faction position at snapshot time (e.g. 'Team Growth', 'Murder Child').
  // Optional so legacy rows without it still validate.
  position: { type: String, default: null }
}, { _id: false });

const dailySnapshotSchema = new mongoose.Schema({
  // Unique identifier: daily_YYYY-MM-DD (one document per calendar day)
  snapshotId: { type: String, required: true, unique: true },

  // Date the snapshot represents (YYYY-MM-DD, UTC)
  snapshotDate: { type: Date, required: true },

  // Faction ID (always 53272 for SSG)
  factionId: { type: Number, required: true, default: 53272 },

  // Member stats at snapshot time (full personalstats per member)
  memberStats: [memberStatSchema],

  // Metadata
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

dailySnapshotSchema.pre('save', function (next) {
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

module.exports = mongoose.model('DailySnapshot', dailySnapshotSchema);