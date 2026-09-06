import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    variantSku: {
      type: String,
      trim: true,
      default: ""
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0
    },
    selectedOptions: {
      size: { type: String, trim: true, default: "" },
      color: { type: String, trim: true, default: "" },
      material: { type: String, trim: true, default: "" },
      printType: { type: String, trim: true, default: "" },
      finish: { type: String, trim: true, default: "" }
    },
    customDesign: { type: mongoose.Schema.Types.ObjectId, ref: "CustomDesign", default: null },
    designPreview: { type: mongoose.Schema.Types.Mixed, default: null },
    designData: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  {
    timestamps: true
  }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },
    items: {
      type: [cartItemSchema],
      default: []
    },
    appliedCouponCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: ""
    },
    version: {
      type: Number,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Cart version must be an integer."
      },
      default: 1
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("Cart", cartSchema, "lockers");
