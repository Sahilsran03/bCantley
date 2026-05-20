import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import ReturnRequest from "../models/ReturnRequest.js";
import { createNotification } from "../services/notification.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  validateRefundStatus,
  validateReturnRequest,
  validateReturnStatus
} from "../validators/return.validator.js";

const prePrintingStatuses = ["Pending", "Design Review", "Approved"];
const productionStatuses = ["Printing", "Quality Check", "Packing", "Shipped", "Delivered"];

const fileToProofImage = (file) => ({
  url: file.path,
  publicId: file.filename,
  originalName: file.originalname || ""
});

const ensureObjectId = (id, message = "Request not found.") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(message, 404);
  }
};

const findCustomerOrder = async (userId, orderId) => {
  ensureObjectId(orderId, "Order not found.");
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw new AppError("Order not found.", 404);
  return order;
};

const getRequestedItems = (order, orderItem) => {
  if (!orderItem) return order.items;

  const value = String(orderItem);
  const matched = order.items.filter((item, index) => {
    const itemId = item._id ? String(item._id) : "";
    return itemId === value || String(item.product) === value || String(index) === value;
  });

  return matched.length ? matched : order.items;
};

const isCustomPrinted = (item) => Boolean(item.printType || item.customNotes || item.productType);

const mentionsDamageOrWrongItem = (reason) => {
  const normalized = String(reason || "").toLowerCase();
  return ["damage", "damaged", "broken", "wrong", "incorrect", "defect", "defective"].some((term) =>
    normalized.includes(term)
  );
};

const assertRequestAllowed = (order, payload) => {
  if (payload.type === "CANCEL" && !prePrintingStatuses.includes(order.orderStatus)) {
    throw new AppError("Orders can be cancelled only before Printing starts.", 400);
  }

  if (payload.type === "RETURN" && productionStatuses.includes(order.orderStatus)) {
    const hasCustomPrintedItem = getRequestedItems(order, payload.orderItem).some(isCustomPrinted);
    if (hasCustomPrintedItem && !mentionsDamageOrWrongItem(payload.reason)) {
      throw new AppError("Custom printed products can be returned after printing only if damaged or the wrong item was sent.", 400);
    }
  }
};

const restoreOrderStock = async (order) => {
  for (const item of order.items) {
    const product = await Product.findById(item.product);
    if (!product?.variants?.length) continue;

    const variant = item.variantSku
      ? product.variants.find((entry) => entry.sku && entry.sku === item.variantSku)
      : product.variants.find(
          (entry) =>
            String(entry.size || "") === String(item.size || "") &&
            String(entry.color || "") === String(item.color || "") &&
            String(entry.material || "") === String(item.material || "") &&
            String(entry.printType || "") === String(item.printType || "") &&
            String(entry.finish || "") === String(item.finish || "")
        );

    if (variant) {
      variant.stock += Number(item.quantity || 0);
      await product.save();
    }
  }
};

const appendOrderReturnHistory = async (order, request, message) => {
  order.returnHistory.push({
    request: request._id,
    type: request.type,
    status: request.status,
    message,
    timestamp: new Date()
  });
  await order.save();
};

const populateReturnRequest = (query) =>
  query
    .populate("user", "name email phone")
    .populate("order", "orderNumber orderStatus paymentStatus paymentMethod totalAmount advanceAmount remainingAmount items shippingAddress");

const findReturnRequest = async (id) => {
  ensureObjectId(id);
  const request = await populateReturnRequest(ReturnRequest.findById(id));
  if (!request) throw new AppError("Request not found.", 404);
  return request;
};

