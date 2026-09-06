import mongoose from "mongoose";
import Reward from "../models/Reward.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { createWalletService } from "./wallet.service.js";
import { AppError } from "../utils/appError.js";

export const approveRewardStatus = async ({ rewardId, status, adminNote = "", dependencies = {} }) => {
  if (!mongoose.Types.ObjectId.isValid(rewardId)) throw new AppError("Reward not found.", 404);
  if (!["Pending", "Approved", "Rejected"].includes(status)) throw new AppError("Invalid reward status.", 400);
  const RewardModel = dependencies.RewardModel || Reward;
  const wallet = createWalletService({ UserModel: dependencies.UserModel || User, LedgerModel: dependencies.WalletTransactionModel || WalletTransaction });
  const session = await (dependencies.startSession || (() => mongoose.startSession()))();
  let reward;
  let credited;
  try {
    await session.withTransaction(async () => {
      credited = false;
      reward = await RewardModel.findById(rewardId).session(session);
      if (!reward) throw new AppError("Reward not found.", 404);
      // Do not let a status toggle erase ambiguous historical credit evidence.
      if (reward.status === "Approved" && !reward.creditedAt) throw new AppError("Approved reward credit history requires reconciliation.", 409);
      if (status === "Approved" && !reward.creditedAt) {
        const result = await wallet.creditWallet({
          userId: reward.user, amount: reward.amount, purpose: "REWARD_CREDIT",
          rewardId: reward._id, idempotencyKey: `reward-credit:${reward._id}`, session
        });
        reward.creditedAt = result.transaction.createdAt;
        reward.walletTransaction = result.transaction._id;
        credited = result.posted;
      }
      reward.status = status;
      reward.adminNote = adminNote;
      await reward.save({ session });
    });
  } finally { await session.endSession(); }
  return { reward, credited };
};
