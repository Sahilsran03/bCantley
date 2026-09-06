import mongoose from "mongoose";

const refundTransactionSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    returnRequest: { type: mongoose.Schema.Types.ObjectId, ref: "ReturnRequest", required: function () { return this.method !== "WALLET"; }, default: null, index: true },
    method: { type: String, enum: ["RAZORPAY", "MANUAL", "WALLET"], required: true },
    walletPayment: { type: mongoose.Schema.Types.ObjectId, ref: "WalletTransaction", default: null, immutable: true },
    walletTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "WalletTransaction", default: null, immutable: true },
    walletRefundKind: { type: String, enum: ["CANCELLATION", "RETURN", null], default: null, immutable: true },
    amount: { type: Number, required: true, min: 0 },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    currency: { type: String, enum: ["INR"], default: "INR", required: true },
    status: { type: String, enum: ["Completed", "Failed"], default: "Completed", required: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    providerRefundId: { type: String, trim: true, default: null },
    manualMethod: { type: String, enum: ["CASH", "UPI", "BANK_TRANSFER", "OTHER", null], default: null },
    manualReference: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, maxlength: 1200, default: "" },
    processedAt: { type: Date, required: true },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
    operationFingerprint: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ }
  },
  { timestamps: true }
);

refundTransactionSchema.pre("validate", function () {
  if (this.method === "WALLET" && (!this.walletPayment || !this.walletTransaction || !this.walletRefundKind ||
      !Number.isSafeInteger(this.amount) || this.amount <= 0 || this.amountPaise !== this.amount * 100 ||
      this.payment || this.providerRefundId || this.manualMethod || this.manualReference)) {
    this.invalidate("walletTransaction", "Wallet refund requires exact wallet evidence and no provider/manual payment fields.");
  }
});
refundTransactionSchema.index({ walletTransaction: 1 }, { unique: true, partialFilterExpression: { walletTransaction: { $type: "objectId" } } });
refundTransactionSchema.index({ order: 1, walletRefundKind: 1 }, { unique: true, partialFilterExpression: { method: "WALLET", walletRefundKind: "CANCELLATION" } });
refundTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
refundTransactionSchema.index(
  { providerRefundId: 1 },
  { unique: true, partialFilterExpression: { providerRefundId: { $type: "string" } } }
);
refundTransactionSchema.index({ order: 1, status: 1, processedAt: 1 });
refundTransactionSchema.index({ returnRequest: 1, status: 1, processedAt: 1 });

export default mongoose.model("RefundTransaction", refundTransactionSchema);
