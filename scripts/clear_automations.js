const mongoose = require('mongoose');

// Load environment variables from backend .env
require('dotenv').config({ path: 'd:/WebinarWLH/backend/.env' });
const uri = process.env.MONGO_URI;

if (!uri) {
  console.error("❌ Error: MONGO_URI not found in environment variables.");
  process.exit(1);
}

async function run() {
  try {
    console.log(`Connecting to MongoDB...`);
    await mongoose.connect(uri);
    console.log("Connected successfully!");

    const db = mongoose.connection.db;

    // We will clear automationflows and automationexecutions collections
    console.log("Clearing 'automationflows' collection...");
    const flowResult = await db.collection('automationflows').deleteMany({});
    console.log(`✅ Cleared 'automationflows': Deleted ${flowResult.deletedCount} document(s).`);

    console.log("Clearing 'automationexecutions' collection...");
    const execResult = await db.collection('automationexecutions').deleteMany({});
    console.log(`✅ Cleared 'automationexecutions': Deleted ${execResult.deletedCount} document(s).`);

    console.log("\n==================================================");
    console.log("🎉 SUCCESS: All automation flows and executions have been cleared!");
    console.log("==================================================");

  } catch (err) {
    console.error("❌ An error occurred during clearing database:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
