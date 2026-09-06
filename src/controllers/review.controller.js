import Product from "../models/Product.js";
import Review from "../models/Review.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { fileToCloudinaryAsset } from "../utils/mediaAssets.js";
import { deleteCloudinaryAsset } from "../utils/cloudinaryCleanup.js";
import { createNotification } from "../services/notification.service.js";
import { createEligibleReview } from "../services/review-reward.service.js";
import { validateReviewInput } from "../validators/review.validator.js";

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
  const images = (req.files || []).map(fileToCloudinaryAsset);
  let payload;
  let result;
  try {
    payload = validateReviewInput(req.body);
    result = await createEligibleReview({ userId: req.user._id, payload, images });
  } catch (error) {
    await Promise.allSettled(images.map((image) => deleteCloudinaryAsset(image.publicId, "image")));
    throw error;
  }

  const secondaryResults = await Promise.allSettled([
    updateProductRating(payload.productId),
    createNotification({
      user: req.user._id,
      title: result.rewardGranted ? "Review reward added" : "Review submitted",
      message: result.rewardGranted ? "Your review earned Rs. 10 in wallet credit." : "Your Cantley review was submitted.",
      type: "REVIEW",
      link: "/reviews"
    })
  ]);
  secondaryResults.forEach((secondaryResult, index) => {
    if (secondaryResult.status === "rejected") {
      const operation = index === 0 ? "Product rating recalculation" : "Review notification";
      console.error(`${operation} failed after review commit:`, secondaryResult.reason?.message || secondaryResult.reason);
    }
  });
  try {
    await result.review.populate("user", "name");
  } catch (error) {
    console.error("Review user population failed after commit:", error.message);
  }

  res.status(201).json({ success: true, ...result });
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
