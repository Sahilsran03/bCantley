import mongoose from "mongoose";
import Order from "../models/Order.js";
import RefundTransaction from "../models/RefundTransaction.js";
import ReturnRequest from "../models/ReturnRequest.js";
import { createNotification } from "../services/notification.service.js";
import { finalizeWalletCancellation, requestWalletCancellation, rejectWalletCancellation, assertWalletReturnSupported } from "../services/wallet-cancellation.service.js";
import { transitionOrderStatus } from "../services/order-status.service.js";
import {
  actualMoneyReceivedPaise,
  completedRefundTotals,
  createCustomerReturn,
  itemRefundCapPaise,
  recordCompletedRefund,
  restockReceivedItem,
  syncRefundState
} from "../services/return-refund.service.js";
import { deleteCloudinaryAsset } from "../utils/cloudinaryCleanup.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validateRefundTransaction, validateReturnReceipt, validateReturnRequest, validateReturnStatus } from "../validators/return.validator.js";

const prePrintingStatuses = ["Pending", "Design Review", "Approved"];
const fileToProofImage = (file) => ({ url: file.path, publicId: file.filename, originalName: file.originalname || "" });
const ensureObjectId = (id, message = "Request not found.") => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(message, 404);
};
const findCustomerOrder = async (userId, orderId) => {
  ensureObjectId(orderId, "Order not found.");
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw new AppError("Order not found.", 404);
  return order;
};
const assertCancellationAllowed = (order) => {
  if (!prePrintingStatuses.includes(order.orderStatus)) throw new AppError("Orders can be cancelled only before Printing starts.", 400);
};
const appendOrderReturnHistory = async (order, request, message, session = null) => {
  order.returnHistory.push({ request: request._id, type: request.type, status: request.status, message, timestamp: new Date() });
  await order.save({ session });
};
const populateReturnRequest = (query) => query
  .populate("user", "name email phone")
  .populate("order", "orderNumber orderStatus paymentStatus paymentMethod totalAmount onlineAmountPaid codAmountCollected remainingCodDue deliveredAt items shippingAddress refundStatus")
  .populate("receivedBy", "name email")
  .populate("restockedBy", "name email");
const findReturnRequest = async (id) => {
  ensureObjectId(id);
  const request = await populateReturnRequest(ReturnRequest.findById(id));
  if (!request) throw new AppError("Request not found.", 404);
  return request;
};
const attachRefundSummary = async (request, { includeInternal = false } = {}) => {
  let query = RefundTransaction.find({ returnRequest: request._id, status: "Completed" }).sort({ processedAt: 1 });
  if (includeInternal) query = query.populate("processedBy", "name email");
  const records = await query;
  const refundTransactions = includeInternal ? records : records.map((item) => ({
    _id: item._id, method: item.method, amount: item.amount, currency: item.currency,
    status: item.status, providerRefundId: item.providerRefundId, manualMethod: item.manualMethod,
    processedAt: item.processedAt
  }));
  const completedRefundAmount = refundTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return { ...request.toObject(), refundTransactions, completedRefundAmount, remainingRefundAmount: Math.max(0, Number(request.approvedRefundAmount || 0) - completedRefundAmount) };
};

export const createReturnRequest = asyncHandler(async (req, res) => {
  const proofImages = (req.files || []).map(fileToProofImage);
  let requestCommitted = false;
  try {
    const payload = validateReturnRequest(req.body);
    const order = await findCustomerOrder(req.user._id, payload.order);
    let request;
    if (payload.type === "CANCEL") {
      assertCancellationAllowed(order);
      if (order.paymentMethod === "WALLET") {
        request = await requestWalletCancellation({ orderId: order._id, userId: req.user._id, reason: payload.reason, proofImages });
        requestCommitted = true;
      } else {
      const duplicate = await ReturnRequest.exists({ user: req.user._id, order: order._id, type: "CANCEL", status: { $in: ["Pending", "Approved"] } });
      if (duplicate) throw new AppError("You already have an active cancellation request for this order.", 409);
      request = await ReturnRequest.create({ user: req.user._id, order: order._id, type: "CANCEL", reason: payload.reason, proofImages, refundStatus: "NotRequired" });
      requestCommitted = true;
      await appendOrderReturnHistory(order, request, "CANCEL request submitted by customer.");
      }
    } else {
      if (["DAMAGED", "WRONG_ITEM", "DEFECTIVE"].includes(payload.reasonCategory) && proofImages.length === 0) throw new AppError("At least one proof image is required for this reason.", 400);
      request = await createCustomerReturn({ userId: req.user._id, orderId: order._id, payload, proofImages });
    }
    requestCommitted = true;
    await Promise.allSettled([createNotification({ user: req.user._id, title: "Return request submitted", message: `Your Cantley ${payload.type.toLowerCase()} request was submitted.`, type: "ORDER", link: `/returns/${request._id}` })]);
    res.status(201).json({ success: true, message: "Request submitted.", request });
  } catch (error) {
    if (!requestCommitted) await Promise.allSettled(proofImages.map((image) => deleteCloudinaryAsset(image.publicId, "image")));
    throw error;
  }
});

