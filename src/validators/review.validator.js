import mongoose from "mongoose";
import { AppError } from "../utils/appError.js";

export const REVIEW_REWARD_AMOUNT = 10;
export const REVIEW_TEXT_MIN_LENGTH = 10;
export const REVIEW_TEXT_MAX_LENGTH = 1200;

export const validateReviewInput = (body = {}) => {
  const orderId = String(body.orderId || "").trim();
  const productId = String(body.productId || "").trim();
  const rating = Number(body.rating);
  const reviewText = String(body.reviewText || "").trim();

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError("A valid order is required.", 400);
  }
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new AppError("A valid product is required.", 400);
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("Rating must be a whole number from 1 to 5.", 400);
  }
  if (reviewText && reviewText.length < REVIEW_TEXT_MIN_LENGTH) {
    throw new AppError(`Written reviews must contain at least ${REVIEW_TEXT_MIN_LENGTH} characters. Leave the text blank to submit a rating only.`, 400);
  }
  if (reviewText.length > REVIEW_TEXT_MAX_LENGTH) {
    throw new AppError(`Review text must not exceed ${REVIEW_TEXT_MAX_LENGTH} characters.`, 400);
  }

  return { orderId, productId, rating, reviewText };
};
