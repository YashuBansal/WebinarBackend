const mongoose = require('mongoose');

// Load database configuration
require('dotenv').config({ path: 'd:/WebinarWLH/backend/.env' });
const uri = process.env.MONGO_URI;

async function run() {
  try {
    console.log(`Connecting to MongoDB...`);
    await mongoose.connect(uri);
    console.log("Connected successfully!");

    const db = mongoose.connection.db;
    const affiliatesCollection = db.collection('affiliates');
    const referralsCollection = db.collection('referrals');

    console.log("Fetching all affiliate profiles...");
    const affiliates = await affiliatesCollection.find({}).toArray();
    console.log(`Found ${affiliates.length} affiliate profile(s) to process.`);

    for (const aff of affiliates) {
      console.log(`\n--------------------------------------------------`);
      console.log(`Processing Affiliate: ${aff.referralCode} (User: ${aff.userId})`);

      // 1. Calculate sum of commission for remaining referrals for this referrer
      const referrals = await referralsCollection.find({ referrerId: aff.userId }).toArray();
      const totalCommission = referrals.reduce((sum, ref) => sum + (ref.commission || 0), 0);
      const roundedCommission = Math.round(totalCommission * 100) / 100;

      console.log(`Remaining referrals count: ${referrals.length}`);
      console.log(`Current DB values: totalEarned = ${aff.totalEarned}, requestablePayout = ${aff.requestablePayout}`);
      console.log(`Recalculated sum of active commissions: ${roundedCommission}`);

      // 2. Update the Affiliate document with clean, synced totals
      await affiliatesCollection.updateOne(
        { _id: aff._id },
        { 
          $set: { 
            totalEarned: roundedCommission,
            requestablePayout: roundedCommission
          } 
        }
      );

      console.log(`✅ Synced Affiliate ${aff.referralCode} balances to ${roundedCommission}`);
    }

    console.log(`\n==================================================`);
    console.log("🎉 SUCCESS: Commission Recalculation and Balance Sync Complete!");
    console.log("==================================================");

  } catch (err) {
    console.error("❌ An error occurred during commission recalculation:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
