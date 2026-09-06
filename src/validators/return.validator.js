import { AppError } from "../utils/appError.js";
import { inrToPaise, paiseToInr } from "../utils/refundMoney.js";

const text = (value) => String(value ?? "").trim();
const number = (value, label, { min = 0, integer = false } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed))) {
    throw new AppError(`${label} is invalid.`, 400);
  }
  return parsed;
};

export const returnTypes = ["CANCEL", "RETURN", "REFUND"];
export const customerReturnTypes = ["CANCEL", "RETURN"];
export const returnStatuses = ["Pending", "Approved", "Received", "Rejected", "Completed"];
export const refundStatuses = ["NotRequired", "Pending", "Processed", "Failed"];
export const reasonCategories = ["DAMAGED", "WRONG_ITEM", "DEFECTIVE", "SIZE_ISSUE", "OTHER"];

export const validateReturnRequest = (body) => {
  const payload = {
    order: text(body.order || body.orderId),
    orderItemIndex: body.orderItemIndex ?? body.orderItem,
    type: text(body.type).toUpperCase(),
    reasonCategory: text(body.reasonCategory).toUpperCase(),
    reason: text(body.reason),
    requestedQuantity: body.requestedQuantity
  };
  if (!payload.order) throw new AppError("Order is required.", 400);
  if (!customerReturnTypes.includes(payload.type)) throw new AppError("Invalid request type.", 400);
  if (!payload.reason || payload.reason.length < 8 || payload.reason.length > 1200) {
    throw new AppError("Please share a clear reason with 8 to 1200 characters.", 400);
  }
  if (payload.type === "RETURN") {
    if (!reasonCategories.includes(payload.reasonCategory)) throw new AppError("A valid return reason category is required.", 400);
    payload.orderItemIndex = number(payload.orderItemIndex, "Order item", { min: 0, integer: true });
    payload.requestedQuantity = number(payload.requestedQuantity, "Return quantity", { min: 1, integer: true });
  } else {
    payload.reasonCategory = undefined;
    payload.orderItemIndex = undefined;
    payload.requestedQuantity = undefined;
  }
  return payload;
};

export const validateReturnStatus = (body) => {
  const status = text(body.status);
  const adminNote = text(body.adminNote);
  if (!returnStatuses.includes(status)) throw new AppError("Invalid request status.", 400);
  if (adminNote.length > 1200) throw new AppError("Admin note is too long.", 400);
  const payload = { status, adminNote };
  if (status === "Approved" && (body.approvedQuantity !== undefined || body.approvedRefundAmount !== undefined)) {
    payload.approvedQuantity = number(body.approvedQuantity, "Approved quantity", { min: 1, integer: true });
    payload.approvedRefundAmountPaise = inrToPaise(body.approvedRefundAmount ?? 0, "Approved refund amount");
    payload.approvedRefundAmount = paiseToInr(payload.approvedRefundAmountPaise);
  }
  return payload;
};

export const validateReturnReceipt = (body) => {
  const inspectionStatus = text(body.inspectionStatus).toUpperCase();
  const restockDecision = text(body.restockDecision).toUpperCase();
  const inspectionNote = text(body.inspectionNote);
  if (!["SELLABLE", "DAMAGED", "OTHER"].includes(inspectionStatus)) throw new AppError("A valid inspection condition is required.", 400);
  if (!["RESTOCK", "DO_NOT_RESTOCK"].includes(restockDecision)) throw new AppError("A restock decision is required.", 400);
  return {
    receivedQuantity: number(body.receivedQuantity, "Received quantity", { min: 1, integer: true }),
    inspectionStatus,
    restockDecision,
    restockedQuantity: restockDecision === "RESTOCK" ? number(body.restockedQuantity, "Restocked quantity", { min: 1, integer: true }) : 0,
    inspectionNote
  };
};

export const validateRefundTransaction = (body, idempotencyHeader) => {
  const method = text(body.method).toUpperCase();
  const providerRefundId = text(body.providerRefundId) || null;
  const manualMethod = text(body.manualMethod).toUpperCase() || null;
  const manualReference = text(body.manualReference) || null;
  const notes = text(body.notes);
  const idempotencyKey = text(idempotencyHeader || body.idempotencyKey);
  if (!["RAZORPAY", "MANUAL"].includes(method)) throw new AppError("Invalid refund method.", 400);
  if (!idempotencyKey || idempotencyKey.length > 160) throw new AppError("An Idempotency-Key is required.", 400);
  if (method === "RAZORPAY" && !providerRefundId) throw new AppError("Razorpay refund ID is required.", 400);
  if (method === "MANUAL" && !["CASH", "UPI", "BANK_TRANSFER", "OTHER"].includes(manualMethod)) throw new AppError("A valid manual refund method is required.", 400);
  if (method === "MANUAL" && manualMethod !== "CASH" && !manualReference) throw new AppError("A manual refund reference is required.", 400);
  if (method === "RAZORPAY") { manualMethod = null; manualReference = null; }
  else providerRefundId = null;
  const amountPaise = inrToPaise(body.amount, "Refund amount", { allowZero: false });
  return { method, amount: paiseToInr(amountPaise), amountPaise, providerRefundId, manualMethod, manualReference, notes, idempotencyKey };
};
