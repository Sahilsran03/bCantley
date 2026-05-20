import mongoose from "mongoose";
import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();
const numberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new AppError("Numeric values must be zero or greater.", 400);
  return number;
};
const dateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError("Please provide valid coupon dates.", 400);
  return date;
};
const objectIdList = (value, fieldName) => {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return items
    .map((item) => text(item))
    .filter(Boolean)
    .map((item) => {
      if (!mongoose.Types.ObjectId.isValid(item)) throw new AppError(`${fieldName} contains an invalid id.`, 400);
      return item;
    });
};

export const validateCouponInput = (body, partial = false) => {
  const payload = {};

  if (!partial || body.code !== undefined) {
    payload.code = text(body.code).toUpperCase();
    if (!payload.code) throw new AppError("Coupon code is required.", 400);
  }

  if (!partial || body.type !== undefined) {
    payload.type = text(body.type).toUpperCase();
    if (!["PERCENTAGE", "FIXED", "FREE_SHIPPING"].includes(payload.type)) {
      throw new AppError("Coupon type is invalid.", 400);
    }
  }

  if (body.description !== undefined) payload.description = text(body.description);

  ["value", "minOrderAmount", "maxDiscountAmount", "usageLimit"].forEach((field) => {
    if (body[field] !== undefined || !partial) payload[field] = numberOrNull(body[field]);
  });

  if (payload.value === null) payload.value = 0;
  if (payload.minOrderAmount === null) payload.minOrderAmount = 0;

  if (body.startDate !== undefined || !partial) payload.startDate = dateOrNull(body.startDate);
  if (body.expiryDate !== undefined || !partial) payload.expiryDate = dateOrNull(body.expiryDate);
  if (body.isActive !== undefined) payload.isActive = body.isActive === true || body.isActive === "true";

  if (body.applicableCategories !== undefined) {
    payload.applicableCategories = objectIdList(body.applicableCategories, "Applicable categories");
  }
  if (body.applicableProducts !== undefined) {
    payload.applicableProducts = objectIdList(body.applicableProducts, "Applicable products");
  }
  if (body.excludedProducts !== undefined) {
    payload.excludedProducts = objectIdList(body.excludedProducts, "Excluded products");
  }

  if (payload.type === "PERCENTAGE" && payload.value > 100) {
    throw new AppError("Percentage coupon value cannot exceed 100.", 400);
  }

  return payload;
};

export const validateCouponCode = (body) => {
  const code = text(body.code).toUpperCase();
  if (!code) throw new AppError("Coupon code is required.", 400);
  return code;
};
