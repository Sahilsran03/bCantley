import { AppError } from "../utils/appError.js";
import { CANONICAL_ORDER_STATUSES } from "../services/order-status.service.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9+\-\s()]{7,20}$/;

const text = (value) => String(value || "").trim();
const paymentMethod = (value) => {
  const method = value === undefined ? "COD" : value;
  if (!["COD", "ONLINE", "WALLET"].includes(method)) throw new AppError("Invalid payment method.", 400);
  return method;
};

export const validateCheckoutInput = (body) => {
  const shippingAddress = body.shippingAddress || {};
  const payload = {
    shippingAddress: {
      fullName: text(shippingAddress.fullName),
      phone: text(shippingAddress.phone),
      email: text(shippingAddress.email).toLowerCase(),
      addressLine1: text(shippingAddress.addressLine1),
      addressLine2: text(shippingAddress.addressLine2),
      city: text(shippingAddress.city),
      state: text(shippingAddress.state),
      country: text(shippingAddress.country) || "India",
      postalCode: text(shippingAddress.postalCode)
    },
    paymentMethod: paymentMethod(body.paymentMethod),
    couponCode: text(body.couponCode).toUpperCase(),
    notes: text(body.notes),
    expectedCartVersion: Number(body.expectedCartVersion)
  };

  const requiredFields = ["fullName", "phone", "email", "addressLine1", "city", "state", "country", "postalCode"];
  const missingField = requiredFields.find((field) => !payload.shippingAddress[field]);

  if (missingField) {
    throw new AppError("Please complete all required shipping fields.", 400);
  }

  if (!emailPattern.test(payload.shippingAddress.email)) {
    throw new AppError("Please provide a valid email address.", 400);
  }

  if (!phonePattern.test(payload.shippingAddress.phone)) {
    throw new AppError("Please provide a valid phone number.", 400);
  }

  if (!Number.isInteger(payload.expectedCartVersion) || payload.expectedCartVersion < 1) {
    throw new AppError("A valid cart version is required.", 400);
  }

  return payload;
};

export const validateCheckoutPreviewInput = (body = {}) => {
  const postalCode = text(body.postalCode);
  const expectedCartVersion = Number(body.expectedCartVersion);
  if (!postalCode) throw new AppError("Postal code is required for checkout preview.", 400);
  if (!Number.isInteger(expectedCartVersion) || expectedCartVersion < 1) {
    throw new AppError("A valid cart version is required.", 400);
  }
  return {
    paymentMethod: paymentMethod(body.paymentMethod),
    postalCode,
    country: text(body.country) || "India",
    couponCode: text(body.couponCode).toUpperCase(),
    expectedCartVersion
  };
};

export const validateOrderStatus = (body) => {
  const orderStatus = text(body.orderStatus);

  if (!CANONICAL_ORDER_STATUSES.includes(orderStatus)) {
    throw new AppError("Invalid order status.", 400);
  }

  return { orderStatus };
};

export const validateCodCollection = (body = {}) => {
  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    throw new AppError("COD collection amount must be a positive whole-INR number.", 400);
  }
  return { amount };
};
