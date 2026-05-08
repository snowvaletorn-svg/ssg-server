// Run this once to drop the broken discordId unique index
require('dotenv').config();
const mongoose = require('mongoose');

async function runFix() {
  console.log('Connecting to MongoDB...');
  
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    family: 4,
    tls: true
  });
  
  console.log('Connected. Checking indexes...');
  
  const User = mongoose.model('User', new mongoose.Schema({}));
  
  const indexes = await User.collection.indexes();
  console.log('Found indexes:', indexes.map(i => i.name));
  
  try {
    await User.collection.dropIndex('discordId_1');
    console.log('✅ Successfully dropped discordId_1 index!');
  } catch (err) {
    if (err.code === 27) {
      console.log('✅ Index already dropped, nothing to do.');
    } else {
      throw err;
    }
  }
  
  await mongoose.disconnect();
  console.log('✅ Fix complete!');
  process.exit(0);
}

runFix().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});