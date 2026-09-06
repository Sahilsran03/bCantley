import mongoose from "mongoose";
import Order from "../models/Order.js";
import Review from "../models/Review.js";
import Reward from "../models/Reward.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { createWalletService } from "./wallet.service.js";
import { AppError } from "../utils/appError.js";
import { REVIEW_REWARD_AMOUNT } from "../validators/review.validator.js";

export const assertReviewOrderEligible = (order, productId) => {
  if (!order) throw new AppError("Eligible order not found.", 404);
  if (order.orderStatus === "Cancelled") throw new AppError("Cancelled orders cannot be reviewed.", 403);
  if (order.orderStatus !== "Delivered") throw new AppError("Reviews become available after your order is delivered.", 403);
  if (order.paymentStatus !== "Paid" || Number(order.remainingCodDue || 0) !== 0) {
    throw new AppError("Reviews become available after your order is fully paid.", 403);
  }
  const containsProduct = order.items?.some((item) => String(item.product?._id || item.product) === String(productId));
  if (!containsProduct) throw new AppError("This product is not part of the selected order.", 403);
};

export const createEligibleReview = async ({
  userId,
  payload,
  images = [],
  dependencies = {}
}) => {
  const OrderModel = dependencies.OrderModel || Order;
  const ReviewModel = dependencies.ReviewModel || Review;
  const RewardModel = dependencies.RewardModel || Reward;
  const UserModel = dependencies.UserModel || User;
  const wallet = createWalletService({ UserModel, LedgerModel: dependencies.WalletTransactionModel || WalletTransaction });
  const session = await (dependencies.startSession || (() => mongoose.startSession()))();
  let review;
  let rewardGranted = false;

  try {
    await session.withTransaction(async () => {
      rewardGranted = false;
      const order = await OrderModel.findOne({ _id: payload.orderId, user: userId }).session(session);
      assertReviewOrderEligible(order, payload.productId);

      const existing = await ReviewModel.exists({ user: userId, product: payload.productId, order: payload.orderId }).session(session);
      if (existing) throw new AppError("You have already reviewed this product from this order.", 409);

      [review] = await ReviewModel.create([{
        user: userId,
        product: payload.productId,
        order: payload.orderId,
        rating: payload.rating,
        reviewText: payload.reviewText,
        images,
        isVerifiedPurchase: true
      }], { session });

      if (payload.reviewText) {
        const [reward] = await RewardModel.create([{
          user: userId,
          type: "REVIEW",
          amount: REVIEW_REWARD_AMOUNT,
          status: "Approved",
          review: review._id
        }], { session });
        const posting = await wallet.creditWallet({
          userId, amount: REVIEW_REWARD_AMOUNT, purpose: "REWARD_CREDIT", rewardId: reward._id,
          idempotencyKey: `reward-credit:${reward._id}`, session
        });
        reward.creditedAt = posting.transaction.createdAt;
        reward.walletTransaction = posting.transaction._id;
        await reward.save({ session });
        rewardGranted = true;
      }
    });
  } finally {
    await session.endSession();
  }

  return { review, rewardGranted, rewardAmount: rewardGranted ? REVIEW_REWARD_AMOUNT : 0 };
};
