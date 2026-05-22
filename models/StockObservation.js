const mongoose = require('mongoose');

const stockObservationSchema = new mongoose.Schema({
  // Who submitted this observation
  playerId: { type: Number, required: true, index: true },
  playerName: { type: String, default: '' },
  
  // Where and when observed
  country: { type: String, required: true, index: true }, // e.g., 'jap', 'mex', 'cay'
  observedAt: { type: Number, required: true }, // Unix timestamp (seconds)
  
  // What was observed
  stocks: [{
    id: { type: Number }, // Made optional to prevent validation blocks during processing anomalies
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    cost: { type: Number, required: true }
  }],
  
  // Server metadata
  receivedAt: { type: Date, default: Date.now, index: true }
});

// Compound index for efficient dashboard queries (fetching latest records by country)
stockObservationSchema.index({ country: 1, receivedAt: -1 });
stockObservationSchema.index({ 'stocks.id': 1, country: 1 });

// OPTIONAL OPTIMIZATION: Automatically deletes records older than 7 days (604800 seconds) 
// to keep your free database tier running cleanly.
stockObservationSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('StockObservation', stockObservationSchema);