export const createReturnRequest = asyncHandler(async (req, res) => {
  const payload = validateReturnRequest(req.body);
  const order = await findCustomerOrder(req.user._id, payload.order);
  assertRequestAllowed(order, payload);

  const activeDuplicate = await ReturnRequest.exists({
    user: req.user._id,
    order: order._id,
    type: payload.type,
    status: { $in: ["Pending", "Approved"] }
  });
  if (activeDuplicate) {
    throw new AppError("You already have an active request for this order.", 409);
  }

  const request = await ReturnRequest.create({
    user: req.user._id,
    order: order._id,
    orderItem: payload.orderItem,
    type: payload.type,
    reason: payload.reason,
    proofImages: (req.files || []).map(fileToProofImage),
    refundStatus: payload.type === "RETURN" || payload.type === "REFUND" ? "Pending" : "NotRequired"
  });

  await appendOrderReturnHistory(order, request, `${payload.type} request submitted by customer.`);

  res.status(201).json({
    success: true,
    message: "Request submitted.",
    request
  });
});

export const listMyReturnRequests = asyncHandler(async (req, res) => {
  const requests = await populateReturnRequest(ReturnRequest.find({ user: req.user._id }).sort({ createdAt: -1 }));
  res.status(200).json({ success: true, count: requests.length, requests });
});

export const getMyReturnRequestById = asyncHandler(async (req, res) => {
  ensureObjectId(req.params.id);
  const request = await populateReturnRequest(ReturnRequest.findOne({ _id: req.params.id, user: req.user._id }));
  if (!request) throw new AppError("Request not found.", 404);
  res.status(200).json({ success: true, request });
});

export const listAdminReturnRequests = asyncHandler(async (req, res) => {
  const status = String(req.query.status || "").trim();
  const type = String(req.query.type || "").trim().toUpperCase();
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;

  const requests = await populateReturnRequest(ReturnRequest.find(filter).sort({ createdAt: -1 }));
  res.status(200).json({ success: true, count: requests.length, requests });
});

export const getAdminReturnRequestById = asyncHandler(async (req, res) => {
  const request = await findReturnRequest(req.params.id);
  res.status(200).json({ success: true, request });
});

export const updateReturnRequestStatus = asyncHandler(async (req, res) => {
  const payload = validateReturnStatus(req.body);
  const request = await findReturnRequest(req.params.id);
  const order = await Order.findById(request.order?._id || request.order);
  if (!order) throw new AppError("Order not found.", 404);

  if (payload.status === "Approved" && request.type === "CANCEL") {
    assertRequestAllowed(order, { type: "CANCEL", orderItem: request.orderItem, reason: request.reason });
    if (prePrintingStatuses.includes(order.orderStatus)) {
      await restoreOrderStock(order);
    }
    order.orderStatus = "Cancelled";
    order.trackingHistory.push({
      status: "Cancelled",
      message: "Cancellation approved by Cantley.",
      timestamp: new Date()
    });
  }

  request.status = payload.status;
  request.adminNote = payload.adminNote;
  request.refundAmount = payload.refundAmount;
  if (payload.refundStatus) request.refundStatus = payload.refundStatus;
  await request.save();

  await appendOrderReturnHistory(order, request, `${request.type} request marked ${payload.status}.`);
  await createNotification({
    user: request.user?._id || request.user,
    title: "Return request updated",
    message: `Your Cantley ${request.type.toLowerCase()} request is ${payload.status}.`,
    type: "ORDER",
    link: `/returns/${request._id}`
  });

  const refreshed = await findReturnRequest(request._id);
  res.status(200).json({ success: true, request: refreshed });
});

export const updateReturnRefundStatus = asyncHandler(async (req, res) => {
  const payload = validateRefundStatus(req.body);
  const request = await findReturnRequest(req.params.id);

  request.refundStatus = payload.refundStatus;
  if (payload.refundAmount !== undefined) request.refundAmount = payload.refundAmount;
  if (payload.adminNote) request.adminNote = payload.adminNote;
  await request.save();

  await createNotification({
    user: request.user?._id || request.user,
    title: "Refund status updated",
    message: `Your Cantley refund status is ${request.refundStatus}.`,
    type: "ORDER",
    link: `/returns/${request._id}`
  });

  const refreshed = await findReturnRequest(request._id);
  res.status(200).json({ success: true, request: refreshed });
});
