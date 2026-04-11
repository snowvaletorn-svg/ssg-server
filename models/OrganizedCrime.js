const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  playerId: { type: Number, required: true },
  playerName: { type: String, default: '' },
  role: { type: String, default: '' }, // OC position (e.g., "Picklock", "Car Thief")
  tool: { type: String, default: 'N/A' }, // Tool/item required for this position
  status: {
    color: { type: String, enum: ['blue', 'green', 'red'], default: 'blue' },
    description: { type: String, default: '' },
    details: { type: String, default: '' },
    state: { 
      type: String, 
      enum: ['Abroad', 'Fallen', 'Federal', 'Hospital', 'Jail', 'Okay', 'Traveling'],
      default: 'Okay'
    },
    until: { type: Date }
  },
  checkpointPassRate: { type: Number, min: 0, max: 100, default: null }, // Auto-populated from API
  checkpointStatus: { 
    type: String, 
    enum: ['passed', 'failed', 'pending'],
    default: 'pending'
  }
});

const organizedCrimeSchema = new mongoose.Schema({
  crimeId: { type: Number, required: true, unique: true },
  crimeName: { type: String, required: true },
  factionId: { type: Number, required: true, default: 53272 },
  
  // Crime status
  initiated: { type: Boolean, default: false },
  success: { type: Boolean, default: null }, // null if not yet completed
  status: { 
    type: String, 
    enum: ['pending', 'succeeded', 'failed'],
    default: 'pending'
  },
  
  // Timing
  timeStarted: { type: Date },
  timeReady: { type: Date },
  timeCompleted: { type: Date },
  timeLeft: { type: Number }, // seconds remaining
  
  // Rewards
  moneyGain: { type: Number, default: 0 },
  respectGain: { type: Number, default: 0 },
  
  // Members involved
  initiatedBy: { type: Number },
  plannedBy: { type: Number },
  
  // Participants array
  participants: [participantSchema],
  
  // Tracking fields
  lastFetchedAt: { type: Date, default: Date.now },
  isComplete: { type: Boolean, default: false },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance (crimeId already has index: true + unique)
organizedCrimeSchema.index({ factionId: 1 });
organizedCrimeSchema.index({ status: 1 });
organizedCrimeSchema.index({ timeStarted: 1 });
organizedCrimeSchema.index({ isComplete: 1 });

// Update timestamp before saving
organizedCrimeSchema.pre('save', function(next) {
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

// Static method to get crimes with filtering
organizedCrimeSchema.statics.getCrimesForFaction = function(factionId, filters = {}) {
  const query = { factionId };
  
  if (filters.status && filters.status !== 'all') {
    query.status = filters.status;
  }
  
  if (filters.dateFrom) {
    query.timeStarted = { $gte: new Date(filters.dateFrom) };
  }
  
  if (filters.dateTo) {
    query.timeStarted = { ...query.timeStarted, $lte: new Date(filters.dateTo) };
  }
  
  return this.find(query).sort({ timeStarted: -1 });
};

// Static method to calculate average checkpoint pass rate
organizedCrimeSchema.statics.calculateAveragePassRate = function(participants) {
  if (!participants || participants.length === 0) return 0;
  
  const validRates = participants
    .filter(p => p.checkpointPassRate !== null && p.checkpointPassRate !== undefined)
    .map(p => p.checkpointPassRate);
  
  if (validRates.length === 0) return 0;
  
  const sum = validRates.reduce((acc, rate) => acc + rate, 0);
  return Math.round(sum / validRates.length);
};

module.exports = mongoose.model('OrganizedCrime', organizedCrimeSchema);