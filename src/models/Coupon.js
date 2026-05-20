import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    description: { type: String, trim: true, default: "" },
    type: {
      type: String,
      enum: ["PERCENTAGE", "FIXED", "FREE_SHIPPING"],
      required: true
    },
    value: { type: Number, default: 0, min: 0 },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    maxDiscountAmount: { type: Number, default: null, min: 0 },
    usageLimit: { type: Number, default: null, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    startDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
    applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    excludedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }]
  },
  {
    timestamps: true
  }
);

export default mongoose.model("Coupon", couponSchema);
