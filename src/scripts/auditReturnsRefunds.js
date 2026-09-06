import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import RefundTransaction from "../models/RefundTransaction.js";
import ReturnRequest from "../models/ReturnRequest.js";
import { actualMoneyReceived, itemRefundCap } from "../services/return-refund.service.js";

mongoose.set("autoIndex", false);
await connectDatabase();
try {
  const [requests, transactions, payments] = await Promise.all([
    ReturnRequest.find().populate("order").populate("user", "name email").populate("receivedBy", "name email").populate("restockedBy", "name email").lean(),
    RefundTransaction.find().populate("processedBy", "name email").lean(),
    Payment.find({ purpose: "COD_ADVANCE" }).lean()
  ]);
  const report = requests.map((request) => {
    const order = request.order;
    const refunds = transactions.filter((item) => String(item.returnRequest) === String(request._id));
    const completed = refunds.filter((item) => item.status === "Completed");
    const razorpay = completed.filter((item) => item.method === "RAZORPAY").reduce((sum, item) => sum + item.amount, 0);
    const manual = completed.filter((item) => item.method === "MANUAL").reduce((sum, item) => sum + item.amount, 0);
    const total = razorpay + manual;
    const payment = payments.find((item) => String(item._id) === String(order?.codAdvancePayment));
    const issues = [];
    const legacy = request.type === "REFUND" || !request.selectedItemSnapshot || (request.refundStatus === "Processed" && !completed.length);
    if (request.refundStatus === "Processed" && !completed.length) issues.push("Legacy Processed status has no authoritative refund evidence");
    if (request.approvedRefundAmount != null && total > request.approvedRefundAmount) issues.push("Refund exceeds approved cap");
    if (order && total > actualMoneyReceived(order)) issues.push("Refund exceeds money received");
    if (razorpay > Number(payment?.amount || 0)) issues.push("Razorpay attribution exceeds captured Payment");
    if (order && manual > Number(order.codAmountCollected || 0)) issues.push("Manual attribution exceeds COD collected");
    if (request.status === "Completed" && request.approvedRefundAmount > total) issues.push("Completed return has refund outstanding");
    if (request.status === "Received" && (!request.inspectionStatus || !request.restockDecision)) issues.push("Received return lacks inspection decision");
    if (request.restockedQuantity > request.receivedQuantity) issues.push("Restock exceeds received quantity");
    if (request.restockedQuantity > 0 && !request.restockedAt) issues.push("Restock quantity exists without timestamp");
    if (request.type === "RETURN" && !request.selectedItemSnapshot) issues.push("Return has invalid or historical item target");
    if (request.type === "RETURN" && !order?.deliveredAt) issues.push("Return Order is missing deliveredAt");
    if (request.type === "RETURN" && order?.orderStatus !== "Delivered" && !["Received", "Completed"].includes(request.status)) issues.push("Return was created from an ineligible Order state");
    return {
      returnRequestId: request._id, orderId: order?._id, orderNumber: order?.orderNumber,
      customer: request.user, requestType: request.type, requestStatus: request.status,
      legacyRefundStatus: request.refundStatus, legacyRefundAmount: request.refundAmount,
      selectedItem: request.selectedItemSnapshot || request.orderItem, requestedQuantity: request.requestedQuantity,
      approvedQuantity: request.approvedQuantity, approvedRefundAmount: request.approvedRefundAmount,
      onlineMoneyReceived: order?.onlineAmountPaid, codMoneyCollected: order?.codAmountCollected,
      totalReceived: order ? actualMoneyReceived(order) : null, completedRazorpayRefundAmount: razorpay,
      completedManualRefundAmount: manual, totalAuthoritativeRefunded: total,
      providerRefundIds: completed.map((item) => item.providerRefundId).filter(Boolean),
      manualReferences: completed.map((item) => item.manualReference).filter(Boolean),
      refundTransactions: refunds.map((item) => ({ id: item._id, method: item.method, amount: item.amount, status: item.status, processedAt: item.processedAt, processedBy: item.processedBy })),
      receivedAt: request.receivedAt, receivedBy: request.receivedBy, completedAt: request.completedAt,
      inventory: { inspectionStatus: request.inspectionStatus, restockDecision: request.restockDecision, restockedQuantity: request.restockedQuantity, restockedAt: request.restockedAt, restockedBy: request.restockedBy },
      legacyUnverified: legacy, mismatch: issues, suggestedManualAction: issues.length ? "Review evidence and reconcile manually; do not auto-repair." : "None"
    };
  });
  const duplicateProviderIds = transactions.filter((item) => item.providerRefundId).reduce((map, item) => map.set(item.providerRefundId, (map.get(item.providerRefundId) || 0) + 1), new Map());
  const suspiciousManualReferences = transactions.filter((item) => item.manualReference).reduce((map, item) => map.set(item.manualReference, (map.get(item.manualReference) || 0) + 1), new Map());
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, duplicateProviderRefundIds: [...duplicateProviderIds].filter(([, count]) => count > 1), suspiciousDuplicateManualReferences: [...suspiciousManualReferences].filter(([, count]) => count > 1), count: report.length, report }, null, 2));
} finally { await mongoose.disconnect(); }
