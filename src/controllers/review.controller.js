import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Review from "../models/Review.js";
import Reward from "../models/Reward.js";
import User from "../models/User.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { fileToCloudinaryAsset } from "../utils/mediaAssets.js";
import { createNotification } from "../services/notification.service.js";

const updateProductRating = async (productId) => {
  const reviews = await Review.find({ product: productId });
  const ratingCount = reviews.length;
  const ratingAverage = ratingCount
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / ratingCount
    : 0;

  await Product.findByIdAndUpdate(productId, {
    ratingAverage: Number(ratingAverage.toFixed(1)),
    ratingCount
  });
};

export const createReview = asyncHandler(async (req, res) => {
  const rating = Number(req.body.rating);
  const productId = req.body.productId;
  const orderId = req.body.orderId;
  const reviewText = String(req.body.reviewText || "").trim();

  if (!rating || rating < 1 || rating > 5) {
    throw new AppError("Rating from 1 to 5 is required.", 400);
  }

  if (!productId || !orderId) {
    throw new AppError("Product and order are required.", 400);
  }

  const order = await Order.findOne({ _id: orderId, user: req.user._id, "items.product": productId });

  if (!order) {
    throw new AppError("Only purchased products can be reviewed.", 403);
  }

  const images = (req.files || []).map(fileToCloudinaryAsset);
  const review = await Review.create({
    user: req.user._id,
    product: productId,
    order: orderId,
    rating,
    reviewText,
    images,
    isVerifiedPurchase: true
  });

  if (reviewText) {
    await Reward.create({
      user: req.user._id,
      type: "REVIEW",
      amount: 10,
      status: "Approved",
      review: review._id,
      creditedAt: new Date()
    });
    await User.findByIdAndUpdate(req.user._id, { $inc: { walletBalance: 10 } });
    await createNotification({
      user: req.user._id,
      title: "Review reward added",
      message: "Your Cantley review was approved and Rs. 10 was added to your wallet.",
      type: "REVIEW",
      link: "/reviews"
    });
  }

  await updateProductRating(productId);
  await review.populate("user", "name");

  res.status(201).json({ success: true, review });
});

export const getProductReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ product: req.params.productId })
    .populate("user", "name")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, count: reviews.length, reviews });
});

export const getMyReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ user: req.user._id })
    .populate("product", "name slug images")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, count: reviews.length, reviews });
});

export const listAdminReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find()
    .populate("user", "name email")
    .populate("product", "name slug")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, count: reviews.length, reviews });
});
