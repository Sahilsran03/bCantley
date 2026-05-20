import Reward from "../models/Reward.js";
import User from "../models/User.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { fileToCloudinaryAsset } from "../utils/mediaAssets.js";
import { emailTemplates, sendTemplateEmail } from "../services/email.service.js";
import { createNotification } from "../services/notification.service.js";

const rewardAmounts = {
  STORY: 20,
  REEL: 30,
  WEAR_AND_EARN: 30
};

const createProofReward = (type) =>
  asyncHandler(async (req, res) => {
    const proofImage = req.files?.proofImage?.[0] ? fileToCloudinaryAsset(req.files.proofImage[0]) : null;
    const proofVideo = req.files?.proofVideo?.[0] ? fileToCloudinaryAsset(req.files.proofVideo[0]) : null;

    if (!proofImage && !proofVideo) {
      throw new AppError("Proof image or video is required.", 400);
    }

    const reward = await Reward.create({
      user: req.user._id,
      type,
      amount: rewardAmounts[type],
      status: "Pending",
      proofImage,
      proofVideo
    });

    res.status(201).json({ success: true, reward });
  });

export const createStoryReward = createProofReward("STORY");
export const createReelReward = createProofReward("REEL");
export const createWearEarnReward = createProofReward("WEAR_AND_EARN");

export const getMyRewards = asyncHandler(async (req, res) => {
  const rewards = await Reward.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: rewards.length, rewards });
});

export const listAdminRewards = asyncHandler(async (req, res) => {
  const rewards = await Reward.find().populate("user", "name email walletBalance").sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: rewards.length, rewards });
});

export const updateRewardStatus = asyncHandler(async (req, res) => {
  const status = String(req.body.status || "").trim();
  const adminNote = String(req.body.adminNote || "").trim();

  if (!["Pending", "Approved", "Rejected"].includes(status)) {
    throw new AppError("Invalid reward status.", 400);
  }

  const reward = await Reward.findById(req.params.id);

  if (!reward) {
    throw new AppError("Reward not found.", 404);
  }

  const shouldCredit = status === "Approved" && reward.status !== "Approved" && !reward.creditedAt;
  reward.status = status;
  reward.adminNote = adminNote;

  if (shouldCredit) {
    await User.findByIdAndUpdate(reward.user, { $inc: { walletBalance: reward.amount } });
    reward.creditedAt = new Date();
  }

  await reward.save();
  await reward.populate("user", "name email walletBalance");
  if (shouldCredit) {
    await createNotification({
      user: reward.user._id,
      title: "Reward approved",
      message: `Your Cantley ${reward.type} reward of Rs. ${reward.amount} has been approved.`,
      type: "REWARD",
      link: "/rewards"
    });
    await sendTemplateEmail({
      to: reward.user.email,
      template: emailTemplates.rewardApproved({ amount: reward.amount })
    });
  }

  res.status(200).json({ success: true, reward });
});
