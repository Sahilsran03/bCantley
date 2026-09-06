import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import ReturnRequest from "../models/ReturnRequest.js";
import { getFinancialIssues } from "../services/financial-analytics.service.js";

mongoose.set("autoIndex", false);
await connectDatabase();

try {
  const [orders, capturedPayments, processedRefunds] = await Promise.all([
    Order.find().select("user walletPayment paymentMethod onlineAdvanceRequired potentialCodAmount orderNumber orderStatus paymentStatus totalAmount onlineAmountPaid codAmountCollected remainingCodDue codCollectedAt codAdvancePayment refundStatus advanceAmount remainingAmount").populate("walletPayment", "user order amount direction purpose status").lean(),
    Payment.find({ status: "Captured", purpose: "COD_ADVANCE" }).select("order amount capturedAt providerPaymentId").lean(),
    ReturnRequest.find({ refundStatus: "Processed" }).select("order refundAmount updatedAt").lean()
  ]);
  const paymentsByOrder = new Map();
  for (const payment of capturedPayments) {
    const key = String(payment.order);
    if (!paymentsByOrder.has(key)) paymentsByOrder.set(key, []);
    paymentsByOrder.get(key).push(payment);
  }
  const refundsByOrder = new Map();
  for (const refund of processedRefunds) {
    const key = String(refund.order);
    refundsByOrder.set(key, (refundsByOrder.get(key) || 0) + Number(refund.refundAmount || 0));
  }
  const report = [];

  for (const order of orders) {
    const payments = paymentsByOrder.get(String(order._id)) || [];
    const capturedPaymentAmount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const reasons = getFinancialIssues(order);
    if (capturedPaymentAmount !== Number(order.onlineAmountPaid || 0)) reasons.push("Captured Payment amount disagrees with onlineAmountPaid");
    if (Number(order.onlineAmountPaid || 0) > 0 && !payments.length) reasons.push("Online amount exists without a captured Payment");
    if (capturedPaymentAmount > 0 && Number(order.onlineAmountPaid || 0) === 0) reasons.push("Captured Payment exists without an online Order amount");
    if (Number(order.codAmountCollected || 0) > 0 && !order.codCollectedAt) reasons.push("COD amount exists without codCollectedAt");
    if (order.codCollectedAt && Number(order.codAmountCollected || 0) === 0) reasons.push("codCollectedAt exists without a COD amount");
    if (order.orderStatus === "Cancelled" && Number(order.remainingCodDue || 0) > 0) reasons.push("Cancelled Order retains outstanding COD");
    if (Number(order.remainingCodDue || 0) === 0 && order.paymentStatus !== "Paid" && order.orderStatus !== "Cancelled") reasons.push("Zero balance has an unusual paymentStatus");
    if (["onlineAmountPaid", "codAmountCollected", "remainingCodDue"].some((field) => order[field] === undefined) && (order.advanceAmount !== undefined || order.remainingAmount !== undefined)) reasons.push("Legacy-only financial data");

    if (reasons.length) report.push({
      orderId: order._id, orderNumber: order.orderNumber, orderStatus: order.orderStatus, paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount, onlineAmountPaid: order.onlineAmountPaid, codAmountCollected: order.codAmountCollected,
      remainingCodDue: order.remainingCodDue, receivedComponentsTotal: Number(order.onlineAmountPaid || 0) + Number(order.codAmountCollected || 0),
      capturedPaymentAmount, paymentCapturedAt: payments.map((payment) => payment.capturedAt), codCollectedAt: order.codCollectedAt,
      refundStatus: order.refundStatus, processedRefundAmountInformational: refundsByOrder.get(String(order._id)) || 0,
      legacyAdvanceAmount: order.advanceAmount, legacyRemainingAmount: order.remainingAmount,
      mismatchReason: reasons, suggestedManualAction: "Review Order, Payment, COD collection, and refund records manually; do not auto-repair."
    });
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, count: report.length, report }, null, 2));
} finally {
  await mongoose.disconnect();
}
