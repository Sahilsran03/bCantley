import assert from "node:assert/strict";
import crypto from "node:crypto";
import Payment from "../models/Payment.js";
import orderRouter from "../routes/order.routes.js";
import { protect } from "../middleware/auth.middleware.js";
import { env } from "../config/env.js";
import { createOnlinePaymentService } from "../services/online-payment.service.js";
import { settleCapturedPayment } from "../services/payment-settlement.service.js";
import { releaseOnlineInventoryReservation } from "../services/inventory-reservation.service.js";
import { validateFetchedRazorpayPayment } from "../services/razorpay.service.js";
import { createRazorpayWebhookHandler } from "../controllers/webhook.controller.js";

const previous = { key: env.razorpayKeySecret, webhook: env.razorpayWebhookSecret };
env.razorpayKeySecret = "isolated_online_test_secret";
env.razorpayWebhookSecret = "isolated_online_webhook_secret";
const clone = (value) => structuredClone(value);
const same = (left, right) => left === right || (left != null && right != null && String(left) === String(right));
const matches = (record, query) => Object.entries(query).every(([key, expected]) => {
  if (key === "$or") return expected.some((entry) => matches(record, entry));
  if (expected && typeof expected === "object" && !(expected instanceof Date)) {
    if ("$in" in expected) return expected.$in.includes(record[key]);
    if ("$ne" in expected) return !same(record[key], expected.$ne);
    if ("$lte" in expected) return record[key] <= expected.$lte;
  }
  return same(record[key], expected);
});
const makeHarness = () => {
  const orderId = "111111111111111111111111";
  const userId = "222222222222222222222222";
  const state = {
    order: { _id: orderId, user: userId, paymentMethod: "ONLINE", orderStatus: "Pending",
      paymentStatus: "Pending", inventoryStatus: "Reserved", totalAmount: 450,
      inventoryReservationExpiresAt: new Date(Date.now() + 1200000),
      onlineAmountPaid: 0, onlineAdvanceRequired: 0, remainingCodDue: 0, potentialCodAmount: 0,
      codAmountCollected: 0, onlinePayment: null, codAdvancePayment: null,
      items: [{ product: "product-1", variantSku: "sku-1", quantity: 2 }] },
    payments: [], stock: 3, soldCount: 0, financialWrites: 0, events: [],
    providerCreates: 0, providerFetches: 0, providerOverrides: {}, creationError: null
  };
  const session = {
    async withTransaction(callback) {
      const saved = clone({ order: state.order, payments: state.payments, stock: state.stock,
        soldCount: state.soldCount, financialWrites: state.financialWrites });
      try { await callback(); } catch (error) { Object.assign(state, saved); throw error; }
    }, async endSession() {}
  };
  const query = (value) => ({ session(actual) { assert.equal(actual, session); return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
  const unique = (candidate) => {
    for (const record of state.payments) {
      if (record._id === candidate._id) continue;
      if ((candidate.onlineAttemptKey && candidate.onlineAttemptKey === record.onlineAttemptKey) ||
          (candidate.providerPaymentId && candidate.provider === record.provider && candidate.providerPaymentId === record.providerPaymentId)) {
        throw Object.assign(new Error("duplicate unique payment identity"), { code: 11000 });
      }
    }
  };
  const paymentDocument = (record) => record ? { ...clone(record), async save() {
    const { save, ...data } = this; unique(data);
    const index = state.payments.findIndex((entry) => entry._id === data._id);
    state.payments[index] = clone(data); return this;
  } } : null;
  const PaymentModel = {
    findOne(filter) { return query(paymentDocument(state.payments.find((entry) => matches(entry, filter)))); },
    async create(data) {
      const record = { providerOrderId: null, providerPaymentId: null, capturedAt: null,
        _id: String(state.payments.length + 1).padStart(24, "0"), ...data };
      unique(record); state.payments.push(clone(record)); return paymentDocument(record);
    },
    async findOneAndUpdate(filter, update, options) {
      assert.equal(options.session, session);
      const record = state.payments.find((entry) => matches(entry, filter));
      if (!record) return null;
      const candidate = { ...record, ...update }; unique(candidate);
      Object.assign(record, candidate); return paymentDocument(record);
    }
  };
  const OrderModel = {
    findOne(filter) {
      if (state.failPreflight && state.payments.length) {
        state.failPreflight = false; throw new Error("preflight lookup unavailable");
      }
      return query(matches(state.order, filter) ? clone(state.order) : null);
    },
    findById(id) { return query(same(state.order._id, id) ? clone(state.order) : null); },
    async findOneAndUpdate(filter, update, options) {
      assert.equal(options.session, session);
      if (update.$set.paymentStatus === "Paid") assert.equal(filter.orderStatus.$ne, "Cancelled");
      if (!matches(state.order, filter)) return null;
      Object.assign(state.order, update.$set);
      if (update.$set.paymentStatus === "Paid") state.financialWrites += 1;
      return clone(state.order);
    }
  };
  const ProductModel = {
    async updateOne(filter, update, options) {
      assert.equal(options.session, session); state.soldCount += update.$inc.soldCount; return { matchedCount: 1 };
    },
    findById() { return query({ variants: [{ sku: "sku-1", stock: state.stock }], async save(options) {
      assert.equal(options.session, session); state.stock = this.variants[0].stock;
    } }); }
  };
  const settle = (args) => settleCapturedPayment({ ...args, OrderModel, PaymentModel, ProductModel, startSession: async () => session });
  const release = (args = {}) => releaseOnlineInventoryReservation({ orderId, ...args,
    dependencies: { OrderModel, ProductModel, startSession: async () => session } });
  const clientFactory = () => ({ orders: { async create(data) {
    state.providerCreates += 1;
    assert.equal(data.amount, 45000); assert.equal(data.notes.purpose, "FULL_ONLINE");
    if (state.creationError) throw state.creationError;
    return { id: `order_provider_${state.providerCreates}`, amount: data.amount, currency: data.currency };
  } } });
  const fetchCaptured = async ({ providerPaymentId, payment }) => {
    state.providerFetches += 1;
    if (state.providerFetchError) throw new Error("verification network uncertainty");
    const value = { id: providerPaymentId, order_id: payment.providerOrderId, amount: 45000,
      currency: "INR", status: "captured", ...state.providerOverrides };
    validateFetchedRazorpayPayment({ providerPaymentId, providerPayment: value, payment }); return value;
  };
  const service = createOnlinePaymentService({ OrderModel, PaymentModel, clientFactory, release, fetchCaptured, settle });
  const identifiers = (providerPaymentId = "pay_provider_1") => {
    const providerOrderId = state.payments[0].providerOrderId;
    return { razorpay_payment_id: providerPaymentId, razorpay_order_id: providerOrderId,
      razorpay_signature: crypto.createHmac("sha256", env.razorpayKeySecret).update(`${providerOrderId}|${providerPaymentId}`).digest("hex") };
  };
  const initiate = (extra = {}) => service.initiate({ orderId, userId, ...extra });
  const verify = (extra = {}) => service.verify({ orderId, userId, body: identifiers(), ...extra });
  const WebhookEventModel = { async create(data) {
    const record = { ...data, status: "Processing", async save() {} }; state.events.push(record); return record;
  } };
  const handler = createRazorpayWebhookHandler({ PaymentModel, WebhookEventModel, fetchCaptured, settle });
  const webhook = () => new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: {
      id: "pay_provider_1", order_id: state.payments[0].providerOrderId
    } } } }));
    const signature = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(raw).digest("hex");
    handler({ body: raw, get: (name) => name === "X-Razorpay-Signature" ? signature : `event-${state.events.length}` },
      { status(code) { assert.equal(code, 200); return this; }, json: resolve }, reject);
  });
  return { state, initiate, verify, webhook, release, identifiers, PaymentModel, orderId, userId };
};
try {
  const h = makeHarness();
  const response = await h.initiate({ body: { amount: 1, purpose: "COD_ADVANCE", paymentStatus: "Paid" } });
  assert.equal(response.amount, 450); assert.equal(response.currency, "INR");
  assert.equal(h.state.payments[0].purpose, "FULL_ONLINE");
  assert.equal(h.state.payments[0].amount, h.state.order.totalAmount);
  assert.equal(h.state.payments[0].onlineAttemptKey, `full-online:${h.orderId}`);
  assert.equal(h.state.order.onlinePayment, null);
  assert.equal((await h.initiate()).razorpayOrderId, response.razorpayOrderId);
  assert.equal(h.state.providerCreates, 1);
  assert.equal(h.state.order.paymentStatus, "Pending", "dismissal has no backend failure transition");
  h.state.payments[0].status = "Failed";
  assert.equal((await h.initiate()).razorpayOrderId, response.razorpayOrderId);
  h.state.payments[0].status = "Pending";
  assert.equal((await h.verify()).status, "PAYMENT_CONFIRMED");
  const capturedAt = h.state.payments[0].capturedAt.getTime();
  await h.verify(); await h.webhook();
  assert.equal(h.state.order.paymentStatus, "Paid"); assert.equal(h.state.order.inventoryStatus, "Committed");
  assert.equal(h.state.order.onlineAmountPaid, 450); assert.equal(h.state.order.remainingCodDue, 0);
  assert.equal(h.state.order.potentialCodAmount, 0); assert.equal(h.state.order.onlinePayment, h.state.payments[0]._id);
  assert.equal(h.state.payments[0].providerPaymentId, "pay_provider_1");
  assert.equal(h.state.payments[0].capturedAt.getTime(), capturedAt);
  assert.equal(h.state.financialWrites, 1); assert.equal(h.state.soldCount, 2); assert.equal(h.state.stock, 3);
  await assert.rejects(h.initiate(), /already paid/); assert.equal(h.state.providerCreates, 1);
  const releasedAfterCapture = await h.release({ now: new Date(Date.now() + 1800000) });
  assert.equal(releasedAfterCapture.released, false);

  const webhookFirst = makeHarness(); await webhookFirst.initiate(); await webhookFirst.webhook(); await webhookFirst.verify();
  assert.equal(webhookFirst.state.financialWrites, 1); assert.equal(webhookFirst.state.soldCount, 2);
  assert.equal(webhookFirst.state.stock, 3);

  const concurrent = makeHarness();
  const concurrentResults = await Promise.allSettled([concurrent.initiate(), concurrent.initiate()]);
  assert(concurrentResults.some((result) => result.status === "fulfilled"));
  assert.equal(concurrent.state.providerCreates, 1); assert.equal(concurrent.state.payments.length, 1);

  const expired = makeHarness(); expired.state.order.inventoryReservationExpiresAt = new Date(0);
  await assert.rejects(expired.initiate(), /expired/);
  assert.equal(expired.state.order.inventoryStatus, "Released"); assert.equal(expired.state.stock, 5);
  assert.equal(expired.state.providerCreates, 0); assert.equal(expired.state.payments.length, 0);
  const late = makeHarness(); await late.initiate();
  await late.release({ now: new Date(Date.now() + 1800000) });
  await assert.rejects(late.verify(), /reconciliation/); await assert.rejects(late.webhook(), /reconciliation/);
  assert.equal(late.state.order.paymentStatus, "Pending"); assert.equal(late.state.stock, 5);
  assert.equal(late.state.soldCount, 0); assert.equal(late.state.events[0].status, "Failed");

  for (const changes of [{ paymentMethod: "COD" }, { orderStatus: "Cancelled" }, { inventoryStatus: "Released" },
    { totalAmount: 0 }, { remainingCodDue: 10 }, { onlineAmountPaid: 1 }, { inventoryReservationExpiresAt: null }]) {
    const invalid = makeHarness(); Object.assign(invalid.state.order, changes);
    await assert.rejects(invalid.initiate()); assert.equal(invalid.state.providerCreates, 0);
  }
  const ownership = makeHarness();
  await assert.rejects(ownership.initiate({ userId: "333333333333333333333333" }), /not found/);
  await assert.rejects(ownership.initiate({ orderId: "bad-id" }), /not found/);
  await ownership.initiate();
  await assert.rejects(ownership.verify({ userId: "333333333333333333333333" }), /not found/);
  await assert.rejects(ownership.verify({ orderId: "444444444444444444444444" }), /not found/);
  await assert.rejects(ownership.verify({ body: { ...ownership.identifiers(), amount: 1 } }), /Only Razorpay/);
  await assert.rejects(ownership.verify({ body: { ...ownership.identifiers(), razorpay_signature: "bad" } }), /signature/);
  assert.equal(ownership.state.providerFetches, 0);
  await assert.rejects(ownership.verify({ body: { ...ownership.identifiers(), razorpay_order_id: "wrong" } }), /not found/);
  for (const changes of [{ purpose: "COD_ADVANCE" }, { order: "444444444444444444444444" }, { user: "other" },
    { amount: 1 }, { currency: "USD" }, { providerPaymentId: "pay_other" }]) {
    const invalid = makeHarness(); await invalid.initiate(); Object.assign(invalid.state.payments[0], changes);
    await assert.rejects(invalid.verify()); assert.equal(invalid.state.financialWrites, 0);
  }
  for (const providerOverrides of [{ id: "wrong" }, { order_id: "wrong" }, { amount: 1 }, { currency: "USD" }, { status: "authorized" }]) {
    const invalid = makeHarness(); await invalid.initiate(); invalid.state.providerOverrides = providerOverrides;
    await assert.rejects(invalid.verify()); assert.equal(invalid.state.financialWrites, 0);
    assert.equal(invalid.state.order.paymentStatus, "Pending");
  }
  const cancelled = makeHarness(); await cancelled.initiate(); cancelled.state.order.orderStatus = "Cancelled";
  await assert.rejects(cancelled.verify(), /Cancelled/);
  await assert.rejects(cancelled.webhook(), /cancelled/); assert.equal(cancelled.state.financialWrites, 0);
  const duplicate = makeHarness(); await duplicate.initiate();
  duplicate.state.payments.push({ _id: "other-payment", provider: "razorpay", purpose: "COD_ADVANCE",
    order: "other-order", status: "Captured", providerPaymentId: "pay_provider_1" });
  await assert.rejects(duplicate.verify(), (error) => error.code === 11000);
  assert.equal(duplicate.state.financialWrites, 0);
  const captured = makeHarness(); await captured.initiate(); captured.state.payments[0].status = "Captured";
  await assert.rejects(captured.initiate(), /captured Online Payment/);
  const network = makeHarness(); await network.initiate(); network.state.providerFetchError = true;
  await assert.rejects(network.verify(), /network uncertainty/);
  assert.equal(network.state.order.paymentStatus, "Pending");
  assert.equal(network.state.order.inventoryStatus, "Reserved");
  assert.equal(network.state.stock, 3); assert.equal(network.state.soldCount, 0);
  network.state.providerFetchError = false; await network.verify();
  const preflight = makeHarness(); preflight.state.failPreflight = true;
  await assert.rejects(preflight.initiate(), /preflight lookup/);
  assert.equal(preflight.state.providerCreates, 0);
  assert.equal(preflight.state.payments[0].onlineAttemptKey, null);
  await preflight.initiate(); assert.equal(preflight.state.providerCreates, 1);
  const uncertain = makeHarness(); uncertain.state.creationError = new Error("timeout");
  await assert.rejects(uncertain.initiate(), /uncertain/);
  await assert.rejects(uncertain.initiate(), /uncertain/); assert.equal(uncertain.state.providerCreates, 1);
  const rejected = makeHarness(); rejected.state.creationError = { statusCode: 400 };
  await assert.rejects(rejected.initiate(), /rejected/);
  assert.equal(rejected.state.payments[0].onlineAttemptKey, null);
  rejected.state.creationError = null; await rejected.initiate(); assert.equal(rejected.state.providerCreates, 2);
  assert.equal(rejected.state.stock, 3);
  for (const field of ["onlineAttemptKey", "advanceAttemptKey", "providerPaymentId"]) {
    assert(Payment.schema.indexes().some(([keys, options]) => keys[field] === 1 && options.unique), `${field} keeps unique protection`);
  }
  assert.equal(orderRouter.stack[0].handle, protect, "customer authentication precedes all Order routes");
  for (const path of ["/:id/payments/online", "/:id/payments/online/verify", "/:id/payments/cod-advance", "/:id/payments/cod-advance/verify"]) {
    assert(orderRouter.stack.some((layer) => layer.route?.path === path && layer.route.methods.post));
  }
  assert(!orderRouter.stack.some((layer) => /wallet/i.test(layer.route?.path || "")));
  assert(!JSON.stringify(response).includes(env.razorpayKeySecret));
  assert(!JSON.stringify(response).includes(env.razorpayWebhookSecret));
  console.log("Full Online initiation, verification, real webhook handler, security, idempotency and race assertions passed.");
  console.log("Provider and MongoDB are mocked; settlement/release use actual services with a rollback harness. No live provider or DB calls.");
} finally {
  env.razorpayKeySecret = previous.key; env.razorpayWebhookSecret = previous.webhook;
}
