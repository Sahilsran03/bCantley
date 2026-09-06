import mongoose from "mongoose";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import { AppError } from "../utils/appError.js";
import { env } from "../config/env.js";
import {
  assertCustomerOwnsOrder, buildRazorpayOrder, createRazorpayClient,
  toRazorpayPaise, validateRazorpayIdentifiers, verifyRazorpayPaymentSignature,
  fetchAndValidateCapturedRazorpayPayment
} from "./razorpay.service.js";
import { releaseOnlineInventoryReservation } from "./inventory-reservation.service.js";
import { settleCapturedPayment } from "./payment-settlement.service.js";

const conflict = (message) => new AppError(message, 409);
const assertOnlineOrder = (order) => {
  if (order.paymentMethod !== "ONLINE") throw conflict("This Order is not eligible for full online payment.");
  if (order.orderStatus === "Cancelled") throw conflict("Cancelled Orders cannot receive Online payment. Captured funds require reconciliation.");
};

export const assertOnlineInitiationEligible = async (order, { release = releaseOnlineInventoryReservation, now = new Date() } = {}) => {
  assertOnlineOrder(order);
  if (order.paymentStatus !== "Pending") throw conflict("This Online Order is already paid or is not pending payment.");
  if (order.inventoryStatus !== "Reserved") throw conflict("Online inventory is not reserved. Start a fresh checkout.");
  const expiresAt = order.inventoryReservationExpiresAt && new Date(order.inventoryReservationExpiresAt);
  if (!expiresAt || !Number.isFinite(expiresAt.getTime())) throw conflict("Online reservation expiry requires reconciliation.");
  if (expiresAt <= now) {
    await release({ orderId: order._id, now });
    throw conflict("Online reservation expired. Start a fresh checkout.");
  }
  toRazorpayPaise(order.totalAmount);
  if (order.remainingCodDue !== 0 || order.potentialCodAmount !== 0 ||
      order.onlineAdvanceRequired !== 0 || order.onlineAmountPaid !== 0 ||
      order.codAmountCollected !== 0 || order.onlinePayment) {
    throw conflict("Online Order financial state requires reconciliation.");
  }
};

const assertPaymentAttribution = (payment, order, userId) => {
  if (!payment || payment.provider !== "razorpay" || payment.purpose !== "FULL_ONLINE" ||
      String(payment.order) !== String(order._id) || String(payment.user) !== String(userId)) {
    throw new AppError("Online Payment attempt not found.", 404);
  }
  if (payment.amount !== order.totalAmount || payment.currency !== "INR") {
    throw conflict("Online Payment amount or currency requires reconciliation.");
  }
};

const initiatedResponse = (order, payment) => ({
  success: true, status: "PAYMENT_INITIATED", keyId: env.razorpayKeyId,
  razorpayOrderId: payment.providerOrderId, paymentId: String(payment._id),
  amount: payment.amount, currency: payment.currency, cantleyOrderId: String(order._id)
});

