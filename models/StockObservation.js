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
    id: { 
      type: String, 
      default: function() {
        // Generate stable ID from name if not provided
        return this.name ? this.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_') : '';
      }
    }, 
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    cost: { type: Number, required: true }
  }],
  
  // Server metadata
  // Explicitly keep this as a basic un-indexed field here
  receivedAt: { type: Date, default: Date.now } 
});

// Compound indices for clean dashboard pipeline processing
stockObservationSchema.index({ country: 1, receivedAt: -1 });
stockObservationSchema.index({ 'stocks.id': 1, country: 1, 'stocks.name': 1 });

// Single dedicated TTL rule index handling database cleanup seamlessly
stockObservationSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('StockObservation', stockObservationSchema);