import mongoose from "mongoose";
import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();
const optionalObjectId = (value, label) => {
  const id = text(value);
  if (!id) return null;
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(`${label} is invalid.`, 400);
  return id;
};

const parseCustomization = (body) => {
  const source = typeof body.customization === "string" ? JSON.parse(body.customization || "{}") : body.customization || body;

  return {
    text: text(source.text),
    font: text(source.font) || "Inter",
    textColor: text(source.textColor) || "#111827",
    placement: text(source.placement) || "front",
    rotation: Number(source.rotation || 0),
    scale: Number(source.scale || 1)
  };
};

const parseJsonField = (value, label, fallback = null) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value || "null");
  } catch {
    throw new AppError(`${label} must be valid JSON.`, 400);
  }
};

export const validateDesignInput = (body, partial = false) => {
  let customization;

  try {
    customization = parseCustomization(body);
  } catch {
    throw new AppError("Customization must be valid JSON.", 400);
  }

  const payload = {
    customization,
    canvasJson: parseJsonField(body.canvasJson, "Canvas JSON"),
    variantSnapshot: parseJsonField(body.variantSnapshot, "Variant snapshot"),
    placement: text(body.placement || customization.placement || "front"),
    aiPrompt: text(body.aiPrompt),
    backgroundRemoved: body.backgroundRemoved === true || body.backgroundRemoved === "true"
  };

  if (!partial || body.designType !== undefined) {
    payload.designType = text(body.designType);
    if (!["tshirt", "hoodie", "sticker", "label"].includes(payload.designType)) {
      throw new AppError("Design type is invalid.", 400);
    }
  }

  if (body.product !== undefined || body.productId !== undefined) {
    payload.product = optionalObjectId(body.product || body.productId, "Product");
  }

  if (body.order !== undefined || body.orderId !== undefined) {
    payload.order = optionalObjectId(body.order || body.orderId, "Order");
  }

  if (body.status !== undefined) {
    payload.status = text(body.status);
    if (!["Draft", "Submitted"].includes(payload.status)) {
      throw new AppError("Customers can save drafts or submit designs only.", 400);
    }
  } else if (!partial) {
    payload.status = "Draft";
  }

  if (payload.customization.placement === "sleeve") payload.customization.placement = "left sleeve";
  if (payload.placement === "sleeve") payload.placement = "left sleeve";

  if (!["front", "back", "left sleeve", "right sleeve", "full sticker"].includes(payload.customization.placement)) {
    throw new AppError("Placement is invalid.", 400);
  }

  if (!["front", "back", "left sleeve", "right sleeve", "full sticker"].includes(payload.placement)) {
    throw new AppError("Placement is invalid.", 400);
  }

  if (!Number.isFinite(payload.customization.rotation)) {
    throw new AppError("Rotation must be a valid number.", 400);
  }

  if (!Number.isFinite(payload.customization.scale) || payload.customization.scale < 0.1 || payload.customization.scale > 5) {
    throw new AppError("Scale must be between 0.1 and 5.", 400);
  }

  return payload;
};

export const validateDesignStatus = (body) => {
  const status = text(body.status);
  const adminNote = text(body.adminNote);

  if (!["Draft", "Submitted", "Approved", "Rejected"].includes(status)) {
    throw new AppError("Design status is invalid.", 400);
  }

  return { status, adminNote };
};
