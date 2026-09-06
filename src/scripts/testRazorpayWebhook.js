import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import {
  parseRazorpayWebhook,
  RAZORPAY_WEBHOOK_PROCESSING_LEASE_MS,
  reclaimExistingWebhookEvent,
  validateRazorpayWebhookEventId
} from "../controllers/webhook.controller.js";
import { isExactCodAdvanceSettledState } from "../services/payment-settlement.service.js";
import { razorpayWebhookRawBody } from "../routes/webhook.routes.js";
import {
  validateFetchedRazorpayPayment,
  verifyRazorpayWebhookSignature
} from "../services/razorpay.service.js";

const originalWebhookSecret = env.razorpayWebhookSecret;
env.razorpayWebhookSecret = "webhook_test_secret";
const payload = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_test" } } } }));
const validSignature = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(payload).digest("hex");

assert.equal(verifyRazorpayWebhookSignature({ rawBody: payload, signature: "invalid" }), false, "invalid signature");
assert.equal(verifyRazorpayWebhookSignature({ rawBody: payload, signature: "" }), false, "missing signature");
assert.equal(verifyRazorpayWebhookSignature({ rawBody: payload, signature: validSignature }), true, "valid raw-body signature");
env.razorpayWebhookSecret = "";
assert.throws(
  () => verifyRazorpayWebhookSignature({ rawBody: payload, signature: validSignature }),
  (error) => error.statusCode === 503,
  "missing webhook secret is a server configuration error"
);
env.razorpayWebhookSecret = "webhook_test_secret";
assert.throws(() => validateRazorpayWebhookEventId(""), /event ID is required/, "missing event ID");
assert.throws(() => parseRazorpayWebhook(Buffer.from("{")), /Malformed webhook JSON/, "malformed JSON");
assert.equal(parseRazorpayWebhook(Buffer.from('{"event":"order.paid"}')).event, "order.paid", "signed unsupported event parses safely");

const payment = { providerOrderId: "order_test", amount: 100 };
const captured = { id: "pay_test", order_id: "order_test", amount: 10000, currency: "INR", status: "captured" };
assert.doesNotThrow(() => validateFetchedRazorpayPayment({ providerPaymentId: "pay_test", providerPayment: captured, payment }), "valid payment.captured");
assert.throws(() => validateFetchedRazorpayPayment({ providerPaymentId: "pay_wrong", providerPayment: captured, payment }), /do not match/, "wrong provider payment ID");
for (const [label, providerPayment] of [
  ["wrong provider order ID", { ...captured, order_id: "order_wrong" }],
  ["wrong amount", { ...captured, amount: 9900 }],
  ["wrong currency", { ...captured, currency: "USD" }],
  ["not captured", { ...captured, status: "authorized" }]
]) assert.throws(() => validateFetchedRazorpayPayment({ providerPaymentId: "pay_test", providerPayment, payment }), undefined, label);

const settledOrder = {
  totalAmount: 400,
  onlineAdvanceRequired: 100,
  onlineAmountPaid: 100,
  remainingCodDue: 300,
  codAmountCollected: 0,
  codAdvancePayment: "payment_a"
};
assert.equal(isExactCodAdvanceSettledState(settledOrder, 100, "payment_a"), true, "exact Payment recovery is idempotent");
assert.equal(isExactCodAdvanceSettledState(settledOrder, 100, "payment_b"), false, "equal-amount Payment B cannot impersonate Payment A");
assert.equal(isExactCodAdvanceSettledState({ ...settledOrder, codAdvancePayment: null }, 100, "payment_a"), false, "amount arithmetic alone is insufficient");

const now = new Date("2026-09-02T12:00:00.000Z");
const eventId = new mongoose.Types.ObjectId();
const makeLeaseModel = (initial) => {
  let record = { ...initial };
  return {
    async findOneAndUpdate(query, update) {
      const failedMatch = record.status === "Failed";
      const staleCutoff = query.$or[1].updatedAt.$lte;
      const staleMatch = record.status === "Processing" && record.updatedAt <= staleCutoff;
      if (!failedMatch && !staleMatch) return null;
      record = { ...record, ...update };
      return { ...record };
    }
  };
};

