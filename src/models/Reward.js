import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, required: true },
    publicId: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const rewardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["REVIEW", "STORY", "REEL", "WEAR_AND_EARN"],
      required: true
    },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending"
    },
    proofImage: { type: mediaSchema, default: null },
    proofVideo: { type: mediaSchema, default: null },
    review: { type: mongoose.Schema.Types.ObjectId, ref: "Review", default: null },
    adminNote: { type: String, trim: true, default: "" },
    creditedAt: { type: Date, default: null },
    walletTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "WalletTransaction", default: null }
  },
  { timestamps: true, autoIndex: false }
);

rewardSchema.index({ user: 1, createdAt: -1 });
rewardSchema.index({ status: 1, createdAt: -1 });
rewardSchema.index(
  { review: 1 },
  {
    unique: true,
    name: "review_1_unique_review_reward",
    partialFilterExpression: { review: { $type: "objectId" }, type: "REVIEW" }
  }
);

export default mongoose.model("Reward", rewardSchema);
