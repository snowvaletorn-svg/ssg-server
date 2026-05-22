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
    id: { type: Number }, 
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    cost: { type: Number, required: true }
  }],
  
  // Server metadata
  // REMOVED 'index: true' from here to prevent the duplicate index warning
  receivedAt: { type: Date, default: Date.now } 
});

// Compound index for efficient dashboard queries (fetching latest records by country)
stockObservationSchema.index({ country: 1, receivedAt: -1 });
stockObservationSchema.index({ 'stocks.id': 1, country: 1 });

// This single line indexes receivedAt AND applies the 7-day automatic cleanup rule
stockObservationSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('StockObservation', stockObservationSchema);