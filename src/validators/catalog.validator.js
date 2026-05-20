import mongoose from "mongoose";
import { AppError } from "../utils/appError.js";
import { slugify } from "../utils/slugify.js";

const productTypes = ["tshirt", "oversized-tshirt", "hoodie", "sticker", "label", "other", "clothing"];
const clothingProductTypes = ["tshirt", "oversized-tshirt", "hoodie"];
const stickerProductTypes = ["sticker", "label"];
const units = ["", "mm", "cm", "inch"];

const text = (value) => String(value || "").trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const boolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};
const array = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const object = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

export const validateCategoryInput = (body, partial = false) => {
  const payload = {};

  if (!partial || body.name !== undefined) {
    payload.name = text(body.name);
    if (payload.name.length < 2 || payload.name.length > 100) {
      throw new AppError("Category name must be between 2 and 100 characters.", 400);
    }
    payload.slug = text(body.slug) ? slugify(body.slug) : slugify(payload.name);
  }

  if (!partial || body.description !== undefined) payload.description = text(body.description);
  if (!partial || body.image !== undefined) payload.image = object(body.image, text(body.image));
  if (!partial || body.isActive !== undefined) payload.isActive = boolean(body.isActive, true);
  if (!partial || body.sortOrder !== undefined) payload.sortOrder = number(body.sortOrder, 0);

  return payload;
};

const normalizeVariants = (variants) =>
  array(variants).map((variant, index) => {
    const stock = number(variant.stock, -1);
    const unit = text(variant.unit);

    if (stock < 0) {
      throw new AppError(`Variant ${index + 1}: stock must be 0 or greater.`, 400);
    }

    if (unit && !units.includes(unit)) {
      throw new AppError(`Variant ${index + 1}: invalid unit.`, 400);
    }

    return {
      size: text(variant.size),
      color: text(variant.color),
      material: text(variant.material),
      printType: text(variant.printType),
      finish: text(variant.finish),
      shape: text(variant.shape),
      width: variant.width === "" || variant.width === undefined ? null : Math.max(0, number(variant.width, 0)),
      height: variant.height === "" || variant.height === undefined ? null : Math.max(0, number(variant.height, 0)),
      unit,
      waterproof: boolean(variant.waterproof, false),
      stock,
      sku: text(variant.sku),
      priceModifier: number(variant.priceModifier, 0)
    };
  });

const validateVariantRules = (variants, productType, partial) => {
  if (!variants && partial) return;

  const normalizedVariants = variants || [];

  if (clothingProductTypes.includes(productType) && normalizedVariants.length < 1) {
    throw new AppError("At least one variant is required for clothing products.", 400);
  }

  normalizedVariants.forEach((variant, index) => {
    if (clothingProductTypes.includes(productType) && !variant.size) {
      throw new AppError(`Variant ${index + 1}: size is required for clothing products.`, 400);
    }

    if (stickerProductTypes.includes(productType) && (!variant.shape || !variant.width || !variant.height)) {
      throw new AppError(`Variant ${index + 1}: shape, width, and height are required.`, 400);
    }
  });

  const skus = normalizedVariants.map((variant) => variant.sku).filter(Boolean);
  if (new Set(skus).size !== skus.length) {
    throw new AppError("Variant SKU values must be unique when provided.", 400);
  }
};

export const validateProductInput = (body, partial = false, options = {}) => {
  const payload = {};
  const nextProductType = text(body.productType || options.currentProductType || "");

  if (!partial || body.name !== undefined) {
    payload.name = text(body.name);
    if (payload.name.length < 2 || payload.name.length > 160) {
      throw new AppError("Product name must be between 2 and 160 characters.", 400);
    }
    payload.slug = text(body.slug) ? slugify(body.slug) : slugify(payload.name);
  }

  if (!partial || body.description !== undefined) payload.description = text(body.description);
  if (!partial || body.shortDescription !== undefined) {
    payload.shortDescription = text(body.shortDescription);
  }

  if (!partial || body.category !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(body.category)) {
      throw new AppError("A valid category is required.", 400);
    }
    payload.category = body.category;
  }

  if (!partial || body.productType !== undefined) {
    payload.productType = text(body.productType);
    if (!productTypes.includes(payload.productType)) {
      throw new AppError("Invalid product type.", 400);
    }
  }

  if (!partial || body.images !== undefined) {
    payload.images = array(body.images)
      .map((image) => (typeof image === "string" ? image : object(image, null)))
      .filter(Boolean);
  }
  if (!partial || body.video !== undefined) {
    payload.video = typeof body.video === "string" ? text(body.video) : object(body.video, "");
  }
  if (!partial || body.basePrice !== undefined) {
    payload.basePrice = number(body.basePrice, -1);
    if (payload.basePrice < 0) {
      throw new AppError("Base price must be zero or greater.", 400);
    }
  }
  if (!partial || body.isActive !== undefined) payload.isActive = boolean(body.isActive, true);
  if (!partial || body.isFeatured !== undefined) payload.isFeatured = boolean(body.isFeatured, false);
  if (!partial || body.tags !== undefined) payload.tags = array(body.tags).map(text).filter(Boolean);
  if (!partial || body.ratingAverage !== undefined) {
    payload.ratingAverage = Math.min(5, Math.max(0, number(body.ratingAverage, 0)));
  }
  if (!partial || body.ratingCount !== undefined) {
    payload.ratingCount = Math.max(0, number(body.ratingCount, 0));
  }
  if (!partial || body.variants !== undefined) payload.variants = normalizeVariants(body.variants);
  validateVariantRules(payload.variants, payload.productType || nextProductType, partial);

  return payload;
};
