const mongoose = require('mongoose');

const userStatSnapshotSchema = new mongoose.Schema({
  tornPlayerId: { type: Number, required: true, index: true },
  strength: { type: Number, default: 0 },
  defense: { type: Number, default: 0 },
  speed: { type: Number, default: 0 },
  dexterity: { type: Number, default: 0 },
  totalStats: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now }
});

userStatSnapshotSchema.index({ tornPlayerId: 1, timestamp: -1 });

module.exports = mongoose.model('UserStatSnapshot', userStatSnapshotSchema);
