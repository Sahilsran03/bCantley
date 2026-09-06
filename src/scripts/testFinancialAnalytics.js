import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyOrderFinancials, getFinancialIssues, getMoneyReceivedByDate, summarizeOrderFinancials } from "../services/financial-analytics.service.js";

const order = (overrides = {}) => ({ totalAmount: 400, onlineAmountPaid: 0, codAmountCollected: 0, remainingCodDue: 400, paymentStatus: "Pending", orderStatus: "Pending", ...overrides });
assert.deepEqual(summarizeOrderFinancials([order()]), { grossOrderValue: 400, cancelledOrderValue: 0, orderLevelOnlineReceived: 0, orderLevelCodCollected: 0, orderLevelWalletReceived: 0, orderLevelGrossReceived: 0, codOutstanding: 400, paidOrders: 0, unpaidOrPartiallyPaidOrders: 1, incompleteFinancialOrders: 0 });
assert.equal(summarizeOrderFinancials([order({ codAmountCollected: 400, remainingCodDue: 0, paymentStatus: "Paid" })]).orderLevelGrossReceived, 400);
assert.equal(summarizeOrderFinancials([order({ onlineAmountPaid: 100, remainingCodDue: 300, paymentStatus: "AdvancePaid" })]).orderLevelGrossReceived, 100);
assert.equal(summarizeOrderFinancials([order({ onlineAmountPaid: 100, codAmountCollected: 300, remainingCodDue: 0, paymentStatus: "Paid" })]).orderLevelGrossReceived, 400);
assert.equal(classifyOrderFinancials(order({ onlineAmountPaid: 400, remainingCodDue: 0, paymentStatus: "AdvancePaid" })).fullyPaid, true);
const cancelled = summarizeOrderFinancials([order({ orderStatus: "Cancelled" }), order({ orderStatus: "Cancelled", onlineAmountPaid: 100, remainingCodDue: 300 })]);
assert.equal(cancelled.grossOrderValue, 0); assert.equal(cancelled.cancelledOrderValue, 800); assert.equal(cancelled.codOutstanding, 0); assert.equal(cancelled.orderLevelGrossReceived, 100);
const mixed = summarizeOrderFinancials([order(), order({ onlineAmountPaid: 100, remainingCodDue: 300 }), order({ codAmountCollected: 400, remainingCodDue: 0, paymentStatus: "Paid" })]);
assert.equal(mixed.grossOrderValue, 1200); assert.equal(mixed.orderLevelOnlineReceived, 100); assert.equal(mixed.orderLevelCodCollected, 400); assert.equal(mixed.orderLevelGrossReceived, 500); assert.equal(mixed.codOutstanding, 700);
assert.match(getFinancialIssues({ ...order(), onlineAmountPaid: undefined })[0], /onlineAmountPaid/);
assert.equal(classifyOrderFinancials({ ...order(), onlineAmountPaid: undefined }).received, null, "legacy values are never fallback inputs");
assert.equal(summarizeOrderFinancials([]).grossOrderValue, 0);

const WalletTransactionModel = { aggregate: async () => [] };
const PaymentModel = { aggregate: async () => [{ _id: "2026-09-01", onlineReceived: 100 }] };
const OrderModel = { aggregate: async () => [{ _id: "2026-09-05", codCollected: 300 }] };
const events = await getMoneyReceivedByDate({ from: new Date(0), to: new Date() }, "day", { PaymentModel, OrderModel, WalletTransactionModel });
assert.deepEqual(events, [
  { label: "2026-09-01", onlineReceived: 100, codCollected: 0, walletReceived: 0, walletRefunded: 0, netWalletReceived: 0, totalReceived: 100 },
  { label: "2026-09-05", onlineReceived: 0, codCollected: 300, walletReceived: 0, walletRefunded: 0, netWalletReceived: 0, totalReceived: 300 }
]);

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const analytics = await readFile(join(root, "backend/src/services/analytics.service.js"), "utf8");
const controller = await readFile(join(root, "backend/src/controllers/analytics.controller.js"), "utf8");
const dashboard = await readFile(join(root, "frontend/src/pages/AdminDashboard.jsx"), "utf8");
const customer = await readFile(join(root, "frontend/src/pages/CustomerAnalytics.jsx"), "utf8");
assert.match(analytics, /orderStatus: \{ \$ne: "Cancelled" \}/);
assert.match(analytics, /orderValue/); assert.doesNotMatch(customer, /\.spent/);
assert.match(controller, /grossMoneyReceived/); assert.match(controller, /codOutstanding/);
assert.match(controller, /status: "Approved"/); assert.match(dashboard, /Gross Order Value/); assert.doesNotMatch(dashboard, /totalRevenue|>Revenue</);

console.log("Financial analytics tests passed.");
console.log("PURE ASSERTION: financial definitions, full/partial/full-advance/cancelled/mixed/zero/incomplete cases.");
console.log("MOCKED MODEL: receipt event merging proves Monday online and Friday COD remain on their event dates.");
console.log("STATIC ASSERTION: cancelled exclusions, orderValue terminology, approved rewards, corrected dashboard contract.");
console.log("REAL DATABASE: not run. REAL HTTP: not run.");
