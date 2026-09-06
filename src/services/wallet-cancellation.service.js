import mongoose from "mongoose";
import crypto from "node:crypto";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import ReturnRequest from "../models/ReturnRequest.js";
import RefundTransaction from "../models/RefundTransaction.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { creditWallet } from "./wallet.service.js";
import { CANCELLABLE_ORDER_STATUSES } from "./order-status.service.js";
import { AppError } from "../utils/appError.js";

const id = (value) => String(value?._id || value || "");
const same = (a, b) => id(a) === id(b);
const reconcile = (detail) => new AppError(`${detail} Manual wallet reconciliation is required.`, 409);
const assertId = (value) => { if (!mongoose.Types.ObjectId.isValid(value)) throw new AppError("A valid record ID is required.", 400); };
const keyFor = (order) => `wallet-order-refund:${id(order)}:cancellation`;
export const assertWalletReturnSupported = (order) => {
  if (order?.paymentMethod === "WALLET") throw reconcile("Wallet item returns and manual/provider refunds are not supported yet.");
};
export const validateWalletOrderDebit = (order, debit) => {
  if (order.paymentMethod !== "WALLET" || order.paymentStatus !== "Paid" || !order.walletPayment ||
      !debit || !same(debit._id, order.walletPayment) || !same(debit.user, order.user) || !same(debit.order, order._id) ||
      debit.purpose !== "ORDER_PAYMENT" || debit.direction !== "DEBIT" || debit.status !== "POSTED" || debit.currency !== "INR" || debit.refund || debit.reward || debit.reversalOf ||
      !Number.isSafeInteger(debit.amount) || debit.amount <= 0 || !Number.isSafeInteger(debit.amount * 100) || debit.amount !== order.totalAmount ||
      !Number.isSafeInteger(debit.balanceBefore) || !Number.isSafeInteger(debit.balanceAfter) || debit.balanceAfter < 0 ||
      debit.balanceBefore - debit.amount !== debit.balanceAfter || order.onlinePayment || order.codAdvancePayment ||
      ["onlineAmountPaid", "onlineAdvanceRequired", "remainingCodDue", "potentialCodAmount", "codAmountCollected"].some((field) => order[field] !== 0)) {
    throw reconcile("Original Wallet payment attribution is missing or inconsistent.");
  }
  return debit.amount;
};

