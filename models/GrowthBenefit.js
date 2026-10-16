// One-war-only record of the Growth first-war baseline benefit. One doc per
// player EVER (unique playerId): once marked `used`, the member is ineligible
// for future wars unless leadership grants an `override` exception — and
// marking paid clears any override, so an exception buys exactly one more war.
// `undo` sets used=false (eligibility then falls back to the 21-day rule).
const mongoose = require('mongoose');

const growthBenefitSchema = new mongoose.Schema({
  playerId: { type: Number, required: true, unique: true },
  playerName: { type: String, default: '' },
  used: { type: Boolean, default: false },
  override: { type: Boolean, default: false },
  warKey: { type: Number, default: null },     // war start (epoch secs) of the paid war
  amount: { type: Number, default: 0 },
  recordedBy: { type: String, default: null },
  recordedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

growthBenefitSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  if (typeof next === 'function') next();
});

module.exports = mongoose.model('GrowthBenefit', growthBenefitSchema);