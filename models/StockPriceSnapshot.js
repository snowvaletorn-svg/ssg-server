const mongoose = require('mongoose');

/**
 * StockPriceSnapshot
 * 
 * Stores daily snapshots of Torn Stock Exchange prices.
 * Used for historical ROI tracking and trend analysis.
 * A scheduled task runs daily at 00:00 TCT to capture prices.
 */
const stockPriceSnapshotSchema = new mongoose.Schema({
  // The date this snapshot was taken (YYYY-MM-DD)
  snapshotDate: { type: String, required: true, index: true },
  
  // When this snapshot was recorded
  recordedAt: { type: Date, default: Date.now },

  // Array of all stock prices at this snapshot
  stocks: [{
    stockId: { type: Number, required: true },
    name: { type: String, required: true },
    acronym: { type: String, required: true },
    price: { type: Number, required: true },
    marketCap: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    investors: { type: Number, default: 0 },
    availableShares: { type: Number, default: 0 },
    dividend: { type: Number, default: 0 },         // Annual dividend per share
    benefit: { type: String, default: '' },          // Benefit description
    benefitValue: { type: Number, default: 0 },      // Estimated benefit value
    isTiered: { type: Boolean, default: false },
    tiers: [{
      tier: { type: Number },
      sharesRequired: { type: Number },
      benefit: { type: String },
      benefitValue: { type: Number, default: 0 }
    }]
  }]
});

// Index for fast lookups by date
stockPriceSnapshotSchema.index({ snapshotDate: 1, recordedAt: -1 });

// TTL: keep snapshots for 2 years (730 days)
stockPriceSnapshotSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });

module.exports = mongoose.model('StockPriceSnapshot', stockPriceSnapshotSchema);