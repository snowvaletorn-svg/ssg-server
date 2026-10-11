const mongoose = require('mongoose');

// Per-player stat goals ("road to X"). One document per player, holding the
// full list of goals so it can be saved and revisited for future plans.
const statGoalSchema = new mongoose.Schema({
  tornPlayerId: { type: Number, required: true, unique: true, index: true },
  goals: [{
    stat: {
      type: String,
      enum: ['strength', 'defense', 'speed', 'dexterity', 'totalStats'],
      required: true
    },
    targetValue: { type: Number, required: true, min: 1 },
    // Optional deadline. null = no date, show an auto-calculated ETA instead.
    targetDate: { type: Date, default: null },
    // Value when the goal was created (used for "progress since created").
    startValue: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
  }],
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('StatGoal', statGoalSchema);
