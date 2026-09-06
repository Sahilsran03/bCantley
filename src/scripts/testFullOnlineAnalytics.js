import assert from "node:assert/strict";
import { getFinancialIssues, summarizeOrderFinancials, getReceiptMetrics, getMoneyReceivedByDate } from "../services/financial-analytics.service.js";

const online = { _id: "online-order", paymentMethod: "ONLINE", totalAmount: 450,
  onlineAmountPaid: 450, codAmountCollected: 0, remainingCodDue: 0,
  paymentStatus: "Paid", orderStatus: "Pending", onlinePayment: "online-payment" };
const pending = { ...online, onlineAmountPaid: 0, paymentStatus: "Pending", onlinePayment: null };
assert.deepEqual(getFinancialIssues(pending), []);
assert.equal(summarizeOrderFinancials([pending]).codOutstanding, 0);
assert.equal(summarizeOrderFinancials([pending]).paidOrders, 0);
assert.equal(summarizeOrderFinancials([online]).paidOrders, 1);
assert.equal(summarizeOrderFinancials([online]).orderLevelGrossReceived, 450);
assert(getFinancialIssues({ ...online, remainingCodDue: 450 }).length);
assert(getFinancialIssues({ ...online, onlineAmountPaid: 0 }).length);
const cod = { _id: "cod-order", paymentMethod: "COD", totalAmount: 400, onlineAmountPaid: 100,
  codAmountCollected: 300, remainingCodDue: 0, paymentStatus: "Paid", orderStatus: "Delivered", codAdvancePayment: "cod-payment" };
const orders = [online, cod];
const date = new Date("2026-09-05T12:00:00Z");
const receipts = [
  { _id: "online-payment", order: online._id, purpose: "FULL_ONLINE", status: "Captured", amount: 450, capturedAt: date },
  { _id: "cod-payment", order: cod._id, purpose: "COD_ADVANCE", status: "Captured", amount: 100, capturedAt: date },
  { _id: "unattributed", order: online._id, purpose: "FULL_ONLINE", status: "Captured", amount: 450, capturedAt: date },
  { _id: "pending-payment", order: online._id, purpose: "FULL_ONLINE", status: "Pending", amount: 450, capturedAt: date }
];
const evaluate = (expression, record) => {
  if (typeof expression === "string" && expression.startsWith("$")) return expression.slice(1).split(".").reduce((value, key) => value?.[key], record);
  if (expression?.$eq) return evaluate(expression.$eq[0], record) === evaluate(expression.$eq[1], record);
  if (expression?.$cond) return evaluate(expression.$cond[0], record) ? evaluate(expression.$cond[1], record) : evaluate(expression.$cond[2], record);
  return expression;
};
const WalletTransactionModel = { aggregate: async () => [] };
const PaymentModel = { async aggregate(pipeline) {
  const match = pipeline[0].$match;
  assert.deepEqual(match.purpose.$in, ["COD_ADVANCE", "FULL_ONLINE"]);
  let selected = receipts.filter((entry) => entry.status === match.status && match.purpose.$in.includes(entry.purpose) &&
    entry.capturedAt >= match.capturedAt.$gte && entry.capturedAt <= match.capturedAt.$lte);
  selected = selected.map((entry) => ({ ...entry, settledOrder: orders.find((order) => order._id === entry.order) }));
  selected = selected.filter((entry) => evaluate(pipeline[3].$match.$expr, entry));
  assert.deepEqual(selected.map((entry) => entry._id), ["online-payment", "cod-payment"]);
  const sum = selected.reduce((total, entry) => total + entry.amount, 0);
  return pipeline.at(-1).$group.onlineReceived ? [{ _id: "2026-09-05", onlineReceived: sum }] : [{ _id: null, total: sum }];
} };
const OrderModel = { async aggregate(pipeline) {
  assert.equal(pipeline[0].$match.codAmountCollected.$gt, 0);
  return pipeline.at(-1).$group.codCollected ? [{ _id: "2026-09-05", codCollected: 300 }] : [{ _id: null, total: 300 }];
} };
const range = { from: new Date("2026-09-01"), to: new Date("2026-09-30") };
assert.deepEqual(await getReceiptMetrics(range, { PaymentModel, OrderModel, WalletTransactionModel }), { onlineReceived: 550, codCollected: 300, walletReceived: 0, walletRefunded: 0, netWalletReceived: 0, grossMoneyReceived: 850 });
assert.deepEqual(await getMoneyReceivedByDate(range, "day", { PaymentModel, OrderModel, WalletTransactionModel }), [
  { label: "2026-09-05", onlineReceived: 550, codCollected: 300, walletReceived: 0, walletRefunded: 0, netWalletReceived: 0, totalReceived: 850 }
]);
console.log("Full Online receipt attribution, no double counting, separate COD and pending/paid classification assertions passed.");
