import Coupon from "../models/Coupon.js";
import Offer from "../models/Offer.js";
import { AppError } from "../utils/appError.js";

const today = () => new Date();
const roundMoney = (value) => Math.max(0, Math.round(Number(value || 0)));
const idString = (value) => String(value?._id || value || "");
const useSession = (query, session) => session && typeof query?.session === "function" ? query.session(session) : query;

const isActiveWindow = (record) => {
  const now = today();
  const startsOk = !record.startDate || record.startDate <= now;
  const expiresOk = !record.expiryDate || record.expiryDate >= now;
  return record.isActive && startsOk && expiresOk;
};

const getCartItems = (cart) => cart.items.filter((item) => item.product && item.product.isActive !== false);

const itemLineTotal = (item) => Number(item.unitPrice || 0) * Number(item.quantity || 0);

const couponAppliesToItem = (coupon, item) => {
  const productId = idString(item.product);
  const categoryId = idString(item.product?.category);
  const excluded = coupon.excludedProducts.some((id) => idString(id) === productId);

  if (excluded) return false;

  const productScoped = coupon.applicableProducts.length > 0;
  const categoryScoped = coupon.applicableCategories.length > 0;

  if (!productScoped && !categoryScoped) return true;

  return (
    coupon.applicableProducts.some((id) => idString(id) === productId) ||
    coupon.applicableCategories.some((id) => idString(id) === categoryId)
  );
};

const calculateCouponDiscount = (coupon, items, subtotal, shippingFee) => {
  if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
    throw new AppError(`Coupon requires minimum order amount of Rs. ${coupon.minOrderAmount}.`, 400);
  }

  const eligibleAmount = items
    .filter((item) => couponAppliesToItem(coupon, item))
    .reduce((sum, item) => sum + itemLineTotal(item), 0);

  if (!eligibleAmount && coupon.type !== "FREE_SHIPPING") {
    throw new AppError("Coupon is not applicable to these products.", 400);
  }

  let discountAmount = 0;

  if (coupon.type === "PERCENTAGE") {
    discountAmount = eligibleAmount * (Number(coupon.value || 0) / 100);
  }

  if (coupon.type === "FIXED") {
    discountAmount = Math.min(Number(coupon.value || 0), eligibleAmount);
  }

  if (coupon.type === "FREE_SHIPPING") {
    discountAmount = shippingFee;
  }

  if (coupon.maxDiscountAmount !== null && coupon.maxDiscountAmount !== undefined) {
    discountAmount = Math.min(discountAmount, Number(coupon.maxDiscountAmount || 0));
  }

  return roundMoney(Math.min(discountAmount, subtotal + shippingFee));
};

export const findValidCoupon = async (code, { session = null } = {}) => {
  const normalizedCode = String(code || "").trim().toUpperCase();

  if (!normalizedCode) return null;

  const coupon = await useSession(Coupon.findOne({ code: normalizedCode }), session);

  if (!coupon || !isActiveWindow(coupon)) {
    throw new AppError("Coupon is invalid or expired.", 400);
  }

  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    throw new AppError("Coupon usage limit has been reached.", 400);
  }

  return coupon;
};

export const getActiveOffers = async ({ session = null } = {}) => {
  const query = Offer.find({ isActive: true }).sort({ createdAt: -1 });
  const offers = await useSession(query, session);
  return offers.filter(isActiveWindow);
};

const appliesToOfferTarget = (offer, item) => {
  const productId = idString(item.product);
  const categoryId = idString(item.product?.category);

  if (offer.targetProduct && idString(offer.targetProduct) !== productId) return false;
  if (offer.targetCategory && idString(offer.targetCategory) !== categoryId) return false;

  return true;
};

const calculateOfferDiscounts = async (items, subtotal, session = null) => {
  const offers = await getActiveOffers({ session });
  const appliedOffers = [];
  let offerDiscount = 0;

  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  if (itemCount >= 5) {
    appliedOffers.push({
      offer: null,
      title: "Buy 5 items, get 1 free T-shirt reward",
      type: "FREE_TSHIRT_REWARD",
      discountAmount: 0,
      freeQuantity: 1
    });
  }

  offers.forEach((offer) => {
    const eligibleItems = items.filter((item) => appliesToOfferTarget(offer, item));
    const eligibleQuantity = eligibleItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const eligibleAmount = eligibleItems.reduce((sum, item) => sum + itemLineTotal(item), 0);

    if (!eligibleItems.length) return;

    if (offer.type === "BUY_X_GET_Y" && offer.buyQuantity > 0 && eligibleQuantity >= offer.buyQuantity) {
      const freeQuantity = Math.floor(eligibleQuantity / offer.buyQuantity) * Number(offer.freeQuantity || 0);
      if (freeQuantity > 0) {
        appliedOffers.push({
          offer: offer._id,
          title: offer.title,
          type: offer.type,
          discountAmount: 0,
          freeQuantity
        });
      }
    }

    if (["COMBO", "PRODUCT_DISCOUNT"].includes(offer.type) && offer.discountPercent > 0) {
      if (offer.buyQuantity > 0 && eligibleQuantity < offer.buyQuantity) return;

      const discountAmount = roundMoney(eligibleAmount * (Number(offer.discountPercent || 0) / 100));
      if (discountAmount > 0) {
        offerDiscount += discountAmount;
        appliedOffers.push({
          offer: offer._id,
          title: offer.title,
          type: offer.type,
          discountAmount,
          freeQuantity: 0
        });
      }
    }
  });

  return {
    offerDiscount: roundMoney(Math.min(offerDiscount, subtotal)),
    appliedOffers
  };
};

export const calculateCartPricing = async (cart, couponCode = "", { session = null } = {}) => {
  const items = getCartItems(cart);
  const subtotal = roundMoney(items.reduce((sum, item) => sum + itemLineTotal(item), 0));
  const shippingFee = 0;
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const { offerDiscount, appliedOffers } = await calculateOfferDiscounts(items, subtotal, session);
  const coupon = await findValidCoupon(couponCode, { session });
  const couponDiscount = coupon ? calculateCouponDiscount(coupon, items, Math.max(0, subtotal - offerDiscount), shippingFee) : 0;
  const discountAmount = roundMoney(Math.min(subtotal + shippingFee, offerDiscount + couponDiscount));
  const totalAmount = roundMoney(subtotal + shippingFee - discountAmount);

  return {
    items,
    itemCount,
    subtotal,
    shippingFee,
    discountAmount,
    totalAmount,
    appliedCoupon: coupon
      ? {
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          discountAmount: couponDiscount
        }
      : null,
    appliedOffers
  };
};

export const incrementCouponUsage = async (code, { session = null } = {}) => {
  if (!code) return;
  await Coupon.updateOne(
    { code: String(code).trim().toUpperCase() },
    { $inc: { usedCount: 1 } },
    session ? { session } : undefined
  );
};
