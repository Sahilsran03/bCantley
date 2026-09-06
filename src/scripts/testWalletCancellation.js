import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createWalletCancellationService, assertWalletReturnSupported } from "../services/wallet-cancellation.service.js";
import { createWalletService } from "../services/wallet.service.js";
import { makeWalletHarness, walletUserId } from "./helpers/walletHarness.js";
import { transitionOrderStatus } from "../services/order-status.service.js";
import { assertReturnEligibility } from "../services/return-refund.service.js";
import RefundTransaction from "../models/RefundTransaction.js";
import { validateReturnRequest, validateRefundTransaction } from "../validators/return.validator.js";

const orderId = "333333333333333333333333", productId = "444444444444444444444444", adminId = "555555555555555555555555";
const oid = () => new mongoose.Types.ObjectId().toString();
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => value?.$in ? value.$in.includes(row[key]) : String(row[key]) === String(value));
const harness = async () => {
  const h = makeWalletHarness({ balance: 1000 }); const { state } = h;
  const originalCreate = h.LedgerModel.create;
  h.LedgerModel.create = ([data], options) => originalCreate([{ ...data, order: data.order ? String(data.order) : null, refund: data.refund ? String(data.refund) : null }], options);
  h.LedgerModel.findById = (_id) => h.LedgerModel.findOne({ _id });
  const wallet = createWalletService(h);
  const debit = await wallet.debitWallet({ userId: walletUserId, orderId, purpose: "ORDER_PAYMENT", amount: 400, idempotencyKey: `wallet-order-payment:${orderId}` });
  state.order = { _id: orderId, user: walletUserId, walletPayment: debit.transaction._id, paymentMethod: "WALLET", paymentStatus: "Paid",
    totalAmount: 400, onlineAmountPaid: 0, onlineAdvanceRequired: 0, remainingCodDue: 0, potentialCodAmount: 0, codAmountCollected: 0,
    orderStatus: "Pending", inventoryStatus: "Committed", refundStatus: "None", trackingHistory: [], returnHistory: [],
    items: [{ product: productId, variantSku: "SKU-1", quantity: 1 }] };
  state.product = { _id: productId, soldCount: 9, variants: [{ sku: "SKU-1", stock: 4 }] };
  state.requests = []; state.refunds = []; state.failure = "";
  const active = (options) => assert.equal(options.session.inTransaction(), true);
  const query = (get) => ({ session(session) { active({ session }); return this; }, then(resolve, reject) { return Promise.resolve().then(get).then(resolve, reject); } });
  const document = (record, persist, failure) => record ? { ...structuredClone(record), async save(options) {
    active(options); const { save, ...data } = this; persist(data); if (state.failure === failure) throw new Error(`${failure} failure`); return this;
  } } : null;
  const OrderModel = { findById: () => query(() => document(state.order, (data) => { state.order = data; }, "order")) };
  const ProductModel = { findById: () => query(() => document(state.product, (data) => { state.product = data; }, "inventory")) };
  const requestDoc = (record) => document(record, (data) => { state.requests[state.requests.findIndex((entry) => entry._id === data._id)] = data; }, "request");
  const RequestModel = {
    find: (filter) => query(() => state.requests.filter((entry) => matches(entry, filter)).map(requestDoc)),
    findById: (_id) => query(() => requestDoc(state.requests.find((entry) => entry._id === String(_id)))),
    async create([data], options) { active(options); const record = { ...data, _id: oid() }; state.requests.push(record); return [requestDoc(record)]; }
  };
  const RefundModel = {
    find: (filter) => query(() => state.refunds.filter((entry) => matches(entry, filter))),
    async create([data], options) {
      active(options); const record = { ...data, _id: String(data._id), order: String(data.order), returnRequest: data.returnRequest ? String(data.returnRequest) : null };
      if (state.refunds.some((entry) => entry.idempotencyKey === record.idempotencyKey)) throw Object.assign(new Error("duplicate"), { code: 11000 });
      const doc = new RefundTransaction(record); await doc.validate();
      state.refunds.push(record); if (state.failure === "evidence") throw new Error("evidence failure"); return [record];
    }
  };
  const startSession = async () => {
    const session = await h.startSession(); const original = session.withTransaction.bind(session);
    session.withTransaction = (work) => original(async () => { await work(); if (state.failure === "commit") throw new Error("commit failure"); });
    return session;
  };
  const service = createWalletCancellationService({ OrderModel, ProductModel, RequestModel, RefundModel, LedgerModel: h.LedgerModel, credit: wallet.creditWallet, startSession });
  return { state, service, wallet, OrderModel, debit: debit.transaction, cancel: (extra = {}) => service.finalize({ orderId, adminId, ...extra }),
    request: () => service.requestCancellation({ orderId, userId: walletUserId, reason: "Please cancel my Order" }) };
};
const pristine = (h, balance = 600) => {
  assert.equal(h.state.users[walletUserId].walletBalance, balance); assert.equal(h.state.entries.length, 1); assert.equal(h.state.refunds.length, 0);
  assert.equal(h.state.product.variants[0].stock, 4); assert.equal(h.state.product.soldCount, 9); assert.equal(h.state.order.orderStatus, "Pending");
  assert.equal(h.state.order.inventoryStatus, "Committed"); assert.equal(h.state.order.trackingHistory.length, 0);
};
const h = await harness(); const originalDebit = structuredClone(h.state.entries[0]);
const result = await h.cancel(); assert.equal(result.changed, true); assert.equal(result.walletRefund.amount, 400);
assert.equal(h.state.users[walletUserId].walletBalance, 1000); assert.equal(h.state.entries.length, 2); assert.equal(h.state.refunds.length, 1);
const credit = h.state.entries[1]; assert.equal(credit.purpose, "ORDER_REFUND"); assert.equal(credit.direction, "CREDIT"); assert.equal(credit.amount, 400);
assert.equal(credit.balanceBefore, 600); assert.equal(credit.balanceAfter, 1000); assert.equal(credit.order, orderId); assert.equal(credit.user, walletUserId);
assert.equal(credit.refund, h.state.refunds[0]._id); assert.equal(h.state.refunds[0].walletPayment, originalDebit._id); assert.equal(h.state.refunds[0].walletTransaction, credit._id);
assert.equal(h.state.refunds[0].method, "WALLET"); assert.equal(h.state.order.orderStatus, "Cancelled"); assert.equal(h.state.order.refundStatus, "Refunded");
assert.equal(h.state.order.paymentStatus, "Paid"); assert.equal(h.state.order.inventoryStatus, "Restocked"); assert.equal(h.state.product.variants[0].stock, 5);
assert.equal(h.state.product.soldCount, 9, "soldCount follows existing gross accepted-sale semantics");
assert.deepEqual(h.state.entries[0], originalDebit, "original debit is immutable");
assert.equal((await h.cancel()).changed, false); assert.equal(h.state.entries.length, 2); assert.equal(h.state.product.variants[0].stock, 5); assert.equal(h.state.order.trackingHistory.length, 1);
const earned = await harness(); await earned.wallet.creditWallet({ userId: walletUserId, amount: 100, purpose: "REWARD_CREDIT", rewardId: oid(), idempotencyKey: "later-reward" });
await earned.cancel(); assert.equal(earned.state.users[walletUserId].walletBalance, 1100); assert.equal(earned.state.entries.at(-1).balanceBefore, 700);
const requested = await harness(); const request = await requested.request(); pristine(requested);
assert.equal(request.status, "Pending"); assert.equal(request.refundStatus, "Pending");
await assert.rejects(requested.request(), /active cancellation/);
await requested.cancel({ requestId: request._id }); assert.equal(requested.state.requests[0].status, "Approved"); assert.equal(requested.state.requests[0].refundStatus, "Processed");
assert.equal(requested.state.refunds[0].returnRequest, request._id); assert.equal((await requested.cancel({ requestId: request._id })).changed, false);
assert.equal(requested.state.order.returnHistory.length, 2);
const rejected = await harness(); const denied = await rejected.request();
await rejected.service.rejectRequest({ orderId, requestId: denied._id, adminId }); pristine(rejected);
assert.equal(rejected.state.requests[0].status, "Rejected"); assert.equal((await rejected.service.rejectRequest({ orderId, requestId: denied._id, adminId })).changed, false);
await assert.rejects(rejected.cancel({ requestId: denied._id }), /not eligible/);
const concurrent = await harness(); const pending = await concurrent.request();
const results = await Promise.all([concurrent.cancel(), concurrent.cancel({ requestId: pending._id })]);
assert.equal(results.filter((entry) => entry.changed).length, 1); assert.equal(concurrent.state.entries.length, 2); assert.equal(concurrent.state.refunds.length, 1);
assert.equal(concurrent.state.product.variants[0].stock, 5); assert.equal(concurrent.state.order.trackingHistory.length, 1);
for (const mutation of [
  (x) => { x.state.order.walletPayment = null; }, (x) => { x.state.order.walletPayment = oid(); },
  (x) => { x.state.entries[0].user = oid(); }, (x) => { x.state.entries[0].order = oid(); },
  (x) => { x.state.entries[0].purpose = "REWARD_CREDIT"; }, (x) => { x.state.entries[0].direction = "CREDIT"; },
  (x) => { x.state.entries[0].status = "Pending"; }, (x) => { x.state.entries[0].amount = 399; },
  (x) => { x.state.order.paymentStatus = "Pending"; }, (x) => { x.state.order.refundStatus = "Refunded"; }
]) { const invalid = await harness(); mutation(invalid); await assert.rejects(invalid.cancel(), /reconciliation/); assert.equal(invalid.state.users[walletUserId].walletBalance, 600); assert.equal(invalid.state.refunds.length, 0); assert.equal(invalid.state.product.variants[0].stock, 4); }
for (const failure of ["inventory", "order", "evidence", "commit", "request", "credit"]) {
  const failed = await harness(); if (failure === "request") await failed.request();
  failed.state.failure = failure; if (failure === "credit") failed.state.failLedger = true;
  await assert.rejects(failed.cancel(), /failure/); pristine(failed);
  if (failure === "request") assert.equal(failed.state.requests[0].status, "Pending");
}
const malformedInventory = await harness(); malformedInventory.state.product.variants[0].sku = "different";
await assert.rejects(malformedInventory.cancel(), /reconciliation/); pristine(malformedInventory);
const inconsistent = await harness(); await inconsistent.cancel(); inconsistent.state.order.inventoryStatus = "Committed";
await assert.rejects(inconsistent.cancel(), /reconciliation/); assert.equal(inconsistent.state.users[walletUserId].walletBalance, 1000);
const activeRefund = await harness(); await activeRefund.cancel(); activeRefund.state.order.orderStatus = "Pending"; activeRefund.state.order.inventoryStatus = "Committed";
await assert.rejects(activeRefund.cancel(), /terminal refund evidence/); assert.equal(activeRefund.state.entries.length, 2);
for (const method of ["COD", "ONLINE"]) { const nonwallet = await harness(); nonwallet.state.order.paymentMethod = method;
  await assert.rejects(nonwallet.cancel(), /not a Wallet/); pristine(nonwallet); }