export const createWalletCancellationService = ({ OrderModel = Order, ProductModel = Product, RequestModel = ReturnRequest,
  RefundModel = RefundTransaction, LedgerModel = WalletTransaction, credit = creditWallet, startSession = () => mongoose.startSession() } = {}) => {
  const boundary = async (work) => {
    const session = await startSession(); let result;
    try { await session.withTransaction(async () => { result = await work(session); }); return result; }
    finally { await session.endSession(); }
  };
  const loadOrder = async (orderId, session) => {
    const order = await OrderModel.findById(orderId).session(session);
    if (!order) throw new AppError("Order not found.", 404);
    if (order.paymentMethod !== "WALLET") throw reconcile("This is not a Wallet Order.");
    return order;
  };
  const eligibility = (order) => {
    if (!CANCELLABLE_ORDER_STATUSES.includes(order.orderStatus)) throw new AppError("Orders can be cancelled only before Printing starts.", 409);
    if (order.paymentStatus !== "Paid" || order.inventoryStatus !== "Committed") throw reconcile("Wallet Order is not Paid and Committed.");
  };
  const restock = async (order, session) => {
    if (!order.items?.length) throw reconcile("Order inventory attribution is missing.");
    for (const item of order.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw reconcile("Order quantity is invalid.");
      const product = await ProductModel.findById(item.product).session(session);
      if (!product) throw reconcile("Original inventory product is missing.");
      // Part 4B deducts stock only from variants; a non-variant item has nothing to restore.
      if (!product.variants.length) {
        if (item.variantSku) throw reconcile("Original inventory variant is missing.");
        continue;
      }
      const variants = product.variants.filter((variant) => item.variantSku ? variant.sku === item.variantSku :
        ["size", "color", "material", "printType", "finish"].every((field) => String(variant[field] || "") === String(item[field] || "")));
      if (variants.length !== 1 || !Number.isSafeInteger(variants[0].stock) || variants[0].stock < 0 ||
          !Number.isSafeInteger(variants[0].stock + item.quantity)) throw reconcile("Original inventory variant requires exact attribution.");
      variants[0].stock += item.quantity;
      await product.save({ session });
    }
    // Existing cancellation semantics retain soldCount. Do not introduce Wallet-only sales corrections.
  };
  const refundHistory = async (order, debit, session) => {
    const entries = await LedgerModel.find({ order: order._id }).session(session);
    const evidence = await RefundModel.find({ order: order._id }).session(session);
    if (entries.some((entry) => entry.purpose === "ORDER_PAYMENT" && !same(entry._id, debit._id))) throw reconcile("Unexpected additional Wallet payment debits.");
    const credits = entries.filter((entry) => entry.purpose === "ORDER_REFUND");
    if (entries.some((entry) => entry.purpose === "REVERSAL")) throw reconcile("Wallet reversal history needs review before cancellation.");
    let refunded = 0;
    for (const entry of credits) {
      const record = evidence.find((row) => same(row._id, entry.refund));
      if (!record || record.method !== "WALLET" || record.status !== "Completed" || !same(record.walletPayment, debit._id) ||
          !same(record.walletTransaction, entry._id) || record.idempotencyKey !== entry.idempotencyKey || record.amount !== entry.amount || record.amountPaise !== entry.amount * 100 ||
          record.currency !== "INR" || entry.currency !== "INR" || !same(entry.user, order.user) ||
          entry.direction !== "CREDIT" || entry.status !== "POSTED" || !Number.isSafeInteger(entry.amount) || entry.amount <= 0 ||
          !Number.isSafeInteger(entry.balanceBefore) || !Number.isSafeInteger(entry.balanceAfter) || entry.balanceBefore < 0 ||
          entry.balanceAfter !== entry.balanceBefore + entry.amount || entry.reward || entry.reversalOf || record.payment || record.providerRefundId || record.manualMethod || record.manualReference || !["CANCELLATION", "RETURN"].includes(record.walletRefundKind)) {
        throw reconcile("Wallet refund ledger and evidence disagree.");
      }
      refunded += entry.amount;
    }
    if (!Number.isSafeInteger(refunded) || refunded > debit.amount ||
        evidence.some((record) => record.status === "Completed" && !credits.some((entry) => same(entry.refund, record._id)))) {
      throw reconcile("Wallet refund totals or evidence are inconsistent.");
    }
    const cancellation = evidence.filter((record) => record.idempotencyKey === keyFor(order._id) || record.walletRefundKind === "CANCELLATION");
    if (cancellation.length > 1) throw reconcile("Duplicate cancellation evidence.");
    return { refunded, cancellation: cancellation[0], credits };
  };
  const markRequests = async (order, requests, refund, now, adminNote, session) => {
    for (const request of requests) {
      if (!same(request.user, order.user) || !same(request.order, order._id)) throw reconcile("Cancellation request ownership is inconsistent.");
      if (request.status === "Approved") {
        if (request.refundStatus !== "Processed" || request.refundAmount !== refund.amount) throw reconcile("Cancellation request and refund disagree.");
        continue;
      }
      if (request.status !== "Pending") throw reconcile("Cancellation request status is inconsistent.");
      request.status = "Approved"; request.refundStatus = "Processed";
      request.refundAmount = refund.amount; request.approvedRefundAmount = refund.amount; request.approvedRefundAmountPaise = refund.amountPaise;
      request.approvedAt = now; request.completedAt = now; request.adminNote = adminNote;
      await request.save({ session });
      order.returnHistory.push({ request: request._id, type: "CANCEL", status: "Approved", message: "Cancellation approved; Wallet amount restored.", timestamp: now });
    }
  };
  const finalize = async ({ orderId, adminId, requestId, adminNote = "", now = new Date() }) => {
    assertId(orderId); assertId(adminId); if (requestId) assertId(requestId);
    return boundary(async (session) => {
      const order = await loadOrder(orderId, session);
      const debit = order.walletPayment ? await LedgerModel.findById(order.walletPayment).session(session) : null;
      validateWalletOrderDebit(order, debit);
      const requests = await RequestModel.find({ order: order._id, type: "CANCEL", status: { $in: ["Pending", "Approved"] } }).session(session);
      if (requests.length > 1) throw reconcile("Multiple active cancellation requests require review.");
      if (requests.some((request) => !same(request.user, order.user) || !same(request.order, order._id))) {
        throw reconcile("Cancellation request ownership is inconsistent.");
      }
      if (requestId && !requests.some((request) => same(request._id, requestId))) throw new AppError("Cancellation request is not eligible for approval.", 409);
      const history = await refundHistory(order, debit, session);
      if (order.orderStatus === "Cancelled") {
        const record = history.cancellation;
        if (!record || record.status !== "Completed" || record.walletRefundKind !== "CANCELLATION" || !same(record.returnRequest, requests[0]?._id) || record.idempotencyKey !== keyFor(order._id) || history.refunded !== debit.amount ||
            order.inventoryStatus !== "Restocked" || order.refundStatus !== "Refunded" ||
            !history.credits.some((entry) => same(entry._id, record.walletTransaction)) || requests.some((request) => request.status !== "Approved" || request.refundStatus !== "Processed" || request.refundAmount !== record.amount || request.approvedRefundAmount !== record.amount || request.approvedRefundAmountPaise !== record.amountPaise)) {
          throw reconcile("Cancelled Order and Wallet refund state disagree.");
        }
        return { order, changed: false, walletRefund: { amount: record.amount, status: "Completed" } };
      }
      eligibility(order);
      if (history.cancellation || history.refunded >= debit.amount || requests.some((request) => request.status !== "Pending")) throw reconcile("Active Order already has terminal refund evidence.");
      if (history.refunded === 0 ? !["None", "Requested"].includes(order.refundStatus) : order.refundStatus !== "PartiallyRefunded") throw reconcile("Order refund status disagrees with ledger history.");
      const amount = debit.amount - history.refunded;
      const refundId = new mongoose.Types.ObjectId();
      const key = keyFor(order._id);
      const posting = await credit({ userId: order.user, amount, purpose: "ORDER_REFUND", orderId: order._id,
        refundId, idempotencyKey: key, session });
      if (!posting.posted) throw reconcile("An unexpected cancellation credit already exists.");
      const [refund] = await RefundModel.create([{
        _id: refundId, order: order._id, returnRequest: requestId || requests[0]?._id || null, method: "WALLET",
        walletPayment: debit._id, walletTransaction: posting.transaction._id, walletRefundKind: "CANCELLATION",
        amount, amountPaise: amount * 100, currency: "INR", status: "Completed", processedAt: now, processedBy: adminId,
        idempotencyKey: key, operationFingerprint: crypto.createHash("sha256").update(`${id(order._id)}:${id(order.user)}:${id(debit._id)}:${amount}:CANCELLATION`).digest("hex")
      }], { session });
      await restock(order, session);
      order.orderStatus = "Cancelled"; order.inventoryStatus = "Restocked"; order.refundStatus = "Refunded";
      order.trackingHistory.push({ status: "Cancelled", message: `Order cancelled. Rs. ${amount} restored to Wallet.`, timestamp: now });
      await markRequests(order, requests, refund, now, adminNote, session);
      await order.save({ session });
      return { order, changed: true, walletRefund: { amount, status: "Completed" } };
    });
  };
  const requestCancellation = async ({ orderId, userId, reason, proofImages = [], now = new Date() }) => {
    assertId(orderId); assertId(userId);
    return boundary(async (session) => {
      const order = await loadOrder(orderId, session);
      if (!same(order.user, userId)) throw new AppError("Order not found.", 404);
      eligibility(order);
      const requests = await RequestModel.find({ order: order._id, type: "CANCEL", status: { $in: ["Pending", "Approved"] } }).session(session);
      if (requests.length) throw new AppError("You already have an active cancellation request for this order.", 409);
      const [request] = await RequestModel.create([{ user: order.user, order: order._id, type: "CANCEL", reason, proofImages,
        status: "Pending", refundStatus: "Pending" }], { session });
      order.returnHistory.push({ request: request._id, type: "CANCEL", status: "Pending", message: "CANCEL request submitted by customer; awaiting approval.", timestamp: now });
      await order.save({ session });
      return request;
    });
  };
  const rejectRequest = async ({ orderId, requestId, adminId, adminNote = "", now = new Date() }) => {
    assertId(orderId); assertId(requestId); assertId(adminId);
    return boundary(async (session) => {
      const order = await loadOrder(orderId, session);
      const request = await RequestModel.findById(requestId).session(session);
      if (!request || request.type !== "CANCEL" || !same(request.order, orderId) || !same(request.user, order.user)) throw new AppError("Request not found.", 404);
      if (request.status === "Rejected") return { order, changed: false };
      if (request.status !== "Pending" || order.orderStatus === "Cancelled") throw new AppError("Cancellation request is no longer pending.", 409);
      request.status = "Rejected"; request.refundStatus = "NotRequired"; request.rejectedAt = now; request.adminNote = adminNote;
      await request.save({ session });
      order.returnHistory.push({ request: request._id, type: "CANCEL", status: "Rejected", message: "Cancellation request rejected; Order remains active.", timestamp: now });
      await order.save({ session });
      return { order, changed: true };
    });
  };
  return { finalize, requestCancellation, rejectRequest };
};
const service = createWalletCancellationService();
export const finalizeWalletCancellation = service.finalize;
export const requestWalletCancellation = service.requestCancellation;
export const rejectWalletCancellation = service.rejectRequest;
