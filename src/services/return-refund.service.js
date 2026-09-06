import mongoose from "mongoose";
import { assertWalletReturnSupported } from "./wallet-cancellation.service.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import RefundTransaction from "../models/RefundTransaction.js";
import ReturnRequest from "../models/ReturnRequest.js";
import { AppError } from "../utils/appError.js";
import { buildRefundOperationFingerprint, inrToPaise, paiseToInr, quantityEntitlementPaise } from "../utils/refundMoney.js";

export const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const reconciliationError = (detail) => new AppError(`${detail} Manual reconciliation is required.`, 409);

export const canonicalFinancePaise = (order) => {
  const fields = ["totalAmount", "onlineAmountPaid", "codAmountCollected", "remainingCodDue"];
  const values = {};
  for (const field of fields) {
    if (order?.[field] === undefined || order?.[field] === null || order?.[field] === "") {
      throw reconciliationError(`Order financial field ${field} is missing.`);
    }
    try { values[field] = inrToPaise(order[field], field); }
    catch { throw reconciliationError(`Order financial field ${field} is invalid.`); }
  }
  return values;
};

export const actualMoneyReceivedPaise = (order) => {
  const finance = canonicalFinancePaise(order);
  return finance.onlineAmountPaid + finance.codAmountCollected;
};
export const actualMoneyReceived = (order) => paiseToInr(actualMoneyReceivedPaise(order));

export const itemRefundCapPaise = (snapshot, quantity) => {
  if (!Number.isSafeInteger(snapshot?.refundableLineAmountPaise)) {
    if (Number(quantity || 0) === 0) return 0;
    throw reconciliationError("This historical order has no authoritative post-discount item allocation.");
  }
  return quantityEntitlementPaise({
    lineAmountPaise: snapshot.refundableLineAmountPaise,
    originalQuantity: snapshot.originalQuantity,
    startQuantity: snapshot.quantityEntitlementStart || 0,
    quantity
  });
};
export const itemRefundCap = (snapshot, quantity) => paiseToInr(itemRefundCapPaise(snapshot, quantity));

export const assertReturnEligibility = (order, now = new Date()) => {
  assertWalletReturnSupported(order);
  if (order.orderStatus !== "Delivered") throw new AppError("Returns are available only after delivery.", 409);
  if (!order.deliveredAt || !Number.isFinite(new Date(order.deliveredAt).getTime())) throw reconciliationError("Delivery date is missing or invalid.");
  const finance = canonicalFinancePaise(order);
  if (finance.remainingCodDue !== 0) throw new AppError("This order still has an outstanding COD balance.", 409);
  if (finance.onlineAmountPaid + finance.codAmountCollected < finance.totalAmount) throw new AppError("This order is not fully paid.", 409);
  if (now.getTime() > new Date(order.deliveredAt).getTime() + RETURN_WINDOW_MS) throw new AppError("The 7-day return window has expired.", 409);
};

export const snapshotOrderItem = (order, index) => {
  const item = order.items?.[index];
  if (!item) throw new AppError("The selected order item is invalid.", 400);
  return {
    orderItemIndex: index, product: item.product, name: item.name, productType: item.productType,
    variantSku: item.variantSku || "", size: item.size || "", color: item.color || "",
    material: item.material || "", printType: item.printType || "", finish: item.finish || "",
    shape: item.shape || "", width: item.width ?? null, height: item.height ?? null,
    unit: item.unit || "", waterproof: Boolean(item.waterproof), finalPrice: Number(item.finalPrice || 0),
    originalQuantity: Number(item.quantity || 0),
    refundableLineAmountPaise: item.refundableLineAmountPaise,
    refundableUnitBasePaise: item.refundableUnitBasePaise,
    refundableUnitRemainderPaise: item.refundableUnitRemainderPaise,
    quantityEntitlementStart: 0
  };
};

export const deriveRefundStatus = (approvedPaise, completedPaise, failedCount = 0) => {
  if (Number(approvedPaise || 0) === 0) return "NotRequired";
  if (Number(completedPaise || 0) >= Number(approvedPaise)) return "Processed";
  if (failedCount > 0 && Number(completedPaise || 0) === 0) return "Failed";
  return "Pending";
};

export const createCustomerReturn = async ({ userId, orderId, payload, proofImages, now = new Date() }) => {
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, user: userId }).session(session);
      if (!order) throw new AppError("Order not found.", 404);
      assertReturnEligibility(order, now);
      const existing = await ReturnRequest.aggregate([
        { $match: { order: order._id, type: "RETURN", "selectedItemSnapshot.orderItemIndex": payload.orderItemIndex, status: { $ne: "Rejected" } } },
        { $group: { _id: null, quantity: { $sum: "$requestedQuantity" } } }
      ]).session(session);
      const reserved = Number(existing[0]?.quantity || 0);
      const snapshot = snapshotOrderItem(order, payload.orderItemIndex);
      if (payload.requestedQuantity > snapshot.originalQuantity - reserved) throw new AppError("Return quantity exceeds the remaining eligible quantity.", 409);
      snapshot.quantityEntitlementStart = reserved;
      [created] = await ReturnRequest.create([{
        user: userId, order: order._id, orderItem: String(payload.orderItemIndex), type: "RETURN",
        reasonCategory: payload.reasonCategory, reason: payload.reason, proofImages,
        selectedItemSnapshot: snapshot, requestedQuantity: payload.requestedQuantity, refundStatus: "Pending"
      }], { session });
      order.returnHistory.push({ request: created._id, type: "RETURN", status: "Pending", message: "RETURN request submitted by customer.", timestamp: now });
      order.refundStatus = order.refundStatus === "None" ? "Requested" : order.refundStatus;
      await order.save({ session });
    });
  } finally { await session.endSession(); }
  return created;
};

