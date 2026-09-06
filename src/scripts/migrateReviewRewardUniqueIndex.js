import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import Reward from "../models/Reward.js";

const indexName = "review_1_unique_review_reward";
await connectDatabase();

try {
  const duplicates = await Reward.aggregate([
    { $match: { type: "REVIEW", review: { $type: "objectId" } } },
    { $group: { _id: "$review", count: { $sum: 1 }, rewardIds: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]);

  if (duplicates.length) {
    console.error(JSON.stringify({ safe: false, message: "Duplicate REVIEW rewards exist. No index was created and no data was modified.", duplicates }, null, 2));
    process.exitCode = 1;
  } else {
    const indexes = await Reward.collection.indexes();
    const existing = indexes.find((index) => index.name === indexName);
    if (!existing) {
      await Reward.collection.createIndex(
        { review: 1 },
        { unique: true, partialFilterExpression: { review: { $type: "objectId" }, type: "REVIEW" }, name: indexName }
      );
    }
    console.log(JSON.stringify({ safe: true, index: indexName, status: existing ? "verified" : "created", dataModified: false }, null, 2));
  }
} finally {
  await mongoose.disconnect();
}