export const listMyReturnRequests = asyncHandler(async (req, res) => {
  const requests = await populateReturnRequest(ReturnRequest.find({ user: req.user._id }).sort({ createdAt: -1 }));
  res.status(200).json({ success: true, count: requests.length, requests });
});
export const getMyReturnRequestById = asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id);
  const request = await populateReturnRequest(ReturnRequest.findOne({ _id: req.params.id, user: req.user._id }));
  if (!request) throw new AppError("Request not found.", 404);
  res.status(200).json({ success: true, request: await attachRefundSummary(request) });
});
export const listAdminReturnRequests = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status).trim();
  if (req.query.type) filter.type = String(req.query.type).trim().toUpperCase();
  const requests = await populateReturnRequest(ReturnRequest.find(filter).sort({ createdAt: -1 }));
  res.status(200).json({ success: true, count: requests.length, requests });
});
export const getAdminReturnRequestById = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, request: await attachRefundSummary(await findReturnRequest(req.params.id), { includeInternal: true }) });
});

export const updateReturnRequestStatus = asyncHandler(async (req, res) => {
  const payload = validateReturnStatus(req.body);
  ensureObjectId(req.params.id);
  const currentRequest = await ReturnRequest.findById(req.params.id);
  if (!currentRequest) throw new AppError("Request not found.", 404);
  const currentOrder = await Order.findById(currentRequest.order);
  if (!currentOrder) throw new AppError("Order not found.", 404);
  if (currentOrder.paymentMethod === "WALLET") {
    if (currentRequest.type !== "CANCEL") assertWalletReturnSupported(currentOrder);
    if (!["Approved", "Rejected"].includes(payload.status)) throw new AppError("Wallet cancellation requires approval or rejection.", 409);
    const action = payload.status === "Approved" ? finalizeWalletCancellation : rejectWalletCancellation;
    const result = await action({ orderId: currentOrder._id, requestId: currentRequest._id, adminId: req.user._id, adminNote: payload.adminNote });
    const refreshed = await findReturnRequest(req.params.id);
    if (result.changed) await Promise.allSettled([createNotification({ user: currentOrder.user, type: "ORDER", link: `/orders/${currentOrder._id}`,
      title: result.walletRefund ? "Order cancelled; Wallet restored" : "Cancellation rejected",
      message: result.walletRefund ? `Order cancelled. Rs. ${result.walletRefund.amount} restored to Wallet.` : "Your cancellation request was rejected. Your Order remains active." })]);
    res.status(200).json({ success: true, changed: result.changed, order: result.order,
      ...(result.walletRefund ? { walletRefund: result.walletRefund } : {}), request: await attachRefundSummary(refreshed, { includeInternal: true }) });
    return;
  }
  let request;
  if (payload.status === "Approved" || payload.status === "Rejected") {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        request = await ReturnRequest.findById(req.params.id).session(session);
        if (!request) throw new AppError("Request not found.", 404);
        const order = await Order.findById(request.order).session(session);
        if (!order) throw new AppError("Order not found.", 404);
        if (request.type !== "RETURN" || !request.selectedItemSnapshot) throw new AppError("Legacy requests require manual reconciliation.", 409);
        if (request.status === payload.status) return;
        if (request.status !== "Pending") throw new AppError("Invalid return status transition.", 409);
        if (payload.status === "Approved") {
          if (!Number.isInteger(payload.approvedQuantity) || !Number.isSafeInteger(payload.approvedRefundAmountPaise)) throw new AppError("Approved quantity and refund amount are required.", 400);
          if (payload.approvedQuantity > request.requestedQuantity) throw new AppError("Approved quantity exceeds requested quantity.", 400);
          const capPaise = itemRefundCapPaise(request.selectedItemSnapshot, payload.approvedQuantity);
          if (payload.approvedRefundAmountPaise > capPaise) throw new AppError("Approved refund exceeds the post-discount returned item value.", 409);
          const totals = await completedRefundTotals({ orderId: order._id, returnRequestId: request._id, session });
          if (payload.approvedRefundAmountPaise > actualMoneyReceivedPaise(order) - totals.orderPaise) throw new AppError("Approved refund exceeds unrefunded money received.", 409);
          request.approvedQuantity = payload.approvedQuantity;
          request.approvedRefundAmount = payload.approvedRefundAmount;
          request.approvedRefundAmountPaise = payload.approvedRefundAmountPaise;
          request.approvedAt = new Date();
          request.refundStatus = payload.approvedRefundAmountPaise === 0 ? "NotRequired" : "Pending";
        } else {
          request.rejectedAt = new Date();
          request.refundStatus = "NotRequired";
        }
        request.status = payload.status;
        request.adminNote = payload.adminNote;
        await request.save({ session });
        await syncRefundState({ order, request, session });
        await appendOrderReturnHistory(order, request, `RETURN request marked ${payload.status}.`, session);
      });
    } finally { await session.endSession(); }
  } else {
    request = await findReturnRequest(req.params.id);
    const order = await Order.findById(request.order?._id || request.order);
    if (!order) throw new AppError("Order not found.", 404);
    if (request.type !== "CANCEL") throw new AppError("Invalid return status transition.", 409);
    if (payload.status === "Approved") {
      assertCancellationAllowed(order);
      await transitionOrderStatus({ orderId: order._id, nextStatus: "Cancelled", message: "Cancellation approved by Cantley." });
    }
    request.status = payload.status;
    request.adminNote = payload.adminNote;
    await request.save();
    await appendOrderReturnHistory(order, request, `CANCEL request marked ${payload.status}.`);
  }
  const refreshed = await findReturnRequest(req.params.id);
  await Promise.allSettled([createNotification({ user: refreshed.user?._id || refreshed.user, title: payload.status === "Approved" ? "Return approved" : payload.status === "Rejected" ? "Return rejected" : "Request updated", message: `Your Cantley ${refreshed.type.toLowerCase()} request is ${payload.status}.`, type: "ORDER", link: `/returns/${refreshed._id}` })]);
  res.status(200).json({ success: true, request: await attachRefundSummary(refreshed, { includeInternal: true }) });
});