const transactionAmountPaise = (item) => Number.isSafeInteger(item.amountPaise)
  ? item.amountPaise
  : inrToPaise(item.amount, "Historical refund amount");

export const completedRefundTotals = async ({ orderId, returnRequestId, paymentId, session }) => {
  const query = RefundTransaction.find({ order: orderId, status: "Completed" });
  if (session) query.session(session);
  const transactions = await query.lean();
  const sum = (items) => items.reduce((total, item) => total + transactionAmountPaise(item), 0);
  return {
    orderPaise: sum(transactions),
    requestPaise: sum(transactions.filter((item) => String(item.returnRequest) === String(returnRequestId))),
    razorpayPaise: sum(transactions.filter((item) => item.method === "RAZORPAY" && (!paymentId || String(item.payment) === String(paymentId)))),
    manualPaise: sum(transactions.filter((item) => item.method === "MANUAL"))
  };
};

export const deriveOrderRefundStatus = ({ completedPaise, receivedPaise, requests }) => {
  if (completedPaise > 0) return completedPaise >= receivedPaise ? "Refunded" : "PartiallyRefunded";
  if (requests.some((item) => ["Approved", "Received", "Completed"].includes(item.status) && Number(item.approvedRefundAmountPaise || 0) > 0)) return "Approved";
  if (requests.some((item) => item.status === "Pending")) return "Requested";
  return "None";
};

export const syncRefundState = async ({ order, request, session }) => {
  assertWalletReturnSupported(order);
  const transactions = await RefundTransaction.find({ returnRequest: request._id }).session(session || null);
  const completedPaise = transactions.filter((item) => item.status === "Completed").reduce((sum, item) => sum + transactionAmountPaise(item), 0);
  const failed = transactions.filter((item) => item.status === "Failed").length;
  const approvedPaise = Number.isSafeInteger(request.approvedRefundAmountPaise)
    ? request.approvedRefundAmountPaise
    : inrToPaise(request.approvedRefundAmount || 0, "Approved refund amount");
  request.refundStatus = deriveRefundStatus(approvedPaise, completedPaise, failed);
  request.refundAmount = paiseToInr(completedPaise);
  if (request.status === "Received" && request.restockDecision && (approvedPaise === 0 || completedPaise >= approvedPaise)) {
    request.status = "Completed";
    request.completedAt = request.completedAt || new Date();
  }
  const requests = await ReturnRequest.find({ order: order._id }).session(session || null).lean();
  const orderTotals = await completedRefundTotals({ orderId: order._id, returnRequestId: request._id, session });
  order.refundStatus = deriveOrderRefundStatus({ completedPaise: orderTotals.orderPaise, receivedPaise: actualMoneyReceivedPaise(order), requests: requests.map((item) => String(item._id) === String(request._id) ? { ...item, status: request.status, approvedRefundAmountPaise: approvedPaise } : item) });
  await request.save({ session });
  await order.save({ session });
  return { completedPaise, remainingPaise: Math.max(0, approvedPaise - completedPaise), transactions };
};

const fingerprintMatches = (transaction, fingerprint) => transaction.operationFingerprint === fingerprint;
const idempotencyConflict = () => new AppError("This Idempotency-Key was already used for a different refund.", 409);

const assertRazorpayPayment = (payment, order) => {
  const validCapturedAt = payment?.capturedAt && Number.isFinite(new Date(payment.capturedAt).getTime());
  if (!payment || String(payment._id) !== String(order.codAdvancePayment) || String(payment.order) !== String(order._id)
    || payment.status !== "Captured" || payment.provider !== "razorpay" || payment.purpose !== "COD_ADVANCE"
    || !String(payment.providerPaymentId || "").trim() || !validCapturedAt) {
    throw reconciliationError("Linked Razorpay payment evidence is incomplete or inconsistent.");
  }
};

