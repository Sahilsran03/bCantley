import { calculateCodTerms } from "./cod.service.js";
import { AppError } from "../utils/appError.js";

export const assertCurrentCartVersion = (cart, expectedCartVersion) => {
  if (cart.version !== expectedCartVersion) {
    throw new AppError("Your Cart has changed. Please review it before checking out.", 409);
  }
};

export const assertShippingForPaymentMethod = (shipping, paymentMethod) => {
  if (shipping.isInternational || !shipping.isServiceable) {
    throw new AppError(shipping.message || "Shipping is not available for this address.", 400);
  }
  if (paymentMethod === "COD" && !shipping.isCODAvailable) {
    throw new AppError("COD is not available for this postal code.", 400);
  }
};

export const withAuthoritativeCartPrices = (cart, orderItems) => {
  if (!cart?.items || cart.items.length !== orderItems.length) {
    throw new AppError("Cart pricing requires reconciliation.", 409);
  }
  cart.items.forEach((item, index) => {
    item.unitPrice = Number(orderItems[index].finalPrice);
  });
  return cart;
};

export const buildCheckoutPreview = ({ pricing, shipping, orderItems, paymentMethod = "COD", walletBalance }) => {
  const shippingFee = Number(shipping.shippingFee || 0);
  const totalAmount = Math.max(0, Number(pricing.totalAmount || 0) + shippingFee);

  if (paymentMethod === "WALLET") {
    const usable = Number.isSafeInteger(walletBalance) && walletBalance >= 0 && Number.isSafeInteger(totalAmount) && totalAmount > 0;
    const isWalletSufficient = usable && walletBalance >= totalAmount;
    return {
      paymentMethod, totalAmount, shippingFee, walletBalance: walletBalance ?? null,
      walletAmountRequired: totalAmount, isWalletSufficient,
      walletBalanceAfterPayment: isWalletSufficient ? walletBalance - totalAmount : null,
      remainingCodDue: 0, potentialCodAmount: 0, onlineAdvanceRequired: 0, onlineAmountPaid: 0,
      estimatedDeliveryDate: shipping.estimatedDeliveryDate, preview: true
    };
  }
  if (paymentMethod === "ONLINE") {
    return {
      paymentMethod: "ONLINE",
      totalAmount,
      shippingFee,
      isCODAvailable: Boolean(shipping.isCODAvailable) && orderItems.every((item) => item.codAvailable !== false),
      onlineAmountRequired: totalAmount,
      onlineAdvanceRequired: 0,
      onlineAmountPaid: 0,
      currentUnpaidBalance: totalAmount,
      codDueAfterAdvance: 0,
      remainingCodDue: 0,
      potentialCodAmount: 0,
      estimatedDeliveryDate: shipping.estimatedDeliveryDate,
      preview: true
    };
  }

  const codTerms = calculateCodTerms({ orderItems, totalAmount });
  return {
    totalAmount,
    shippingFee,
    isCODAvailable: true,
    onlineAdvanceRequired: codTerms.onlineAdvanceRequired,
    onlineAmountPaid: 0,
    currentUnpaidBalance: codTerms.remainingCodDue,
    codDueAfterAdvance: Math.max(0, totalAmount - codTerms.onlineAdvanceRequired),
    estimatedDeliveryDate: shipping.estimatedDeliveryDate,
    preview: true
  };
};

export const withCodDisplayValues = (order) => {
  const value = typeof order?.toObject === "function" ? order.toObject() : { ...order };
  return {
    ...value,
    codDueAfterRequiredAdvance: ["ONLINE", "WALLET"].includes(value.paymentMethod)
      ? 0
      : Math.max(0, Number(value.totalAmount || 0) - Number(value.onlineAdvanceRequired || 0))
  };
};
