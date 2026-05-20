import Cart from "../models/Cart.js";
import Coupon from "../models/Coupon.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { calculateCartPricing } from "../services/pricing.service.js";
import { createAudienceNotifications } from "../services/notification.service.js";
import { validateCouponCode, validateCouponInput } from "../validators/coupon.validator.js";

const populateCart = (query) => query.populate("items.product", "name slug images basePrice isActive category");

export const validateCoupon = asyncHandler(async (req, res) => {
  const code = validateCouponCode(req.body);
  const cart = await populateCart(Cart.findOne({ user: req.user._id }));

  if (!cart || !cart.items.length) {
    throw new AppError("Your Cart is empty.", 400);
  }

  const pricing = await calculateCartPricing(cart, code);
  cart.appliedCouponCode = pricing.appliedCoupon?.code || "";
  await cart.save();

  res.status(200).json({
    success: true,
    message: "Coupon applied.",
    pricing
  });
});

export const listAdminCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: coupons.length,
    coupons
  });
});

export const createCoupon = asyncHandler(async (req, res) => {
  const payload = validateCouponInput(req.body);
  const coupon = await Coupon.create(payload);
  if (coupon.isActive) {
    await createAudienceNotifications({
      audience: "CUSTOMERS",
      title: "New Cantley coupon",
      message: `Use coupon ${coupon.code} on eligible orders.`,
      type: "OFFER",
      link: "/cart"
    });
  }

  res.status(201).json({
    success: true,
    coupon
  });
});

export const updateCoupon = asyncHandler(async (req, res) => {
  const payload = validateCouponInput(req.body, true);
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });

  if (!coupon) throw new AppError("Coupon not found.", 404);

  res.status(200).json({
    success: true,
    coupon
  });
});

export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);

  if (!coupon) throw new AppError("Coupon not found.", 404);

  res.status(200).json({
    success: true,
    message: "Coupon deleted."
  });
});

export const toggleCouponActive = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);

  if (!coupon) throw new AppError("Coupon not found.", 404);

  coupon.isActive = !coupon.isActive;
  await coupon.save();
  if (coupon.isActive) {
    await createAudienceNotifications({
      audience: "CUSTOMERS",
      title: "Cantley coupon is live",
      message: `Coupon ${coupon.code} is now active.`,
      type: "OFFER",
      link: "/cart"
    });
  }

  res.status(200).json({
    success: true,
    coupon
  });
});