export const recordCompletedRefund = async ({ requestId, adminId, payload, now = new Date() }) => {
  const session = await mongoose.startSession();
  let result;
  let fingerprint;
  try {
    await session.withTransaction(async () => {
      const request = await ReturnRequest.findById(requestId).session(session);
      if (!request) throw new AppError("Request not found.", 404);
      if (request.type !== "RETURN" || request.status !== "Received") throw new AppError("Refunds can be recorded only after a return is received.", 409);
      const order = await Order.findById(request.order).session(session);
      if (!order) throw new AppError("Order not found.", 404);
      assertWalletReturnSupported(order);
      const finance = canonicalFinancePaise(order);
      let payment = null;
      if (payload.method === "RAZORPAY") {
        payment = await Payment.findById(order.codAdvancePayment).session(session);
        assertRazorpayPayment(payment, order);
      }
      const operation = {
        returnRequest: request._id, order: order._id, method: payload.method, amountPaise: payload.amountPaise,
        payment: payment?._id || null, providerRefundId: payload.method === "RAZORPAY" ? payload.providerRefundId : null,
        manualMethod: payload.method === "MANUAL" ? payload.manualMethod : null,
        manualReference: payload.method === "MANUAL" ? payload.manualReference : null
      };
      fingerprint = buildRefundOperationFingerprint(operation);
      const duplicate = await RefundTransaction.findOne({ idempotencyKey: payload.idempotencyKey }).session(session);
      if (duplicate) {
        if (!fingerprintMatches(duplicate, fingerprint)) throw idempotencyConflict();
        result = { transaction: duplicate, duplicate: true }; return;
      }
      const totals = await completedRefundTotals({ orderId: order._id, returnRequestId: request._id, session });
      const approvedPaise = Number.isSafeInteger(request.approvedRefundAmountPaise)
        ? request.approvedRefundAmountPaise
        : (() => { throw reconciliationError("Approved refund has no authoritative paise value."); })();
      if (totals.requestPaise + payload.amountPaise > approvedPaise) throw new AppError("Refund exceeds the approved refund amount.", 409);
      if (totals.orderPaise + payload.amountPaise > finance.onlineAmountPaid + finance.codAmountCollected) throw new AppError("Refund exceeds money received for this order.", 409);
      if (payload.method === "RAZORPAY") {
        const paymentTotals = await completedRefundTotals({ orderId: order._id, returnRequestId: request._id, paymentId: payment._id, session });
        const paymentPaise = inrToPaise(payment.amount, "Captured payment amount");
        if (paymentTotals.razorpayPaise + payload.amountPaise > paymentPaise) throw new AppError("Razorpay refund exceeds the captured payment amount.", 409);
      } else if (totals.manualPaise + payload.amountPaise > finance.codAmountCollected) {
        throw new AppError("Manual refund exceeds physical COD collected.", 409);
      }
      const [transaction] = await RefundTransaction.create([{
        ...operation, amount: paiseToInr(payload.amountPaise), status: "Completed", notes: payload.notes,
        processedAt: now, processedBy: adminId, idempotencyKey: payload.idempotencyKey,
        operationFingerprint: fingerprint
      }], { session });
      await syncRefundState({ order, request, session });
      result = { transaction, duplicate: false };
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await RefundTransaction.findOne({ idempotencyKey: payload.idempotencyKey });
      if (duplicate) {
        if (!fingerprint || !fingerprintMatches(duplicate, fingerprint)) throw idempotencyConflict();
        return { transaction: duplicate, duplicate: true };
      }
      throw new AppError("This provider refund ID has already been recorded.", 409);
    }
    throw error;
  } finally { await session.endSession(); }
  return result;
};

const variantFields = ["size", "color", "material", "printType", "finish", "shape", "width", "height", "unit", "waterproof"];
const sameVariantValue = (left, right) => {
  if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "";
  return String(left) === String(right);
};

export const resolveRestockVariant = (product, snapshot) => {
  if (!product?.variants) throw reconciliationError("Returned product is unavailable for restocking.");
  if (snapshot.variantSku) {
    const matches = product.variants.filter((item) => item.sku === snapshot.variantSku);
    if (matches.length !== 1) throw reconciliationError(matches.length ? "Original SKU is ambiguous." : "Original SKU no longer exists.");
    return matches[0];
  }
  const matches = product.variants.filter((item) => variantFields.every((field) => sameVariantValue(item[field], snapshot[field])));
  if (matches.length !== 1) throw reconciliationError(matches.length ? "Variant snapshot is ambiguous." : "No variant matches the complete snapshot.");
  return matches[0];
};

export const restockReceivedItem = async ({ request, payload, adminId, session, now = new Date() }) => {
  if (payload.restockDecision !== "RESTOCK") return;
  if (payload.restockedQuantity > payload.receivedQuantity) throw new AppError("Restocked quantity cannot exceed received quantity.", 400);
  const snapshot = request.selectedItemSnapshot;
  const product = await Product.findById(snapshot.product).session(session);
  const variant = resolveRestockVariant(product, snapshot);
  const claimed = await ReturnRequest.findOneAndUpdate(
    { _id: request._id, restockedAt: null },
    { $set: { restockedQuantity: payload.restockedQuantity, restockedAt: now, restockedBy: adminId } },
    { new: true, session }
  );
  if (!claimed) throw new AppError("This return has already been restocked.", 409);
  variant.stock += payload.restockedQuantity;
  await product.save({ session });
};
