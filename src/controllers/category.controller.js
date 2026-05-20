import Category from "../models/Category.js";
import Product from "../models/Product.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deleteCloudinaryAsset } from "../utils/cloudinaryCleanup.js";
import { fileToCloudinaryAsset, getMediaPublicId } from "../utils/mediaAssets.js";
import { validateCategoryInput } from "../validators/catalog.validator.js";

export const listActiveCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();

  res.status(200).json({
    success: true,
    count: categories.length,
    categories
  });
});

export const getCategoryBySlug = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug, isActive: true }).lean();

  if (!category) {
    throw new AppError("Category not found.", 404);
  }

  res.status(200).json({
    success: true,
    category
  });
});

export const listAdminCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 });

  res.status(200).json({
    success: true,
    count: categories.length,
    categories
  });
});

export const createCategory = asyncHandler(async (req, res) => {
  const payload = validateCategoryInput(req.body);

  if (req.file) {
    payload.image = fileToCloudinaryAsset(req.file);
  }

  const category = await Category.create(payload);

  res.status(201).json({
    success: true,
    category
  });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const payload = validateCategoryInput(req.body, true);
  const existingCategory = await Category.findById(req.params.id);

  if (!existingCategory) {
    throw new AppError("Category not found.", 404);
  }

  if (req.file) {
    const oldPublicId = getMediaPublicId(existingCategory.image);

    if (oldPublicId) {
      await deleteCloudinaryAsset(oldPublicId, "image");
    }

    payload.image = fileToCloudinaryAsset(req.file);
  }

  const category = await Category.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true
  });

  res.status(200).json({
    success: true,
    category
  });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const productCount = await Product.countDocuments({ category: req.params.id });

  if (productCount > 0) {
    throw new AppError("Cannot delete a category that has products.", 409);
  }

  const category = await Category.findByIdAndDelete(req.params.id);

  if (!category) {
    throw new AppError("Category not found.", 404);
  }

  const publicId = getMediaPublicId(category.image);

  if (publicId) {
    await deleteCloudinaryAsset(publicId, "image");
  }

  res.status(200).json({
    success: true,
    message: "Category deleted."
  });
});
