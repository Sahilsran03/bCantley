import mongoose from "mongoose";
import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();

export const validateAddCartItem = (body) => {
  if (!mongoose.Types.ObjectId.isValid(body.productId)) {
    throw new AppError("A valid product is required.", 400);
  }

  const quantity = Number(body.quantity || 1);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError("Quantity must be at least 1.", 400);
  }

  const selectedOptions = body.selectedOptions || {};

  return {
    productId: body.productId,
    quantity,
    variantSku: text(body.variantSku),
    selectedOptions: {
      size: text(selectedOptions.size),
      color: text(selectedOptions.color),
      material: text(selectedOptions.material),
      printType: text(selectedOptions.printType),
      finish: text(selectedOptions.finish)
    },
    customDesign: mongoose.Types.ObjectId.isValid(body.customDesign || "") ? body.customDesign : null,
    designPreview: body.designPreview || null,
    designData: body.designData || null
  };
};

export const validateUpdateCartItem = (body) => {
  const quantity = Number(body.quantity);

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError("Quantity must be at least 1.", 400);
  }

  return { quantity };
};