export const receiveReturnRequest = asyncHandler(async (req, res) => {
  const payload = validateReturnReceipt(req.body);
  const session = await mongoose.startSession();
  let duplicate = false;
  try {
    await session.withTransaction(async () => {
      const request = await ReturnRequest.findById(req.params.id).session(session);
      if (!request) throw new AppError("Request not found.", 404);
      if (request.type !== "RETURN") throw new AppError("Only an approved return can be received.", 409);
      const receiptOrder = await Order.findById(request.order).session(session);
      if (!receiptOrder) throw new AppError("Order not found.", 404);
      assertWalletReturnSupported(receiptOrder);
      if (["Received", "Completed"].includes(request.status)) {
        const same = request.receivedQuantity === payload.receivedQuantity
          && request.inspectionStatus === payload.inspectionStatus
          && request.inspectionNote === payload.inspectionNote
          && request.restockDecision === payload.restockDecision
          && Number(request.restockedQuantity || 0) === payload.restockedQuantity;
        if (!same) throw new AppError("This return was already received with different inspection or restock details.", 409);
        duplicate = true;
        return;
      }
      if (request.status !== "Approved") throw new AppError("Only an approved return can be received.", 409);
      if (payload.receivedQuantity > request.approvedQuantity) throw new AppError("Received quantity exceeds approved quantity.", 400);
      request.receivedQuantity = payload.receivedQuantity;
      request.receivedAt = new Date();
      request.receivedBy = req.user._id;
      request.inspectionStatus = payload.inspectionStatus;
      request.inspectionNote = payload.inspectionNote;
      request.restockDecision = payload.restockDecision;
      request.status = "Received";
      await request.save({ session });
      await restockReceivedItem({ request, payload, adminId: req.user._id, session });
      const order = await Order.findById(request.order).session(session);
      if (!order) throw new AppError("Order not found.", 404);
      const current = await ReturnRequest.findById(request._id).session(session);
      await syncRefundState({ order, request: current, session });
      await appendOrderReturnHistory(order, current, `Return received; inventory decision: ${payload.restockDecision}.`, session);
    });
  } finally { await session.endSession(); }
  const refreshed = await findReturnRequest(req.params.id);
  if (!duplicate) {
    await Promise.allSettled([
      createNotification({ user: refreshed.user?._id || refreshed.user, title: "Return received", message: "Cantley recorded and inspected your returned item.", type: "ORDER", link: `/returns/${refreshed._id}` }),
      ...(refreshed.status === "Completed" ? [createNotification({ user: refreshed.user?._id || refreshed.user, title: "Return completed", message: "Your Cantley return is complete.", type: "ORDER", link: `/returns/${refreshed._id}` })] : [])
    ]);
  }
  res.status(200).json({ success: true, duplicate, request: await attachRefundSummary(refreshed, { includeInternal: true }) });
});

export const createReturnRefund = asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id);
  const payload = validateRefundTransaction(req.body, req.get("Idempotency-Key"));
  const result = await recordCompletedRefund({ requestId: req.params.id, adminId: req.user._id, payload });
  const request = await findReturnRequest(req.params.id);
  if (!result.duplicate) {
    await Promise.allSettled([
      createNotification({ user: request.user?._id || request.user, title: "Refund recorded", message: `Cantley recorded a completed ${payload.method === "RAZORPAY" ? "Razorpay" : "manual"} refund of Rs. ${payload.amount}.`, type: "ORDER", link: `/returns/${request._id}` }),
      ...(request.status === "Completed" ? [createNotification({ user: request.user?._id || request.user, title: "Return completed", message: "Your Cantley return and approved refund are complete.", type: "ORDER", link: `/returns/${request._id}` })] : [])
    ]);
  }
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, transaction: result.transaction, request: await attachRefundSummary(request, { includeInternal: true }) });
});

// Retained only to reject the old arbitrary financial mutation endpoint explicitly.
export const updateReturnRefundStatus = asyncHandler(async () => { throw new AppError("Refund status is derived from recorded refund transactions.", 410); });
