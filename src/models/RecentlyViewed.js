import mongoose from "mongoose";

const recentlyViewedItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    viewedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const recentlyViewedSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    products: { type: [recentlyViewedItemSchema], default: [] }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("RecentlyViewed", recentlyViewedSchema);
