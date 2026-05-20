import mongoose from "mongoose";
import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();
const nullableDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError("Please provide valid offer dates.", 400);
  return date;
};
const nullableObjectId = (value, fieldName) => {
  const id = text(value);
  if (!id) return null;
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(`${fieldName} is invalid.`, 400);
  return id;
};

export const validateOfferInput = (body, partial = false) => {
  const payload = {};

  if (!partial || body.title !== undefined) {
    payload.title = text(body.title);
    if (!payload.title) throw new AppError("Offer title is required.", 400);
  }

  if (!partial || body.type !== undefined) {
    payload.type = text(body.type).toUpperCase();
    if (!["BUY_X_GET_Y", "COMBO", "PRODUCT_DISCOUNT"].includes(payload.type)) {
      throw new AppError("Offer type is invalid.", 400);
    }
  }

  ["description"].forEach((field) => {
    if (body[field] !== undefined) payload[field] = text(body[field]);
  });

  ["buyQuantity", "freeQuantity", "discountPercent"].forEach((field) => {
    if (body[field] !== undefined || !partial) {
      const value = Number(body[field] || 0);
      if (!Number.isFinite(value) || value < 0) throw new AppError(`${field} must be zero or greater.`, 400);
      payload[field] = value;
    }
  });

  if (body.targetProduct !== undefined || !partial) {
    payload.targetProduct = nullableObjectId(body.targetProduct, "Target product");
  }

  if (body.targetCategory !== undefined || !partial) {
    payload.targetCategory = nullableObjectId(body.targetCategory, "Target category");
  }

  if (body.isActive !== undefined) payload.isActive = body.isActive === true || body.isActive === "true";
  if (body.startDate !== undefined || !partial) payload.startDate = nullableDate(body.startDate);
  if (body.expiryDate !== undefined || !partial) payload.expiryDate = nullableDate(body.expiryDate);

  if (payload.discountPercent > 100) throw new AppError("Discount percent cannot exceed 100.", 400);

  return payload;
};
