const mongoose = require('mongoose');

// Load environment variables from backend .env
require('dotenv').config({ path: 'd:/WebinarWLH/backend/.env' });
const uri = process.env.MONGO_URI;

async function run() {
  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    const flows = await db.collection('automationflows').find({}).toArray();
    console.log("Current flows in database:", JSON.stringify(flows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