for (const status of ["Printing", "Packing", "Shipped", "Delivered"]) { const late = await harness(); late.state.order.orderStatus = status;
  await assert.rejects(late.cancel(), /before Printing/); assert.equal(late.state.entries.length, 1); }
const delegated = await harness(); await transitionOrderStatus({ orderId, adminId, nextStatus: "Cancelled", OrderModel: delegated.OrderModel, walletCancellation: delegated.service.finalize });
assert.equal(delegated.state.entries.length, 2); assert.equal((await transitionOrderStatus({ orderId, adminId, nextStatus: "Cancelled", OrderModel: delegated.OrderModel, walletCancellation: delegated.service.finalize })).changed, false);
assert.throws(() => assertWalletReturnSupported({ paymentMethod: "WALLET" }), /reconciliation/);
assert.throws(() => assertReturnEligibility({ paymentMethod: "WALLET", orderStatus: "Delivered" }), /reconciliation/);
assert.throws(() => validateRefundTransaction({ method: "WALLET", amount: 400 }, "client-key"), /Invalid refund method/);
const base = { order: orderId, type: "CANCEL", reason: "Please cancel this Order" };
assert.deepEqual(validateReturnRequest({ ...base, refundAmount: 99999, walletBalance: 99999, walletPayment: oid(), purpose: "ORDER_REFUND", balanceAfter: 99999 }), validateReturnRequest(base));
console.log("Wallet cancellation, exact evidence, request/approval/rejection, replay/concurrency, additive balance, malformed history, rollback and method isolation passed.");
console.log("Actual cancellation/wallet services and refund schema with serialized rollback model mocks; commit failure is simulated before commit, not real MongoDB contention.");

