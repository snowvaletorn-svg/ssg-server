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
    id: { type: Number, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    cost: { type: Number, required: true }
  }],
  
  // Server metadata
  receivedAt: { type: Date, default: Date.now, index: true }
});

// Compound index for efficient queries
stockObservationSchema.index({ country: 1, receivedAt: -1 });
stockObservationSchema.index({ 'stocks.id': 1, country: 1 });

module.exports = mongoose.model('StockObservation', stockObservationSchema);