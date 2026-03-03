const mongoose = require('mongoose');

// Single-document config store for faction-level settings
const factionConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'config' },
  tornFactionApiKey: { type: String, default: null },
  setBy: { type: String, default: null }, // discordId of who set it
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('FactionConfig', factionConfigSchema);