const processed = await reclaimExistingWebhookEvent({
  webhookEvent: { _id: eventId, status: "Processed", payloadHash: "hash" },
  payloadHash: "hash",
  now,
  model: { findOneAndUpdate: async () => assert.fail("Processed duplicate must not be claimed") }
});
assert.equal(processed.processed, true, "Processed duplicate is acknowledged without processing");

const activeModel = makeLeaseModel({ status: "Processing", updatedAt: new Date(now.getTime() - 1000) });
await assert.rejects(
  reclaimExistingWebhookEvent({ webhookEvent: { _id: eventId, status: "Processing", payloadHash: "hash" }, payloadHash: "hash", now, model: activeModel }),
  (error) => error.statusCode === 409,
  "active Processing duplicate receives non-2xx retry response"
);

const staleUpdatedAt = new Date(now.getTime() - RAZORPAY_WEBHOOK_PROCESSING_LEASE_MS - 1);
const staleModel = makeLeaseModel({ status: "Processing", updatedAt: staleUpdatedAt });
const staleClaim = await reclaimExistingWebhookEvent({
  webhookEvent: { _id: eventId, status: "Processing", payloadHash: "hash", updatedAt: staleUpdatedAt },
  payloadHash: "hash",
  now,
  model: staleModel
});
assert.equal(staleClaim.processed, false, "stale Processing event is reclaimed");
await assert.rejects(
  reclaimExistingWebhookEvent({ webhookEvent: { _id: eventId, status: "Processing", payloadHash: "hash" }, payloadHash: "hash", now, model: staleModel }),
  (error) => error.statusCode === 409,
  "only one contender can reclaim the stale event"
);

const failedModel = makeLeaseModel({ status: "Failed", updatedAt: now });
const failedClaim = await reclaimExistingWebhookEvent({
  webhookEvent: { _id: eventId, status: "Failed", payloadHash: "hash" }, payloadHash: "hash", now, model: failedModel
});
assert.equal(failedClaim.processed, false, "Failed event can be reclaimed");

let receivedRawBody;
let rawSignatureValid = false;
const rawApp = express();
rawApp.post("/api/webhooks/razorpay", razorpayWebhookRawBody, (req, res) => {
  receivedRawBody = req.body;
  rawSignatureValid = verifyRazorpayWebhookSignature({ rawBody: req.body, signature: req.get("X-Razorpay-Signature") });
  res.status(200).end();
});
const server = await new Promise((resolve) => {
  const listening = rawApp.listen(0, "127.0.0.1", () => resolve(listening));
});
try {
  const exactBody = '{\n  "event": "payment.captured",\n  "whitespace": true\n}';
  const exactSignature = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(Buffer.from(exactBody)).digest("hex");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/razorpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Razorpay-Signature": exactSignature },
    body: exactBody
  });
  assert.equal(response.status, 200);
  assert(Buffer.isBuffer(receivedRawBody), "Express webhook middleware must provide a Buffer");
  assert.equal(receivedRawBody.toString("utf8"), exactBody, "Express middleware must preserve exact request bytes");
  assert.equal(rawSignatureValid, true, "signature must validate against bytes received by Express");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const webhookIndexes = (await import("../models/WebhookEvent.js")).default.schema.indexes();
const uniqueEventIndex = webhookIndexes.find(([fields]) => fields.provider === 1 && fields.eventId === 1);
assert.equal(uniqueEventIndex?.[1]?.unique, true, "duplicate event ID has a unique database guard");

env.razorpayWebhookSecret = originalWebhookSecret;
console.log("Razorpay COD-4E webhook and reconciliation assertions passed.");
