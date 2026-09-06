import CustomDesign from "../models/CustomDesign.js";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deleteCloudinaryAsset } from "../utils/cloudinaryCleanup.js";
import { validateDesignInput, validateDesignStatus } from "../validators/design.validator.js";

const fileToDesignAsset = (file) => ({
  url: file.path,
  publicId: file.filename,
  resourceType: file.resource_type || (file.mimetype === "application/pdf" ? "raw" : file.mimetype?.startsWith("video/") ? "video" : "image"),
  originalName: file.originalname || ""
});

const getUploadedAssets = (files = {}) => {
  const artwork = [...(files.artwork || []), ...(files.sourceFiles || [])];
  const sourceVideo = files.sourceVideo || [];
  const sourceFiles = [...artwork, ...sourceVideo].map(fileToDesignAsset);

  return {
    sourceFiles,
    previewImage: artwork[0] ? fileToDesignAsset(artwork[0]) : undefined
  };
};

const getUploadedPreview = (files = {}) => {
  const preview = files.previewImage?.[0];
  return preview ? fileToDesignAsset(preview) : null;
};

const findCustomerDesign = async (userId, designId) => {
  const design = await CustomDesign.findOne({ _id: designId, user: userId }).populate("product", "name slug productType images");

  if (!design) {
    throw new AppError("Design not found.", 404);
  }

  return design;
};

const cleanupAssets = async (assets) => {
  await Promise.all(
    assets
      .filter((asset) => asset?.publicId)
      .map((asset) => deleteCloudinaryAsset(asset.publicId, asset.resourceType || "image"))
  );
};

export const createDesign = asyncHandler(async (req, res) => {
  const payload = validateDesignInput(req.body);
  const uploads = getUploadedAssets(req.files);
  const previewImage = getUploadedPreview(req.files);

  if (payload.product) {
    const product = await Product.findById(payload.product);
    if (!product) throw new AppError("Product not found.", 404);
  }

  const design = await CustomDesign.create({
    ...payload,
    user: req.user._id,
    sourceFiles: uploads.sourceFiles,
    previewImage: previewImage || uploads.previewImage || null
  });

  res.status(201).json({
    success: true,
    design
  });
});

export const saveDraftDesign = createDesign;

export const listMyDesigns = asyncHandler(async (req, res) => {
  const designs = await CustomDesign.find({ user: req.user._id }).populate("product", "name slug productType images").sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: designs.length,
    designs
  });
});

export const listSavedDesigns = asyncHandler(async (req, res) => {
  const designs = await CustomDesign.find({ user: req.user._id, isSavedTemplate: true })
    .populate("product", "name slug productType images")
    .sort({ lastEditedAt: -1 });

  res.status(200).json({
    success: true,
    count: designs.length,
    designs
  });
});

export const getDesignById = asyncHandler(async (req, res) => {
  const design = await findCustomerDesign(req.user._id, req.params.id);

  res.status(200).json({
    success: true,
    design
  });
});

export const updateDesign = asyncHandler(async (req, res) => {
  const design = await findCustomerDesign(req.user._id, req.params.id);

  if (["Approved", "Rejected"].includes(design.status)) {
    throw new AppError("Approved or rejected designs cannot be edited.", 409);
  }

  const payload = validateDesignInput(req.body, true);
  const uploads = getUploadedAssets(req.files);
  const previewImage = getUploadedPreview(req.files);

  Object.assign(design, payload);
  design.lastEditedAt = new Date();

  if (uploads.sourceFiles.length) {
    await cleanupAssets(design.sourceFiles);
    design.sourceFiles = uploads.sourceFiles;
    design.previewImage = previewImage || uploads.previewImage || design.previewImage || null;
  } else if (previewImage) {
    if (design.previewImage?.publicId) await cleanupAssets([design.previewImage]);
    design.previewImage = previewImage;
  }

  await design.save();

  res.status(200).json({
    success: true,
    design
  });
});

export const uploadDesignSource = asyncHandler(async (req, res) => {
  const uploads = getUploadedAssets(req.files);

  res.status(201).json({
    success: true,
    files: uploads.sourceFiles
  });
});

export const uploadDesignPreview = asyncHandler(async (req, res) => {
  const previewImage = getUploadedPreview(req.files);

  if (!previewImage) {
    throw new AppError("Preview image is required.", 400);
  }

  res.status(201).json({
    success: true,
    previewImage
  });
});

