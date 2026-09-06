import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, required: true },
    publicId: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    reviewText: { type: String, trim: true, default: "", maxlength: 1200 },
    images: { type: [mediaSchema], default: [] },
    isVerifiedPurchase: { type: Boolean, default: true }
  },
  { timestamps: true }
);

reviewSchema.index({ user: 1, product: 1, order: 1 }, { unique: true });
reviewSchema.index({ product: 1, createdAt: -1 });

export default mongoose.model("Review", reviewSchema);
