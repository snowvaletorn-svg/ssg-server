const mongoose = require('mongoose');

// Daily snapshot of every faction member's equipped gear.
//
// Read model for the Admin panel's "Member Equipment" tab (leadership only).
// One document per calendar day, mirroring DailySnapshot's shape:
//   snapshotId: 'equipment_YYYY-MM-DD' (unique)
//
// Privacy notes:
// - Equipment is pulled with each member's OWN saved Torn API key. The faction
//   key cannot read a member's personal equipment (Torn privacy restriction),
//   so members who never saved a key are recorded as status 'no_key'.
// - We deliberately do NOT store what a member paid for their gear. Torn's
//   equipment endpoint does not return purchase price, and the only price we
//   store is the market price of a suggested UPGRADE (i.e. what the faction
//   would need to buy) which is the actionable number for leadership.
// - Faction-loaned gear is tagged (factionOwned) so leadership can tell the
//   difference between "member owns this" and "the faction owns this".

const equippedItemSchema = new mongoose.Schema({
  id: { type: Number, default: null },
  name: { type: String, default: null },
  slot: { type: Number, default: null },
  slotLabel: { type: String, default: null },
  rarity: { type: String, default: null },
  quality: { type: Number, default: null },
  damage: { type: Number, default: null },
  accuracy: { type: Number, default: null },
  armor: { type: Number, default: null },
  bonuses: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // True when this piece matches an item in the faction armory, i.e. the
  // member is wearing faction-loaned gear rather than their own.
  factionOwned: { type: Boolean, default: false }
}, { _id: false });

const weaponSlotsSchema = new mongoose.Schema({
  primary: { type: equippedItemSchema, default: null },
  secondary: { type: equippedItemSchema, default: null },
  melee: { type: equippedItemSchema, default: null },
  temporary: { type: equippedItemSchema, default: null }
}, { _id: false });

// A suggested upgrade. `price` is the market price of the UPGRADE, never the
// price the member paid for what they already own.
const recommendationSchema = new mongoose.Schema({
  currentName: { type: String, default: null },
  name: { type: String, default: null },
  rarity: { type: String, default: null },
  quality: { type: Number, default: null },
  damage: { type: Number, default: null },
  accuracy: { type: Number, default: null },
  armor: { type: Number, default: null },
  damageDelta: { type: Number, default: null },
  accuracyDelta: { type: Number, default: null },
  qualityDelta: { type: Number, default: null },
  armorDelta: { type: Number, default: null },
  price: { type: Number, default: null },
  source: { type: String, default: null },
  bonuses: { type: [mongoose.Schema.Types.Mixed], default: [] },
  evaluatedAt: { type: Date, default: null }
}, { _id: false });

const recommendationsSchema = new mongoose.Schema({
  weapon: { type: recommendationSchema, default: null },
  armor: { type: recommendationSchema, default: null }
}, { _id: false });

const memberEquipmentSchema = new mongoose.Schema({
  playerId: { type: Number, default: null },
  playerName: { type: String, default: null },
  position: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
  // 'ok'             — gear pulled successfully
  // 'no_key'         — member has no saved Torn API key
  // 'key_restricted' — key exists but Torn refused the equipment request
  // 'error'          — transient failure (network / Torn error)
  status: { type: String, default: 'ok' },
  weapons: { type: weaponSlotsSchema, default: () => ({}) },
  armor: { type: [equippedItemSchema], default: [] },
  mostUsedWeapon: { type: equippedItemSchema, default: null },
  // Sum of the armor pieces' armor ratings — the number leadership actually
  // compares members on.
  armorRatingTotal: { type: Number, default: 0 },
  // Lowest-quality armor piece, flagged so leadership can spot the obvious
  // upgrade candidate without reading every row.
  lowestQualityArmor: { type: equippedItemSchema, default: null },
  recommendations: {
    weapon: { type: recommendationSchema, default: null },
    armor: { type: recommendationSchema, default: null }
  }
}, { _id: false });

const memberEquipmentSnapshotSchema = new mongoose.Schema({
  snapshotId: { type: String, required: true, unique: true },
  snapshotDate: { type: String, required: true },
  factionId: { type: Number, required: true, default: 53272 },
  members: { type: [memberEquipmentSchema], default: [] },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

memberEquipmentSnapshotSchema.pre('save', function (next) {
  try {
    this.updatedAt = new Date();
    next();
  } catch (err) {
    next(err);
  }
});

memberEquipmentSnapshotSchema.index({ snapshotDate: -1 });

module.exports = mongoose.model('MemberEquipmentSnapshot', memberEquipmentSnapshotSchema);
