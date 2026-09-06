import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import Order from "../models/Order.js";
import Review from "../models/Review.js";
import Reward from "../models/Reward.js";
import User from "../models/User.js";
import { reconcileWallet } from "../services/wallet.service.js";

mongoose.set("autoIndex", false);
await connectDatabase();

try {
  const [reviews, reviewRewards, creditedTotals, users] = await Promise.all([
    Review.find().select("user product order reviewText").lean(),
    Reward.find({ type: "REVIEW" }).select("user review amount status creditedAt").lean(),
    Reward.aggregate([
      { $match: { status: "Approved", creditedAt: { $ne: null } } },
      { $group: { _id: "$user", total: { $sum: "$amount" } } }
    ]),
    User.find().select("walletBalance").lean()
  ]);

  const orders = await Order.find({ _id: { $in: reviews.map((review) => review.order) } })
    .select("orderStatus paymentStatus remainingCodDue")
    .lean();
  const ordersById = new Map(orders.map((order) => [String(order._id), order]));
  const reviewsById = new Map(reviews.map((review) => [String(review._id), review]));
  const rewardsByReview = new Map();

  for (const reward of reviewRewards) {
    const key = String(reward.review || "");
    if (!rewardsByReview.has(key)) rewardsByReview.set(key, []);
    rewardsByReview.get(key).push(reward);
  }

  const report = {
    nonDeliveredReviews: [],
    nonPaidReviews: [],
    reviewsWithCodDue: [],
    cancelledReviews: [],
    rewardsWithoutReview: [],
    writtenReviewsMissingReward: [],
    duplicateReviewRewards: [],
    walletInconsistencies: [],
    walletReconciliation: []
  };

  for (const review of reviews) {
    const order = ordersById.get(String(review.order));
    const summary = { reviewId: review._id, orderId: review.order, userId: review.user };
    if (!order || order.orderStatus !== "Delivered") report.nonDeliveredReviews.push(summary);
    if (!order || order.paymentStatus !== "Paid") report.nonPaidReviews.push(summary);
    if (!order || Number(order.remainingCodDue || 0) > 0) report.reviewsWithCodDue.push(summary);
    if (order?.orderStatus === "Cancelled") report.cancelledReviews.push(summary);
    if (String(review.reviewText || "").trim() && !(rewardsByReview.get(String(review._id)) || []).length) {
      report.writtenReviewsMissingReward.push(summary);
    }
  }

  for (const reward of reviewRewards) {
    if (!reward.review || !reviewsById.has(String(reward.review))) {
      report.rewardsWithoutReview.push({ rewardId: reward._id, reviewId: reward.review, userId: reward.user });
    }
  }
  for (const [reviewId, rewards] of rewardsByReview) {
    if (reviewId && rewards.length > 1) {
      report.duplicateReviewRewards.push({ reviewId, rewardIds: rewards.map((reward) => reward._id), count: rewards.length });
    }
  }

  const creditedByUser = new Map(creditedTotals.map((entry) => [String(entry._id), Number(entry.total || 0)]));
  for (const user of users) {
    const reconciliation = await reconcileWallet({ userId: user._id });
    report.walletReconciliation.push({ userId: user._id, ...reconciliation, historicalCreditedRewardTotal: creditedByUser.get(String(user._id)) || 0 });
    if (!reconciliation.trackedBalanceMatches) report.walletInconsistencies.push({ userId: user._id, ...reconciliation });
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, counts: Object.fromEntries(Object.entries(report).map(([key, value]) => [key, value.length])), report }, null, 2));
} finally {
  await mongoose.disconnect();
}
