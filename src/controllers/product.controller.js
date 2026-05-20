import Category from "../models/Category.js";
import Product from "../models/Product.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deleteCloudinaryAsset } from "../utils/cloudinaryCleanup.js";
import { fileToCloudinaryAsset, getMediaPublicId } from "../utils/mediaAssets.js";
import { validateProductInput } from "../validators/catalog.validator.js";

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const csvValues = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);

const getCategoryIds = async (value, { exactSlug = false } = {}) => {
  if (!value) return [];
  const escaped = escapeRegex(value);
  const categoryFilter = exactSlug
    ? { slug: value, isActive: true }
    : {
        isActive: true,
        $or: [
          { slug: { $regex: escaped, $options: "i" } },
          { name: { $regex: escaped, $options: "i" } }
        ]
      };
  const categories = await Category.find(categoryFilter).select("_id").lean();
  return categories.map((category) => category._id);
};

const buildPublicProductFilter = async (query) => {
  const filter = { isActive: true };

  if (query.category) {
    const categoryIds = await getCategoryIds(query.category, { exactSlug: true });
    filter.category = categoryIds.length ? { $in: categoryIds } : null;
  }

  if (query.productType) {
    filter.productType = { $in: csvValues(query.productType) };
  }

  if (query.material) {
    filter["variants.material"] = { $regex: escapeRegex(query.material), $options: "i" };
  }

  if (query.color) {
    filter["variants.color"] = { $regex: escapeRegex(query.color), $options: "i" };
  }

  if (query.minRating) {
    const minRating = Number(query.minRating);
    if (Number.isFinite(minRating)) filter.ratingAverage = { $gte: minRating };
  }

  if (query.inStock === "true") {
    filter.$or = [
      { variants: { $size: 0 } },
      { "variants.stock": { $gt: 0 } }
    ];
  }

  if (query.featured === "true") {
    filter.isFeatured = true;
  }

  if (query.q) {
    const keyword = String(query.q).trim();
    const regex = { $regex: escapeRegex(keyword), $options: "i" };
    const categoryIds = await getCategoryIds(keyword);
    const searchConditions = [
      { name: regex },
      { description: regex },
      { shortDescription: regex },
      { tags: regex },
      { productType: regex },
      { "variants.material": regex },
      { "variants.color": regex },
      { "variants.printType": regex },
      { "variants.finish": regex }
    ];
    if (categoryIds.length) searchConditions.push({ category: { $in: categoryIds } });
    filter.$and = [...(filter.$and || []), { $or: searchConditions }];
  }

  const minPrice = Number(query.minPrice);
  const maxPrice = Number(query.maxPrice);

  if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
    filter.basePrice = {};
    if (Number.isFinite(minPrice)) filter.basePrice.$gte = minPrice;
    if (Number.isFinite(maxPrice)) filter.basePrice.$lte = maxPrice;
  }

  return filter;
};

const buildSort = (query) => {
  if (["price-asc", "price-low-high"].includes(query.sort)) return { basePrice: 1 };
  if (["price-desc", "price-high-low"].includes(query.sort)) return { basePrice: -1 };
  if (["rating", "highest-rated"].includes(query.sort)) return { ratingAverage: -1, ratingCount: -1 };
  if (["reviews", "most-reviewed"].includes(query.sort)) return { ratingCount: -1, ratingAverage: -1 };
  if (["newest", "latest", "recently-added"].includes(query.sort)) return { createdAt: -1 };
  if (query.sort === "most-viewed") return { viewCount: -1, createdAt: -1 };
  if (query.sort === "best-selling") return { soldCount: -1, createdAt: -1 };
  if (query.sort === "trending") return { soldCount: -1, viewCount: -1, ratingCount: -1, createdAt: -1 };
  if (query.sort === "featured") return { isFeatured: -1, createdAt: -1 };
  return { isFeatured: -1, createdAt: -1 };
};

const ensureCategoryExists = async (categoryId) => {
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new AppError("Category not found.", 404);
  }
};

const parseJsonField = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const getUploadedImages = (req) => (req.files?.images || []).map(fileToCloudinaryAsset);
const getUploadedVideo = (req) => {
  const file = req.files?.video?.[0];
  return file ? fileToCloudinaryAsset(file) : null;
};

