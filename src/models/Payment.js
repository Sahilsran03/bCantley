import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    provider: { type: String, enum: ["razorpay"], required: true },
    purpose: { type: String, enum: ["COD_ADVANCE", "FULL_ONLINE"], required: true },
    status: {
      type: String,
      enum: ["Created", "Pending", "Authorized", "Captured", "Failed", "Refunded", "Cancelled"],
      required: true,
      default: "Created"
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Payment amount must be an integer number of INR."
      }
    },
    currency: { type: String, enum: ["INR"], required: true, default: "INR" },
    advanceAttemptKey: { type: String, trim: true, default: null },
    onlineAttemptKey: { type: String, trim: true, default: null },
    providerOrderId: { type: String, trim: true, default: null, index: true },
    providerPaymentId: { type: String, trim: true, default: null },
    providerSignature: { type: String, trim: true, default: null },
    failureCode: { type: String, trim: true, default: "" },
    failureReason: { type: String, trim: true, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    authorizedAt: { type: Date, default: null },
    capturedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, order: 1 });
paymentSchema.index({ provider: 1, providerOrderId: 1 });
paymentSchema.index(
  { provider: 1, providerPaymentId: 1 },
  { unique: true, partialFilterExpression: { providerPaymentId: { $type: "string" } } }
);
paymentSchema.index(
  { advanceAttemptKey: 1 },
  { unique: true, partialFilterExpression: { advanceAttemptKey: { $type: "string" } } }
);

paymentSchema.index(
  { onlineAttemptKey: 1 },
  { unique: true, partialFilterExpression: { onlineAttemptKey: { $type: "string" } } }
);

export default mongoose.model("Payment", paymentSchema);
