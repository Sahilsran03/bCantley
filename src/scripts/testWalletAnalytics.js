import assert from "node:assert/strict";
import { getFinancialIssues, summarizeOrderFinancials, getReceiptMetrics, getMoneyReceivedByDate, getOrderFinancialMetrics } from "../services/financial-analytics.service.js";
const date = new Date("2026-09-05T12:00:00Z");
const order = { _id: "wallet-order", user: "user-1", walletPayment: "debit-1", paymentMethod: "WALLET", paymentStatus: "Paid",
  orderStatus: "Pending", totalAmount: 400, onlineAmountPaid: 0, onlineAdvanceRequired: 0, potentialCodAmount: 0, codAmountCollected: 0, remainingCodDue: 0 };
const posting = { _id: "debit-1", user: "user-1", order: "wallet-order", purpose: "ORDER_PAYMENT", direction: "DEBIT", status: "POSTED", amount: 400, createdAt: date };
const populated = { ...order, walletPayment: posting };
assert.deepEqual(getFinancialIssues(populated), []);
const summary = summarizeOrderFinancials([populated]);
assert.equal(summary.paidOrders, 1); assert.equal(summary.codOutstanding, 0); assert.equal(summary.orderLevelWalletReceived, 400);
assert.equal(summary.orderLevelOnlineReceived, 0); assert.equal(summary.orderLevelCodCollected, 0); assert.equal(summary.orderLevelGrossReceived, 400);
for (const changes of [{ purpose: "REWARD_CREDIT" }, { direction: "CREDIT" }, { user: "other" }, { order: "other" }, { amount: 399 }, { status: "Pending" }]) {
  assert(getFinancialIssues({ ...order, walletPayment: { ...posting, ...changes } }).length);
}
assert(getFinancialIssues({ ...populated, onlineAmountPaid: 400 }).length);
assert(getFinancialIssues(order).length, "an unpopulated reference cannot prove a receipt");
const receipts = [posting, { ...posting, _id: "unattributed" }, { ...posting, purpose: "REWARD_CREDIT", direction: "CREDIT" },
  { ...posting, purpose: "REVERSAL", direction: "CREDIT" }, { ...posting, purpose: "ORDER_REFUND", direction: "CREDIT" },
  { ...posting, user: "other" }, { ...posting, amount: 399 }, { ...posting, createdAt: new Date("2020-01-01") }];
const evaluate = (expression, record) => {
  if (typeof expression === "string" && expression.startsWith("$")) return expression.slice(1).split(".").reduce((value, key) => value?.[key], record);
  if (expression?.$eq) return evaluate(expression.$eq[0], record) === evaluate(expression.$eq[1], record);
  if (expression?.$and) return expression.$and.every((part) => evaluate(part, record));
  return expression;
};
const WalletTransactionModel = { async aggregate(pipeline) {
  const match = pipeline[0].$match;
  if (match.purpose === "ORDER_REFUND") return [];
  assert.equal(match.purpose, "ORDER_PAYMENT"); assert.equal(match.direction, "DEBIT"); assert.equal(match.status, "POSTED");
  assert.equal(pipeline[1].$lookup.localField, "order"); assert.equal(pipeline[3].$match["settledOrder.paymentMethod"], "WALLET");
  const selected = receipts.filter((entry) => entry.purpose === match.purpose && entry.direction === match.direction && entry.status === match.status &&
    entry.createdAt >= match.createdAt.$gte && entry.createdAt <= match.createdAt.$lte)
    .map((entry) => ({ ...entry, settledOrder: order })).filter((entry) => evaluate(pipeline[3].$match.$expr, entry));
  assert.deepEqual(selected.map((entry) => entry._id), ["debit-1"]);
  const total = selected.reduce((sum, entry) => sum + entry.amount, 0);
  return pipeline.at(-1).$group.walletReceived ? [{ _id: "2026-09-05", walletReceived: total }] : [{ _id: null, total }];
} };
const PaymentModel = { aggregate: async (pipeline) => pipeline.at(-1).$group.onlineReceived ? [{ _id: "2026-09-01", onlineReceived: 100 }] : [{ total: 100 }] };
const OrderModel = { aggregate: async (pipeline) => pipeline.at(-1).$group.codCollected ? [{ _id: "2026-09-05", codCollected: 300 }] : [{ total: 300 }],
  find: () => ({ select() { return this; }, populate(field) { assert.equal(field, "walletPayment"); return this; }, lean: async () => [populated] }) };
const range = { from: new Date("2026-09-01"), to: new Date("2026-09-30") };
assert.equal((await getOrderFinancialMetrics(range, OrderModel)).paidOrders, 1);
assert.deepEqual(await getReceiptMetrics(range, { PaymentModel, OrderModel, WalletTransactionModel }),
  { onlineReceived: 100, codCollected: 300, walletReceived: 400, walletRefunded: 0, netWalletReceived: 400, grossMoneyReceived: 800 });
