import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();

export const returnTypes = ["CANCEL", "RETURN", "REFUND"];
export const returnStatuses = ["Pending", "Approved", "Rejected", "Completed"];
export const refundStatuses = ["NotRequired", "Pending", "Processed", "Failed"];

export const validateReturnRequest = (body) => {
  const payload = {
    order: text(body.order || body.orderId),
    orderItem: text(body.orderItem || body.orderItemId) || null,
    type: text(body.type).toUpperCase(),
    reason: text(body.reason)
  };

  if (!payload.order) {
    throw new AppError("Order is required.", 400);
  }
  if (!returnTypes.includes(payload.type)) {
    throw new AppError("Invalid request type.", 400);
  }
  if (!payload.reason || payload.reason.length < 8) {
    throw new AppError("Please share a clear reason with at least 8 characters.", 400);
  }

  return payload;
};

export const validateReturnStatus = (body) => {
  const status = text(body.status);
  const adminNote = text(body.adminNote);
  const refundAmount = body.refundAmount === "" || body.refundAmount === undefined ? 0 : Number(body.refundAmount);
  const refundStatus = body.refundStatus ? text(body.refundStatus) : undefined;

  if (!returnStatuses.includes(status)) {
    throw new AppError("Invalid request status.", 400);
  }
  if (!Number.isFinite(refundAmount) || refundAmount < 0) {
    throw new AppError("Refund amount must be 0 or more.", 400);
  }
  if (refundStatus && !refundStatuses.includes(refundStatus)) {
    throw new AppError("Invalid refund status.", 400);
  }

  return { status, adminNote, refundAmount, refundStatus };
};

export const validateRefundStatus = (body) => {
  const refundStatus = text(body.refundStatus);
  const adminNote = text(body.adminNote);
  const refundAmount = body.refundAmount === "" || body.refundAmount === undefined ? undefined : Number(body.refundAmount);

  if (!refundStatuses.includes(refundStatus)) {
    throw new AppError("Invalid refund status.", 400);
  }
  if (refundAmount !== undefined && (!Number.isFinite(refundAmount) || refundAmount < 0)) {
    throw new AppError("Refund amount must be 0 or more.", 400);
  }

  return { refundStatus, adminNote, refundAmount };
};