// Existing terminal evidence must agree in every attribution field on replay.
for (const mutate of [
  (x) => { x.state.requests[0].user = oid(); },
  (x) => { x.state.requests[0].approvedRefundAmountPaise = 1; },
  (x) => { x.state.refunds[0].returnRequest = oid(); },
  (x) => { x.state.refunds[0].walletRefundKind = "RETURN"; },
  (x) => { x.state.refunds[0].manualReference = "unexpected"; },
  (x) => { x.state.entries[1].reward = oid(); },
  (x) => { x.state.entries[0].reversalOf = oid(); }
]) {
  const replay = await harness(); await replay.request(); await replay.cancel(); mutate(replay);
  await assert.rejects(replay.cancel(), /reconciliation/);
  assert.equal(replay.state.entries.length, 2); assert.equal(replay.state.users[walletUserId].walletBalance, 1000);
  assert.equal(replay.state.product.variants[0].stock, 5);
}
// Model future partial-refund evidence without exposing a partial refund API.
const partial = await harness();
const partialRefundId = oid();
const partialPosting = await partial.wallet.creditWallet({ userId: walletUserId, orderId, amount: 100,
  purpose: "ORDER_REFUND", refundId: partialRefundId, idempotencyKey: "prior-partial-refund" });
partial.state.refunds.push({ _id: partialRefundId, order: orderId, method: "WALLET", status: "Completed",
  walletPayment: partial.debit._id, walletTransaction: partialPosting.transaction._id, walletRefundKind: "RETURN",
  amount: 100, amountPaise: 10000, currency: "INR", idempotencyKey: "prior-partial-refund" });
partial.state.order.refundStatus = "PartiallyRefunded";
const remainder = await partial.cancel();
assert.equal(remainder.walletRefund.amount, 300);
assert.equal(partial.state.users[walletUserId].walletBalance, 1000);
assert.equal(partial.state.entries.filter((entry) => entry.purpose === "ORDER_REFUND").reduce((sum, entry) => sum + entry.amount, 0), 400);
assert.equal((await partial.cancel()).changed, false);
assert.equal(partial.state.product.variants[0].stock, 5);
console.log("Malformed replay attribution and exact remaining-amount cancellation passed.");