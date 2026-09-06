import mongoose from "mongoose";
import { AppError } from "../utils/appError.js";

const reference = (ref) => ({ type: mongoose.Schema.Types.ObjectId, ref, default: null, immutable: true });
const money = (minimum) => ({ type: Number, required: true, min: minimum, validate: Number.isSafeInteger, immutable: true });
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  order: reference("Order"), reward: reference("Reward"), refund: reference("RefundTransaction"),
  reversalOf: reference("WalletTransaction"),
  purpose: { type: String, enum: ["REWARD_CREDIT", "ORDER_PAYMENT", "ORDER_REFUND", "REVERSAL"], required: true, immutable: true },
  direction: { type: String, enum: ["CREDIT", "DEBIT"], required: true, immutable: true },
  amount: money(1), balanceBefore: money(0), balanceAfter: money(0),
  currency: { type: String, enum: ["INR"], default: "INR", immutable: true },
  status: { type: String, enum: ["POSTED"], default: "POSTED", immutable: true },
  idempotencyKey: { type: String, required: true, maxlength: 160, immutable: true },
  reason: { type: String, default: "", maxlength: 500, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

schema.pre("validate", function () {
  const expected = this.balanceBefore + (this.direction === "CREDIT" ? this.amount : -this.amount);
  if (!Number.isSafeInteger(expected) || expected !== this.balanceAfter) throw new AppError("Wallet ledger balances do not reconcile.", 409);
  const valid = this.purpose === "REWARD_CREDIT" ? this.direction === "CREDIT" && this.reward && !this.order && !this.refund && !this.reversalOf
    : this.purpose === "ORDER_PAYMENT" ? this.direction === "DEBIT" && this.order && !this.reward && !this.refund && !this.reversalOf
    : this.purpose === "ORDER_REFUND" ? this.direction === "CREDIT" && this.order && this.refund && !this.reward && !this.reversalOf
    : this.purpose === "REVERSAL" && this.reversalOf && this.reason;
  if (!valid) throw new AppError("Wallet ledger attribution is invalid.", 400);
});
const immutableError = () => { throw new AppError("Posted wallet transactions are immutable. Use a compensating entry.", 409); };
schema.pre("save", function () {
  if (!this.isNew) immutableError();
  if (!this.$session()?.inTransaction()) throw new AppError("Wallet ledger posting requires an active transaction.", 500);
});
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteMany", "findOneAndDelete"]) schema.pre(operation, immutableError);
schema.pre("deleteOne", { document: true, query: true }, immutableError);
schema.pre("bulkWrite", immutableError);
schema.pre("insertMany", immutableError);
schema.index({ user: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ user: 1, createdAt: 1, _id: 1 });
schema.index({ order: 1, createdAt: 1 });
schema.index({ reward: 1 }, { unique: true, partialFilterExpression: { purpose: "REWARD_CREDIT", reward: { $type: "objectId" } } });
schema.index({ reversalOf: 1 }, { unique: true, partialFilterExpression: { reversalOf: { $type: "objectId" } } });
export default mongoose.model("WalletTransaction", schema);
