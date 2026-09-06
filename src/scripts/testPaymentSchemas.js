import assert from "node:assert/strict";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import WebhookEvent from "../models/WebhookEvent.js";

const userId = new mongoose.Types.ObjectId();
const orderId = new mongoose.Types.ObjectId();
const validPayment = () =>
  new Payment({
    user: userId,
    order: orderId,
    provider: "razorpay",
    purpose: "COD_ADVANCE",
    amount: 100
  });

await validPayment().validate();
await new Payment({
  user: userId,
  order: orderId,
  provider: "razorpay",
  purpose: "FULL_ONLINE",
  amount: 100
}).validate();

for (const [label, fields] of [
  ["missing required fields", { provider: "razorpay", purpose: "COD_ADVANCE", amount: 100 }],
  ["zero amount", { user: userId, order: orderId, provider: "razorpay", purpose: "COD_ADVANCE", amount: 0 }],
  ["negative amount", { user: userId, order: orderId, provider: "razorpay", purpose: "COD_ADVANCE", amount: -1 }],
  ["fractional amount", { user: userId, order: orderId, provider: "razorpay", purpose: "COD_ADVANCE", amount: 1.5 }],
  ["invalid currency", { user: userId, order: orderId, provider: "razorpay", purpose: "COD_ADVANCE", amount: 100, currency: "USD" }],
  ["invalid provider", { user: userId, order: orderId, provider: "other", purpose: "COD_ADVANCE", amount: 100 }],
  ["invalid purpose", { user: userId, order: orderId, provider: "razorpay", purpose: "OTHER", amount: 100 }]
]) {
  await assert.rejects(new Payment(fields).validate(), undefined, label);
}

await new WebhookEvent({
  provider: "razorpay",
  eventId: "evt_test_001",
  event: "payment.captured",
  payloadHash: "a".repeat(64)
}).validate();

const webhookIndex = WebhookEvent.schema.indexes().find(([fields]) => fields.provider === 1 && fields.eventId === 1);
assert.equal(webhookIndex?.[1]?.unique, true, "Webhook provider + eventId index must be unique");

const paymentIndexes = Payment.schema.indexes();
for (const expected of [
  { user: 1, order: 1 },
  { provider: 1, providerOrderId: 1 },
  { provider: 1, providerPaymentId: 1 },
  { advanceAttemptKey: 1 }
]) {
  assert(paymentIndexes.some(([fields]) => JSON.stringify(fields) === JSON.stringify(expected)), `Missing Payment index ${JSON.stringify(expected)}`);
}
const attemptKeyIndex = paymentIndexes.find(([fields]) => fields.advanceAttemptKey === 1);
assert.equal(attemptKeyIndex?.[1]?.unique, true, "Active advance-attempt key index must be unique");
const providerPaymentIndex = paymentIndexes.find(
  ([fields]) => fields.provider === 1 && fields.providerPaymentId === 1
);
assert.equal(providerPaymentIndex?.[1]?.unique, true, "Razorpay provider payment identity must be unique");
assert.deepEqual(
  providerPaymentIndex?.[1]?.partialFilterExpression,
  { providerPaymentId: { $type: "string" } },
  "Provider payment uniqueness must exclude unset identifiers"
);

for (const field of [
  "advanceAmount",
  "remainingAmount",
  "onlineAdvanceRequired",
  "onlineAmountPaid",
  "remainingCodDue",
  "codAmountCollected",
  "potentialCodAmount"
]) {
  assert(Order.schema.path(field), `Order schema is missing ${field}`);
}
assert(Order.schema.path("codAdvancePayment"), "Order schema is missing exact COD advance Payment attribution");
assert(Order.schema.path("onlinePayment"), "Order schema is missing distinct full-online Payment attribution");
assert(Order.schema.path("codCollectedAt"), "Order schema is missing COD collection timestamp");
assert(Order.schema.path("codCollectedBy"), "Order schema is missing COD collection admin attribution");

console.log("Payment and WebhookEvent schema assertions passed.");
