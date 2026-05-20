import mongoose from "mongoose";

const quoteFileSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ["image", "video", "raw"], default: "image" },
    originalName: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const quoteRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20
    },
    businessName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120
    },
    productType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    preferredMaterial: {
      type: String,
      trim: true,
      default: ""
    },
    printType: {
      type: String,
      trim: true,
      default: ""
    },
    sizesBreakdown: {
      type: String,
      trim: true,
      default: ""
    },
    designFiles: {
      type: [quoteFileSchema],
      default: []
    },
    message: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000
    },
    status: {
      type: String,
      enum: ["New", "Contacted", "Quoted", "Approved", "Rejected"],
      default: "New"
    },
    quotedAmount: {
      type: Number,
      min: 0,
      default: 0
    },
    adminNote: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000
    }
  },
  { timestamps: true }
);

quoteRequestSchema.index({ user: 1, createdAt: -1 });
quoteRequestSchema.index({ status: 1, createdAt: -1 });
quoteRequestSchema.index({ email: 1, createdAt: -1 });

export default mongoose.model("QuoteRequest", quoteRequestSchema);
