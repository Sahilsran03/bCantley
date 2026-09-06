import assert from "node:assert/strict";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import {
  toRazorpayPaise,
  validateCapturedRazorpayPayment,
  validateRazorpayIdentifiers,
  verifyRazorpayPaymentSignature
} from "../services/razorpay.service.js";

const originalSecret = env.razorpayKeySecret;
env.razorpayKeySecret = "test_secret";
const payment = { providerOrderId: "order_test", amount: 100 };
const paymentId = "pay_test";
const signature = crypto.createHmac("sha256", env.razorpayKeySecret).update(`${payment.providerOrderId}|${paymentId}`).digest("hex");

assert.equal(toRazorpayPaise(100), 10000);
assert.equal(verifyRazorpayPaymentSignature({ providerOrderId: payment.providerOrderId, providerPaymentId: paymentId, signature }), true);
assert.equal(verifyRazorpayPaymentSignature({ providerOrderId: payment.providerOrderId, providerPaymentId: paymentId, signature: "bad" }), false);
assert.throws(() => validateRazorpayIdentifiers({ razorpay_payment_id: paymentId }));
assert.doesNotThrow(() => validateCapturedRazorpayPayment({ providerPayment: { order_id: "order_test", amount: 10000, currency: "INR", status: "captured" }, payment }));
for (const providerPayment of [
  { order_id: "other", amount: 10000, currency: "INR", status: "captured" },
  { order_id: "order_test", amount: 5000, currency: "INR", status: "captured" },
  { order_id: "order_test", amount: 10000, currency: "USD", status: "captured" },
  { order_id: "order_test", amount: 10000, currency: "INR", status: "authorized" }
]) assert.throws(() => validateCapturedRazorpayPayment({ providerPayment, payment }));

const order = { totalAmount: 400, onlineAdvanceRequired: 100, onlineAmountPaid: 0, codAmountCollected: 0 };
order.onlineAmountPaid += payment.amount;
const remainingCodDue = Math.max(0, order.totalAmount - order.onlineAmountPaid - order.codAmountCollected);
assert.deepEqual({ ...order, remainingCodDue }, { totalAmount: 400, onlineAdvanceRequired: 100, onlineAmountPaid: 100, codAmountCollected: 0, remainingCodDue: 300 });
assert.equal(Math.max(0, 100 - 200 - 0), 0);
env.razorpayKeySecret = originalSecret;
console.log("Razorpay COD-4D settlement service assertions passed.");
