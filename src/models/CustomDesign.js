import mongoose from "mongoose";

const mediaAssetSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
    resourceType: { type: String, trim: true, default: "image" },
    originalName: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const customizationSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true, default: "" },
    font: { type: String, trim: true, default: "Inter" },
    textColor: { type: String, trim: true, default: "#111827" },
    placement: {
      type: String,
      enum: ["front", "back", "sleeve", "full sticker"],
      default: "front"
    },
    rotation: { type: Number, default: 0 },
    scale: { type: Number, default: 1, min: 0.1, max: 5 }
  },
  { _id: false }
);

const customDesignSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    variantSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    designType: {
      type: String,
      enum: ["tshirt", "hoodie", "sticker", "label"],
      required: true
    },
    previewImage: { type: mediaAssetSchema, default: null },
    sourceFiles: { type: [mediaAssetSchema], default: [] },
    canvasJson: { type: mongoose.Schema.Types.Mixed, default: null },
    placement: {
      type: String,
      enum: ["front", "back", "left sleeve", "right sleeve", "full sticker"],
      default: "front"
    },
    customization: { type: customizationSchema, default: () => ({}) },
    aiPrompt: { type: String, trim: true, default: "" },
    backgroundRemoved: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["Draft", "Submitted", "Approved", "Rejected"],
      default: "Draft"
    },
    adminNote: { type: String, trim: true, default: "" },
    isSavedTemplate: { type: Boolean, default: false },
    templateName: { type: String, trim: true, default: "" },
    lastEditedAt: { type: Date, default: Date.now }
  },
  {
    timestamps: true
  }
);

customDesignSchema.index({ status: 1, createdAt: -1 });
customDesignSchema.index({ user: 1, isSavedTemplate: 1, lastEditedAt: -1 });

export default mongoose.model("CustomDesign", customDesignSchema);
