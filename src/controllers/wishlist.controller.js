import mongoose from "mongoose";
import Product from "../models/Product.js";
import Wishlist from "../models/Wishlist.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const getOrCreateWishlist = async (userId) => {
  let wishlist = await Wishlist.findOne({ user: userId });

  if (!wishlist) {
    wishlist = await Wishlist.create({ user: userId, products: [] });
  }

  return wishlist;
};

const populateWishlist = (query) => query.populate("products", "name slug images basePrice shortDescription productType ratingCount category");

export const getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await populateWishlist(Wishlist.findOne({ user: req.user._id }));

  res.status(200).json({
    success: true,
    wishlist: wishlist || { user: req.user._id, products: [] },
    count: wishlist?.products.length || 0
  });
});

export const addWishlistProduct = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.productId)) {
    throw new AppError("Product not found.", 404);
  }

  const product = await Product.findOne({ _id: req.params.productId, isActive: true });
  if (!product) throw new AppError("Product not found.", 404);

  const wishlist = await getOrCreateWishlist(req.user._id);
  const exists = wishlist.products.some((id) => id.toString() === product._id.toString());

  if (!exists) {
    wishlist.products.push(product._id);
    await wishlist.save();
  }

  await wishlist.populate("products", "name slug images basePrice shortDescription productType ratingCount category");

  res.status(200).json({
    success: true,
    wishlist,
    count: wishlist.products.length
  });
});

export const removeWishlistProduct = asyncHandler(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user._id);
  wishlist.products = wishlist.products.filter((id) => id.toString() !== req.params.productId);
  await wishlist.save();
  await wishlist.populate("products", "name slug images basePrice shortDescription productType ratingCount category");

  res.status(200).json({
    success: true,
    wishlist,
    count: wishlist.products.length
  });
});
