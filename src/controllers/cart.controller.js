import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { calculateCartPricing } from "../services/pricing.service.js";
import { validateAddCartItem, validateUpdateCartItem } from "../validators/cart.validator.js";

const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });

  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }

  return cart;
};

const matchesSelectedOptions = (variant, selectedOptions) =>
  ["size", "color", "material", "printType", "finish"].every(
    (field) => String(variant[field] || "") === String(selectedOptions[field] || "")
  );

const findSelectedVariant = (product, variantSku, selectedOptions) => {
  if (variantSku) {
    return product.variants.find((item) => item.sku && item.sku === variantSku);
  }

  return product.variants.find((item) => matchesSelectedOptions(item, selectedOptions));
};

const calculateItemPrice = (product, variant) => {
  return Number(product.basePrice || 0) + Number(variant?.priceModifier || 0);
};

const incrementCartVersion = (cart) => {
  const currentVersion = Number.isInteger(cart.version) && cart.version >= 1 ? cart.version : 1;
  cart.version = currentVersion + 1;
};

const formatCart = async (cart) => {
  const items = cart.items.filter((item) => item.product);
  let pricing;

  try {
    pricing = await calculateCartPricing({ ...cart.toObject(), items }, cart.appliedCouponCode);
  } catch (error) {
    cart.appliedCouponCode = "";
    incrementCartVersion(cart);
    await cart.save();
    pricing = await calculateCartPricing({ ...cart.toObject(), items }, "");
  }

  return {
    id: cart._id.toString(),
    version: cart.version,
    items,
    appliedCouponCode: cart.appliedCouponCode || "",
    itemCount: pricing.itemCount,
    subtotal: pricing.subtotal,
    shippingFee: pricing.shippingFee,
    discountAmount: pricing.discountAmount,
    totalAmount: pricing.totalAmount,
    appliedCoupon: pricing.appliedCoupon,
    appliedOffers: pricing.appliedOffers
  };
};

export const getCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  await cart.populate("items.product", "name slug images basePrice isActive");

  res.status(200).json({
    success: true,
    cart: await formatCart(cart)
  });
});

export const addCartItem = asyncHandler(async (req, res) => {
  const payload = validateAddCartItem(req.body);
  const product = await Product.findOne({ _id: payload.productId, isActive: true });

  if (!product) {
    throw new AppError("Product is not available.", 404);
  }

  const selectedVariant = findSelectedVariant(product, payload.variantSku, payload.selectedOptions);

  if (product.variants.length && !selectedVariant) {
    throw new AppError("Please select a valid product variant.", 400);
  }

  if (selectedVariant && selectedVariant.stock < payload.quantity) {
    throw new AppError("Selected variant does not have enough stock.", 400);
  }

  const cart = await getOrCreateCart(req.user._id);
  const existingItem = cart.items.find(
    (item) =>
      !payload.customDesign &&
      !item.customDesign &&
      item.product.toString() === payload.productId &&
      item.variantSku === payload.variantSku &&
      matchesSelectedOptions(item.selectedOptions, payload.selectedOptions)
  );

  if (existingItem) {
    if (selectedVariant && selectedVariant.stock < existingItem.quantity + payload.quantity) {
      throw new AppError("Selected variant does not have enough stock.", 400);
    }

    existingItem.quantity += payload.quantity;
  } else {
    cart.items.push({
      product: product._id,
      variantSku: payload.variantSku,
      selectedOptions: payload.selectedOptions,
      quantity: payload.quantity,
      unitPrice: calculateItemPrice(product, selectedVariant),
      customDesign: payload.customDesign,
      designPreview: payload.designPreview,
      designData: payload.designData
    });
  }

  incrementCartVersion(cart);
  await cart.save();
  await cart.populate("items.product", "name slug images basePrice isActive");

  res.status(200).json({
    success: true,
    cart: await formatCart(cart)
  });
});

export const updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = validateUpdateCartItem(req.body);
  const cart = await getOrCreateCart(req.user._id);
  const item = cart.items.id(req.params.itemId);

  if (!item) {
    throw new AppError("Cart item not found.", 404);
  }

  const product = await Product.findById(item.product);
  const selectedVariant = product
    ? findSelectedVariant(product, item.variantSku, item.selectedOptions)
    : null;

  if (selectedVariant && selectedVariant.stock < quantity) {
    throw new AppError("Selected variant does not have enough stock.", 400);
  }

  if (item.quantity !== quantity) {
    item.quantity = quantity;
    incrementCartVersion(cart);
  }
  await cart.save();
  await cart.populate("items.product", "name slug images basePrice isActive");

  res.status(200).json({
    success: true,
    cart: await formatCart(cart)
  });
});

export const removeCartItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const item = cart.items.id(req.params.itemId);

  if (!item) {
    throw new AppError("Cart item not found.", 404);
  }

  item.deleteOne();
  incrementCartVersion(cart);
  await cart.save();
  await cart.populate("items.product", "name slug images basePrice isActive");

  res.status(200).json({
    success: true,
    cart: await formatCart(cart)
  });
});

export const clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const hasCartState = cart.items.length > 0 || Boolean(cart.appliedCouponCode);

  if (hasCartState) {
    cart.items = [];
    cart.appliedCouponCode = "";
    incrementCartVersion(cart);
    await cart.save();
  }

  res.status(200).json({
    success: true,
    cart: await formatCart(cart)
  });
});
