import mongoose from "mongoose";

const offerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, default: "" },
    type: {
      type: String,
      enum: ["BUY_X_GET_Y", "COMBO", "PRODUCT_DISCOUNT"],
      required: true
    },
    buyQuantity: { type: Number, default: 0, min: 0 },
    freeQuantity: { type: Number, default: 0, min: 0 },
    targetProduct: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    targetCategory: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

offerSchema.index({ isActive: 1, type: 1, startDate: 1, expiryDate: 1 });

export default mongoose.model("Offer", offerSchema);
