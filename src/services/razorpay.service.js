import Razorpay from "razorpay";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../utils/appError.js";

export const toRazorpayPaise = (amountInr) => {
  if (!Number.isInteger(amountInr) || amountInr < 1) {
    throw new AppError("A positive whole-INR payment amount is required.", 400);
  }

  const paise = amountInr * 100;
  if (!Number.isSafeInteger(paise) || paise < 1) {
    throw new AppError("Payment amount is invalid.", 400);
  }

  return paise;
};

export const createRazorpayClient = () => {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    throw new AppError("Online advance payments are not configured yet.", 503);
  }

  return new Razorpay({
    key_id: env.razorpayKeyId,
    key_secret: env.razorpayKeySecret
  });
};

export const buildRazorpayOrder = ({ order, payment, purpose = payment.purpose }) => ({
  amount: toRazorpayPaise(payment.amount),
  currency: "INR",
  receipt: `cnt-${String(order._id).slice(-10)}-${String(payment._id).slice(-10)}`,
  notes: {
    cantley_order_id: String(order._id),
    cantley_payment_id: String(payment._id),
    purpose
  }
});

export const buildCodAdvanceRazorpayOrder = ({ order, payment }) => buildRazorpayOrder({ order, payment, purpose: "COD_ADVANCE" });

export const assertCustomerOwnsOrder = (order, userId) => {
  if (!order || String(order.user) !== String(userId)) {
    throw new AppError("Order not found.", 404);
  }
};

export const validateCodAdvanceEligibility = (order, capturedPayments = []) => {
  if (!order || String(order.paymentMethod) !== "COD") {
    throw new AppError("This order is not eligible for a COD advance payment.", 409);
  }
  if (order.orderStatus === "Cancelled") {
    throw new AppError("Cancelled orders cannot start an advance payment.", 409);
  }

  const required = Number(order.onlineAdvanceRequired || 0);
  const total = Number(order.totalAmount || 0);
  const paid = Number(order.onlineAmountPaid || 0);
  const capturedTotal = capturedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  if (!Number.isInteger(required) || required < 1 || required > total) {
    throw new AppError("This order does not have a valid online advance requirement.", 409);
  }
  if (paid >= required || capturedTotal >= required) {
    throw new AppError("The required online advance has already been paid.", 409);
  }

  return required;
};

export const validateRazorpayIdentifiers = (body = {}) => {
  const identifiers = ["razorpay_payment_id", "razorpay_order_id", "razorpay_signature"];
  const payload = Object.fromEntries(identifiers.map((key) => [key, String(body[key] || "").trim()]));
  if (identifiers.some((key) => !payload[key] || payload[key].length > 256)) {
    throw new AppError("Valid Razorpay payment identifiers are required.", 400);
  }
  return payload;
};

export const verifyRazorpayPaymentSignature = ({ providerOrderId, providerPaymentId, signature }) => {
  const expected = crypto
    .createHmac("sha256", env.razorpayKeySecret)
    .update(`${providerOrderId}|${providerPaymentId}`)
    .digest("hex");
  const received = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return received.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, received);
};

export const verifyRazorpayWebhookSignature = ({ rawBody, signature }) => {
  if (!env.razorpayWebhookSecret) {
    throw new AppError("Razorpay webhook processing is not configured.", 503);
  }
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string") return false;

  const expected = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(rawBody).digest("hex");
  const received = Buffer.from(signature.trim(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return received.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, received);
};

export const fetchAndValidateCapturedRazorpayPayment = async ({ providerPaymentId, payment }) => {
  let providerPayment;
  try {
    providerPayment = await createRazorpayClient().payments.fetch(providerPaymentId);
  } catch {
    throw new AppError("Unable to confirm the payment provider status. Please try again.", 502);
  }

  validateFetchedRazorpayPayment({ providerPaymentId, providerPayment, payment });
  return providerPayment;
};

export const validateFetchedRazorpayPayment = ({ providerPaymentId, providerPayment, payment }) => {
  if (providerPayment?.id !== providerPaymentId) {
    throw new AppError("The payment details do not match this advance payment.", 409);
  }
  validateCapturedRazorpayPayment({ providerPayment, payment });
};

export const validateCapturedRazorpayPayment = ({ providerPayment, payment }) => {
  if (
    providerPayment?.order_id !== payment.providerOrderId ||
    providerPayment?.amount !== toRazorpayPaise(payment.amount) ||
    providerPayment?.currency !== "INR"
  ) {
    throw new AppError("The payment details do not match this advance payment.", 409);
  }
  if (providerPayment.status !== "captured") {
    throw new AppError("Payment is still being processed. Please try again shortly.", 409);
  }
};
