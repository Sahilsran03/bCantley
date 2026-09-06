import mongoose from "mongoose";

const checkoutAttemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true, trim: true, maxlength: 120 },
    requestFingerprint: { type: String, required: true, trim: true, maxlength: 128 },
    cartVersion: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["Processing", "Completed", "Failed"],
      default: "Processing"
    },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    responsePayload: { type: mongoose.Schema.Types.Mixed, default: null },
    completedAt: { type: Date, default: null },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  },
  {
    timestamps: true
  }
);

checkoutAttemptSchema.index({ user: 1, key: 1 }, { unique: true });
checkoutAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("CheckoutAttempt", checkoutAttemptSchema);