assert.deepEqual(await getMoneyReceivedByDate(range, "day", { PaymentModel, OrderModel, WalletTransactionModel }), [
  { label: "2026-09-01", onlineReceived: 100, codCollected: 0, walletReceived: 0, walletRefunded: 0, netWalletReceived: 0, totalReceived: 100 },
  { label: "2026-09-05", onlineReceived: 0, codCollected: 300, walletReceived: 400, walletRefunded: 0, netWalletReceived: 400, totalReceived: 700 }
]);
console.log("Wallet exact receipt attribution, reward/refund/reversal exclusion, separate receipt dates and fully-paid classification passed (mocked aggregation).");

// Exercise the refund pipeline predicates against valid and mismatched evidence.
const { walletRefundPipeline } = await import("../services/financial-analytics.service.js");
const refundedOrder = { ...order, orderStatus: "Cancelled" };
assert.equal(summarizeOrderFinancials([{ ...populated, orderStatus: "Cancelled" }]).paidOrders, 0);
assert.equal(summarizeOrderFinancials([{ ...populated, orderStatus: "Cancelled" }]).cancelledOrderValue, 400);
const validRefund = { _id: "refund-credit", user: order.user, order: order._id, amount: 400, currency: "INR",
  purpose: "ORDER_REFUND", direction: "CREDIT", status: "POSTED", idempotencyKey: "refund-key",
  createdAt: new Date("2026-09-06"), settledOrder: refundedOrder,
  originalDebit: { ...posting, currency: "INR" },
  refundEvidence: { order: order._id, method: "WALLET", status: "Completed", walletPayment: posting._id,
    walletTransaction: "refund-credit", amount: 400, amountPaise: 40000, currency: "INR", idempotencyKey: "refund-key" } };
const evalRefund = (expr, record) => {
  if (expr?.$multiply) return expr.$multiply.reduce((product, part) => product * evalRefund(part, record), 1);
  if (expr?.$eq) return evalRefund(expr.$eq[0], record) === evalRefund(expr.$eq[1], record);
  if (expr?.$and) return expr.$and.every((part) => evalRefund(part, record));
  return evaluate(expr, record);
};
const refundFilter = walletRefundPipeline(range).at(-1).$match;
const acceptsRefund = (record) => Object.entries(refundFilter).every(([field, expected]) =>
  field === "$expr" ? evalRefund(expected, record) : evaluate("$" + field, record) === expected);
assert.equal(acceptsRefund(validRefund), true);
for (const changed of [
  { user: "other" },
  { refundEvidence: { ...validRefund.refundEvidence, walletPayment: "other" } },
  { refundEvidence: { ...validRefund.refundEvidence, amountPaise: 39900 } },
  { refundEvidence: { ...validRefund.refundEvidence, idempotencyKey: "other" } },
  { originalDebit: { ...validRefund.originalDebit, purpose: "REWARD_CREDIT" } },
  { originalDebit: { ...validRefund.originalDebit, user: "other" } },
  { originalDebit: { ...validRefund.originalDebit, order: "other" } },
  { originalDebit: { ...validRefund.originalDebit, amount: 399 } }
]) assert.equal(acceptsRefund({ ...validRefund, ...changed }), false);
const RefundedWalletModel = { async aggregate(pipeline) {
  if (pipeline[0].$match.purpose !== "ORDER_REFUND") return WalletTransactionModel.aggregate(pipeline);
  assert.equal(pipeline.find((stage) => stage.$lookup?.as === "originalDebit").$lookup.from, "wallettransactions");
  return pipeline.at(-1).$group.walletRefunded ? [{ _id: "2026-09-06", walletRefunded: 400 }] : [{ total: 400 }];
} };
const refundedMetrics = await getReceiptMetrics(range, { PaymentModel, OrderModel, WalletTransactionModel: RefundedWalletModel });
assert.equal(refundedMetrics.walletReceived, 400); assert.equal(refundedMetrics.walletRefunded, 400);
assert.equal(refundedMetrics.netWalletReceived, 0); assert.equal(refundedMetrics.grossMoneyReceived, 800);
const refundedDates = await getMoneyReceivedByDate(range, "day", { PaymentModel, OrderModel, WalletTransactionModel: RefundedWalletModel });
assert.deepEqual(refundedDates.at(-1), { label: "2026-09-06", onlineReceived: 0, codCollected: 0,
  walletReceived: 0, walletRefunded: 400, netWalletReceived: -400, totalReceived: 0 });
console.log("Wallet refund debit/evidence validation, cancelled classification, gross versus net and refund-only date reporting passed.");