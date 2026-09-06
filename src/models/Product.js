import mongoose from "mongoose";

const variantSchema = new mongoose.Schema(
  {
    size: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "" },
    material: { type: String, trim: true, default: "" },
    printType: { type: String, trim: true, default: "" },
    finish: { type: String, trim: true, default: "" },
    shape: { type: String, trim: true, default: "" },
    width: { type: Number, default: null, min: 0 },
    height: { type: Number, default: null, min: 0 },
    unit: { type: String, enum: ["", "mm", "cm", "inch"], default: "" },
    waterproof: { type: Boolean, default: false },
    stock: { type: Number, default: 0, min: 0 },
    sku: { type: String, trim: true, default: "" },
    priceModifier: { type: Number, default: 0 }
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ""
    },
    shortDescription: {
      type: String,
      trim: true,
      default: "",
      maxlength: 240
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true
    },
    productType: {
      type: String,
      enum: ["tshirt", "oversized-tshirt", "hoodie", "sticker", "label", "other", "clothing"],
      required: true
    },
    images: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
      validate: {
        validator: (images) => images.length <= 5,
        message: "Product can have a maximum of 5 images."
      }
    },
    video: {
      type: mongoose.Schema.Types.Mixed,
      default: ""
    },
    basePrice: {
      type: Number,
      required: true,
      min: 0
    },
    codAvailable: {
      type: Boolean,
      default: true
    },
    codAdvanceAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isFeatured: {
      type: Boolean,
      default: false
    },
    tags: {
      type: [String],
      default: []
    },
    ratingAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0
    },
    viewCount: {
      type: Number,
      default: 0,
      min: 0
    },
    soldCount: {
      type: Number,
      default: 0,
      min: 0
    },
    variants: {
      type: [variantSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

productSchema.index({ isActive: 1, productType: 1, basePrice: 1 });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ name: "text", description: "text", shortDescription: "text", tags: "text" });
productSchema.index({ isActive: 1, isFeatured: -1, createdAt: -1 });
productSchema.index({ ratingAverage: -1, ratingCount: -1 });
productSchema.index({ isActive: 1, ratingCount: -1, ratingAverage: -1 });
productSchema.index({ isActive: 1, basePrice: 1 });
productSchema.index({ isActive: 1, viewCount: -1, createdAt: -1 });
productSchema.index({ isActive: 1, soldCount: -1, createdAt: -1 });
productSchema.index({ isActive: 1, createdAt: -1 });
productSchema.index({ "variants.material": 1, "variants.color": 1 });

export default mongoose.model("Product", productSchema);
