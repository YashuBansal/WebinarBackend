const mongoose = require('mongoose');

// Read email from command line arguments (e.g., node scripts/delete_user.js user@gmail.com)
const targetEmail = process.argv[2];

if (!targetEmail) {
  console.error("❌ Error: Please provide an email address as an argument.");
  console.log("Usage: node scripts/delete_user.js <email_address>");
  process.exit(1);
}

// Automatically load database URI and variables from backend .env
require('dotenv').config({ path: 'd:/WebinarWLH/backend/.env' });
const uri = process.env.MONGO_URI;

async function run() {
  try {
    console.log(`Connecting to MongoDB...`);
    await mongoose.connect(uri);
    console.log("Connected successfully!");

    const db = mongoose.connection.db;

    // 1. Search for user record dynamically using target email
    console.log(`Searching for user record with email: ${targetEmail}...`);
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ email: targetEmail.trim().toLowerCase() });

    if (!user) {
      console.log(`❌ No user record found in 'users' collection with email: ${targetEmail}`);
      await mongoose.disconnect();
      return;
    }

    const userId = user._id;
    const userIdStr = userId.toString();
    console.log("\n==================================================");
    console.log("🎯 TARGET USER FOUND:");
    console.log(`   - ID: ${userIdStr}`);
    console.log(`   - Name: ${user.userName || 'N/A'}`);
    console.log(`   - Email: ${user.email}`);
    console.log(`   - Role: ${user.role || 'N/A'}`);
    console.log("==================================================");

    console.log("\nStarting surgical database deep-clean...");
    const collections = await db.listCollections().toArray();

    for (const col of collections) {
      const name = col.name;
      const coll = db.collection(name);

      const cursor = coll.find({});
      let documentsDeletedCount = 0;

      while (await cursor.hasNext()) {
        const doc = await cursor.next();

        const inspectValue = (val) => {
          if (val === null || val === undefined) return false;

          if (typeof val === 'string') {
            if (val.toLowerCase() === targetEmail.toLowerCase()) return true;
            if (val === userIdStr) return true;
          }

          if (val instanceof mongoose.Types.ObjectId) {
            if (val.equals(userId)) return true;
          }

          if (Array.isArray(val)) {
            for (const item of val) {
              if (inspectValue(item)) return true;
            }
          }

          if (typeof val === 'object') {
            if (val.constructor && val.constructor.name === 'ObjectID') {
              return val.toString() === userIdStr;
            }
            try {
              for (const key of Object.keys(val)) {
                if (inspectValue(val[key])) return true;
              }
            } catch (e) {
              // Ignore un-iterable items
            }
          }

          return false;
        };

        if (inspectValue(doc)) {
          await coll.deleteOne({ _id: doc._id });
          documentsDeletedCount++;
        }
      }

      if (documentsDeletedCount > 0) {
        console.log(`✅ [DEEP-CLEAN] Purged ${documentsDeletedCount} document(s) from collection '${name}' referencing ${targetEmail} / ${userIdStr}.`);
      }
    }

    console.log("\n==================================================");
    console.log("🎉 SUCCESS: Clean Sweep Completed!");
    console.log(`   All references to ${targetEmail} have been successfully purged.`);
    console.log("==================================================");

  } catch (err) {
    console.error("❌ An error occurred during deep clean:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
