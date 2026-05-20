import mongoose from "mongoose";
import Product from "../models/Product.js";
import RecentlyViewed from "../models/RecentlyViewed.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const getOrCreateRecentlyViewed = async (userId) => {
  let recentlyViewed = await RecentlyViewed.findOne({ user: userId });

  if (!recentlyViewed) {
    recentlyViewed = await RecentlyViewed.create({ user: userId, products: [] });
  }

  return recentlyViewed;
};

export const getRecentlyViewed = asyncHandler(async (req, res) => {
  const recentlyViewed = await RecentlyViewed.findOne({ user: req.user._id }).populate(
    "products.product",
    "name slug images basePrice shortDescription productType ratingCount category"
  );
  const items = (recentlyViewed?.products || []).sort((a, b) => b.viewedAt - a.viewedAt);

  res.status(200).json({
    success: true,
    count: items.length,
    products: items
  });
});

export const trackRecentlyViewed = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.productId)) {
    throw new AppError("Product not found.", 404);
  }

  const product = await Product.findOne({ _id: req.params.productId, isActive: true });
  if (!product) throw new AppError("Product not found.", 404);

  const recentlyViewed = await getOrCreateRecentlyViewed(req.user._id);
  recentlyViewed.products = recentlyViewed.products.filter((item) => item.product.toString() !== product._id.toString());
  recentlyViewed.products.unshift({ product: product._id, viewedAt: new Date() });
  recentlyViewed.products = recentlyViewed.products.slice(0, 20);
  await recentlyViewed.save();

  res.status(200).json({
    success: true,
    count: recentlyViewed.products.length
  });
});
