// ─── One-time migration: encrypt existing plaintext keys ─────────────────────
// Usage:
//   node scripts/encryptExistingKeys.js --dry-run   (default: report only)
//   node scripts/encryptExistingKeys.js --apply     (encrypt for real)
//
// Idempotent: rows already encrypted (v1. prefix) are skipped. Requires
// KEY_ENCRYPTION_KEY to be set and MONGO_URI to point at the production DB.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { encrypt, isEncrypted } = require('../services/keyCipher');

const User = require('../models/User');
const FactionConfig = require('../models/FactionConfig');

const APPLY = process.argv.includes('--apply');

async function migrate() {
  if (!APPLY) {
    console.log('DRY RUN — no changes will be written. Use --apply to encrypt.');
  }

  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Aborting.');
    process.exit(1);
  }
  try {
    // Fails fast (throws) if KEY_ENCRYPTION_KEY is missing/malformed
    require('../services/keyCipher').loadEncryptionKey();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, family: 4 });
  console.log('Connected to MongoDB.');

  // ── User keys ────────────────────────────────────────────────────────────
  const users = await User.find(
    { tornApiKey: { $ne: null } },
    'tornPlayerId tornName tornApiKey ffScouterKey tornStatsKey'
  ).lean();

  let userChanged = 0;
  let skipped = 0;

  for (const u of users) {
    const updates = {};

    if (u.tornApiKey && !isEncrypted(u.tornApiKey)) updates.tornApiKey = encrypt(u.tornApiKey);
    if (u.ffScouterKey && !isEncrypted(u.ffScouterKey)) updates.ffScouterKey = encrypt(u.ffScouterKey);
    if (u.tornStatsKey && !isEncrypted(u.tornStatsKey)) updates.tornStatsKey = encrypt(u.tornStatsKey);

    if (Object.keys(updates).length) {
      userChanged++;
      console.log(`  user ${u.tornPlayerId} (${u.tornName}): ${Object.keys(updates).join(', ')}`);
      if (APPLY) {
        await User.updateOne({ _id: u._id }, { $set: updates });
      }
    } else {
      skipped++;
    }
  }

  console.log(`\nUsers: ${userChanged} to encrypt, ${skipped} already encrypted/clean.`);

  // ── Faction key ──────────────────────────────────────────────────────────
  const config = await FactionConfig.findOne({ key: 'config' });
  if (config?.tornFactionApiKey && !isEncrypted(config.tornFactionApiKey)) {
    console.log('FactionConfig: faction API key is plaintext.');
    if (APPLY) {
      await FactionConfig.updateOne(
        { _id: config._id },
        { $set: { tornFactionApiKey: encrypt(config.tornFactionApiKey) } }
      );
      console.log('FactionConfig: faction API key encrypted.');
    }
  } else {
    console.log('FactionConfig: faction API key already encrypted or not set.');
  }

  if (!APPLY) {
    console.log('\nDry run complete. Run again with --apply to write changes.');
  } else {
    console.log('\nMigration complete.');
  }

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});