const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  companyId: { type: Number, required: true, unique: true },
  companyName: { type: String, default: '' },
  companyType: { type: String, default: '' },
  companyTypeId: { type: Number, default: null },
  directorPlayerId: { type: Number, required: true },
  directorName: { type: String, default: '' },
  stars: { type: Number, default: 0 },
  dailyIncome: { type: Number, default: 0 },
  addedBy: { type: Number, required: true },
  lastFetchedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

companySchema.pre('save', function(next) {
  try {
    this.updatedAt = Date.now();
    if (typeof next === 'function') next();
  } catch (err) {
    if (typeof next === 'function') next(err);
  }
});

module.exports = mongoose.model('Company', companySchema);