export const createOnlinePaymentService = ({
  OrderModel = Order, PaymentModel = Payment, clientFactory = createRazorpayClient,
  release = releaseOnlineInventoryReservation,
  fetchCaptured = fetchAndValidateCapturedRazorpayPayment,
  verifySignature = verifyRazorpayPaymentSignature,
  settle = settleCapturedPayment
} = {}) => {
  const loadOwnedOrder = async (orderId, userId) => {
    if (!mongoose.Types.ObjectId.isValid(orderId)) throw new AppError("Order not found.", 404);
    const order = await OrderModel.findOne({ _id: orderId, user: userId });
    assertCustomerOwnsOrder(order, userId);
    return order;
  };
  const reuse = async (payment, order, userId) => {
    order = await loadOwnedOrder(order._id, userId);
    await assertOnlineInitiationEligible(order, { release });
    assertPaymentAttribution(payment, order, userId);
    if (!payment.providerOrderId) throw conflict("Online payment initialization is in progress or uncertain. Please retry later; unresolved attempts require reconciliation.");
    if (!["Created", "Pending", "Authorized", "Failed"].includes(payment.status) || payment.providerPaymentId) {
      throw conflict("Online Payment state requires reconciliation.");
    }
    // A failed individual payment/dismissed popup does not invalidate its provider Order.
    return initiatedResponse(order, payment);
  };
  const initiate = async ({ orderId, userId }) => {
    let order = await loadOwnedOrder(orderId, userId);
    await assertOnlineInitiationEligible(order, { release });
    if (await PaymentModel.findOne({ order: order._id, provider: "razorpay", purpose: "FULL_ONLINE", status: "Captured" })) {
      throw conflict("A captured Online Payment already exists. Reconciliation is required.");
    }
    const onlineAttemptKey = `full-online:${order._id}`;
    let payment = await PaymentModel.findOne({ onlineAttemptKey });
    if (payment) return reuse(payment, order, userId);
    const client = clientFactory();
    try {
      payment = await PaymentModel.create({
        user: userId, order: order._id, provider: "razorpay", purpose: "FULL_ONLINE",
        amount: order.totalAmount, currency: "INR", status: "Created", onlineAttemptKey
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      payment = await PaymentModel.findOne({ onlineAttemptKey });
      if (!payment) throw error;
      order = await loadOwnedOrder(orderId, userId);
      await assertOnlineInitiationEligible(order, { release });
      return reuse(payment, order, userId);
    }
    // Recheck after claiming the unique attempt before the external side effect.
    try {
      order = await loadOwnedOrder(orderId, userId);
      await assertOnlineInitiationEligible(order, { release });
      assertPaymentAttribution(payment, order, userId);
    } catch (error) {
      // No provider call occurred, so this claim can safely be retried.
      payment.status = "Failed";
      payment.failedAt = new Date();
      payment.onlineAttemptKey = null;
      payment.failureReason = "Online initiation stopped before contacting the provider.";
      await payment.save();
      throw error;
    }
    let providerOrder;
    try {
      providerOrder = await client.orders.create(buildRazorpayOrder({ order, payment }));
    } catch (error) {
      // Only a definitive provider rejection permits creating another provider Order.
      // A timeout/5xx may have created one: retain the unique claim for reconciliation.
      const rejected = error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429;
      payment.failureReason = rejected ? "Provider rejected Online Order creation." : "Online provider Order creation outcome is uncertain; reconciliation required.";
      if (rejected) { payment.status = "Failed"; payment.failedAt = new Date(); payment.onlineAttemptKey = null; }
      await payment.save();
      throw new AppError(payment.failureReason, 502);
    }
    if (typeof providerOrder?.id !== "string" || !providerOrder.id ||
        providerOrder.amount !== toRazorpayPaise(payment.amount) || providerOrder.currency !== "INR") {
      throw conflict("Online provider Order response requires reconciliation.");
    }
    payment.providerOrderId = providerOrder.id;
    payment.status = "Pending";
    await payment.save();
    order = await loadOwnedOrder(orderId, userId);
    await assertOnlineInitiationEligible(order, { release });
    assertPaymentAttribution(payment, order, userId);
    return initiatedResponse(order, payment);
  };

  const verify = async ({ orderId, userId, body }) => {
    const fields = ["razorpay_payment_id", "razorpay_order_id", "razorpay_signature"];
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !fields.includes(key)) ||
        fields.some((key) => typeof body[key] !== "string")) {
      throw new AppError("Only Razorpay callback identifiers are accepted.", 400);
    }
    const identifiers = validateRazorpayIdentifiers(body);
    const order = await loadOwnedOrder(orderId, userId);
    assertOnlineOrder(order);
    const payment = await PaymentModel.findOne({
      user: userId, order: order._id, provider: "razorpay", purpose: "FULL_ONLINE",
      providerOrderId: identifiers.razorpay_order_id
    });
    assertPaymentAttribution(payment, order, userId);
    if (payment.providerPaymentId && payment.providerPaymentId !== identifiers.razorpay_payment_id) {
      throw conflict("Payment details do not match this Online attempt.");
    }
    if (!verifySignature({ providerOrderId: payment.providerOrderId,
      providerPaymentId: identifiers.razorpay_payment_id, signature: identifiers.razorpay_signature })) {
      throw new AppError("Payment signature verification failed.", 400);
    }
    await fetchCaptured({ providerPaymentId: identifiers.razorpay_payment_id, payment });
    // Do not release on callback or directly change finances: the existing transactional
    // settlement/release boundary decides the capture-vs-release race.
    const result = await settle({ payment, providerPaymentId: identifiers.razorpay_payment_id,
      providerSignature: identifiers.razorpay_signature });
    return {
      success: true, status: "PAYMENT_CONFIRMED", orderId: String(result.order._id),
      paymentId: String(result.payment._id), paymentMethod: result.order.paymentMethod,
      paymentStatus: result.order.paymentStatus, inventoryStatus: result.order.inventoryStatus,
      onlineAmountPaid: result.order.onlineAmountPaid, remainingCodDue: result.order.remainingCodDue
    };
  };
  return { initiate, verify };
};