const cleanupProductMedia = async (product) => {
  await Promise.all([
    ...(product.images || [])
      .map((image) => getMediaPublicId(image))
      .filter(Boolean)
      .map((publicId) => deleteCloudinaryAsset(publicId, "image")),
    product.video && getMediaPublicId(product.video)
      ? deleteCloudinaryAsset(getMediaPublicId(product.video), "video")
      : null
  ].filter(Boolean));
};

export const listActiveProducts = asyncHandler(async (req, res) => {
  const filter = await buildPublicProductFilter(req.query);
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(48, Math.max(1, Number(req.query.limit || 12)));
  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate("category", "name slug image description")
      .sort(buildSort(req.query))
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter)
  ]);

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    totalPages: Math.max(1, Math.ceil(total / limit)),
    products
  });
});

export const getProductBySlug = asyncHandler(async (req, res) => {
  const product = await Product.findOneAndUpdate(
    { slug: req.params.slug, isActive: true },
    { $inc: { viewCount: 1 } },
    { new: true }
  )
    .populate("category", "name slug image description")
    .lean();

  if (!product) {
    throw new AppError("Product not found.", 404);
  }

  const relatedProducts = await Product.find({
    _id: { $ne: product._id },
    isActive: true,
    category: product.category?._id || product.category
  })
    .populate("category", "name slug image")
    .sort({ ratingAverage: -1, isFeatured: -1, createdAt: -1 })
    .limit(4)
    .lean();

  res.status(200).json({
    success: true,
    product,
    relatedProducts
  });
});

export const listAdminProducts = asyncHandler(async (req, res) => {
  const products = await Product.find()
    .populate("category", "name slug image")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: products.length,
    products
  });
});

export const createProduct = asyncHandler(async (req, res) => {
  const payload = validateProductInput(req.body);
  await ensureCategoryExists(payload.category);

  const uploadedImages = getUploadedImages(req);
  const uploadedVideo = getUploadedVideo(req);

  if (payload.images?.length > 5) {
    throw new AppError("Product can have a maximum of 5 images.", 400);
  }

  if (uploadedImages.length) {
    payload.images = uploadedImages;
  }

  if (uploadedVideo) {
    payload.video = uploadedVideo;
  }

  const product = await Product.create(payload);
  await product.populate("category", "name slug image");

  res.status(201).json({
    success: true,
    product
  });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const existingProduct = await Product.findById(req.params.id);

  if (!existingProduct) {
    throw new AppError("Product not found.", 404);
  }

  const payload = validateProductInput(req.body, true, {
    currentProductType: existingProduct.productType
  });

  if (payload.category) {
    await ensureCategoryExists(payload.category);
  }

  const retainedImages = parseJsonField(req.body.retainedImages, undefined);
  const removeVideo = req.body.removeVideo === "true" || req.body.removeVideo === true;
  const uploadedImages = getUploadedImages(req);
  const uploadedVideo = getUploadedVideo(req);

  if (retainedImages !== undefined || uploadedImages.length) {
    const retained = Array.isArray(retainedImages) ? retainedImages : existingProduct.images || [];
    const nextImages = [...retained, ...uploadedImages];

    if (nextImages.length > 5) {
      throw new AppError("Product can have a maximum of 5 images.", 400);
    }

    const nextPublicIds = new Set(nextImages.map(getMediaPublicId).filter(Boolean));

    await Promise.all(
      (existingProduct.images || [])
        .map((image) => getMediaPublicId(image))
        .filter((publicId) => publicId && !nextPublicIds.has(publicId))
        .map((publicId) => deleteCloudinaryAsset(publicId, "image"))
    );

    payload.images = nextImages;
  }

  if (uploadedVideo || removeVideo) {
    const oldVideoPublicId = getMediaPublicId(existingProduct.video);

    if (oldVideoPublicId) {
      await deleteCloudinaryAsset(oldVideoPublicId, "video");
    }

    payload.video = uploadedVideo || "";
  }

  const product = await Product.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true
  }).populate("category", "name slug image");

  res.status(200).json({
    success: true,
    product
  });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);

  if (!product) {
    throw new AppError("Product not found.", 404);
  }

  await cleanupProductMedia(product);

  res.status(200).json({
    success: true,
    message: "Product deleted."
  });
});

export const toggleProductActive = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw new AppError("Product not found.", 404);
  }

  product.isActive = !product.isActive;
  await product.save();
  await product.populate("category", "name slug image");

  res.status(200).json({
    success: true,
    product
  });
});