export const addDesignToCart = asyncHandler(async (req, res) => {
  const design = await findCustomerDesign(req.user._id, req.params.id);
  const productId = design.product?._id || design.product;

  if (!productId) {
    throw new AppError("Select a product before adding this design to Cart.", 400);
  }

  const product = await Product.findOne({ _id: productId, isActive: true });
  if (!product) throw new AppError("Product is not available.", 404);

  const variantSnapshot = design.variantSnapshot || {};
  const selectedOptions = {
    size: variantSnapshot.size || "",
    color: variantSnapshot.color || "",
    material: variantSnapshot.material || "",
    printType: variantSnapshot.printType || "",
    finish: variantSnapshot.finish || ""
  };
  const variant = product.variants.length
    ? product.variants.find((item) => (variantSnapshot.sku && item.sku === variantSnapshot.sku) || ["size", "color", "material", "printType", "finish"].every((field) => String(item[field] || "") === String(selectedOptions[field] || "")))
    : null;

  if (product.variants.length && !variant) {
    throw new AppError("Please select a valid product variant for this design.", 400);
  }

  if (variant && variant.stock < 1) {
    throw new AppError("Selected variant does not have enough stock.", 400);
  }

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

  cart.items.push({
    product: product._id,
    variantSku: variant?.sku || variantSnapshot.sku || "",
    selectedOptions,
    quantity: 1,
    unitPrice: Number(product.basePrice || 0) + Number(variant?.priceModifier || 0),
    customDesign: design._id,
    designPreview: design.previewImage,
    designData: design.canvasJson
  });

  design.status = design.status === "Draft" ? "Submitted" : design.status;
  design.lastEditedAt = new Date();
  const currentCartVersion = Number.isInteger(cart.version) && cart.version >= 1 ? cart.version : 1;
  cart.version = currentCartVersion + 1;
  await Promise.all([cart.save(), design.save()]);
  await cart.populate("items.product", "name slug images basePrice isActive");

  res.status(200).json({
    success: true,
    cart
  });
});

export const saveDesignTemplate = asyncHandler(async (req, res) => {
  const design = await findCustomerDesign(req.user._id, req.params.id);
  design.isSavedTemplate = true;
  design.templateName = String(req.body.templateName || design.templateName || design.product?.name || `${design.designType} template`).trim();
  design.lastEditedAt = new Date();
  await design.save();

  res.status(200).json({
    success: true,
    design
  });
});

export const removeDesignTemplate = asyncHandler(async (req, res) => {
  const design = await findCustomerDesign(req.user._id, req.params.id);
  design.isSavedTemplate = false;
  design.templateName = "";
  design.lastEditedAt = new Date();
  await design.save();

  res.status(200).json({
    success: true,
    design
  });
});

export const deleteDesign = asyncHandler(async (req, res) => {
  const design = await findCustomerDesign(req.user._id, req.params.id);

  if (design.status === "Approved") {
    throw new AppError("Approved designs cannot be deleted.", 409);
  }

  await cleanupAssets(design.sourceFiles);
  await design.deleteOne();

  res.status(200).json({
    success: true,
    message: "Design deleted."
  });
});

export const listAdminDesigns = asyncHandler(async (req, res) => {
  const designs = await CustomDesign.find()
    .populate("user", "name email phone")
    .populate("product", "name slug productType images")
    .populate("order", "orderNumber")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: designs.length,
    designs
  });
});

export const getAdminDesignById = asyncHandler(async (req, res) => {
  const design = await CustomDesign.findById(req.params.id)
    .populate("user", "name email phone")
    .populate("product", "name slug productType images variants")
    .populate("order", "orderNumber");

  if (!design) {
    throw new AppError("Design not found.", 404);
  }

  res.status(200).json({
    success: true,
    design
  });
});

export const updateDesignStatus = asyncHandler(async (req, res) => {
  const payload = validateDesignStatus(req.body);
  const design = await CustomDesign.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true })
    .populate("user", "name email phone")
    .populate("product", "name slug productType images");

  if (!design) {
    throw new AppError("Design not found.", 404);
  }

  res.status(200).json({
    success: true,
    design
  });
});
