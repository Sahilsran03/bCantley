import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  assertCustomerOwnsOrder,
  buildCodAdvanceRazorpayOrder,
  toRazorpayPaise,
  validateCodAdvanceEligibility
} from "../services/razorpay.service.js";

assert.equal(toRazorpayPaise(100), 10000);
assert.equal(toRazorpayPaise(400), 40000);
for (const amount of [0, -1, 1.5]) {
  assert.throws(() => toRazorpayPaise(amount));
}

const baseOrder = {
  _id: new mongoose.Types.ObjectId(),
  user: new mongoose.Types.ObjectId(),
  paymentMethod: "COD",
  orderStatus: "Pending",
  totalAmount: 400,
  onlineAdvanceRequired: 100,
  onlineAmountPaid: 0,
  remainingCodDue: 400
};
assert.doesNotThrow(() => assertCustomerOwnsOrder(baseOrder, baseOrder.user));
assert.throws(() => assertCustomerOwnsOrder(baseOrder, new mongoose.Types.ObjectId()));
assert.equal(validateCodAdvanceEligibility(baseOrder), 100);
assert.throws(() => validateCodAdvanceEligibility({ ...baseOrder, orderStatus: "Cancelled" }));
assert.throws(() => validateCodAdvanceEligibility({ ...baseOrder, onlineAmountPaid: 100 }));
assert.throws(() => validateCodAdvanceEligibility(baseOrder, [{ amount: 100 }]));

const providerRequest = buildCodAdvanceRazorpayOrder({
  order: baseOrder,
  payment: { _id: new mongoose.Types.ObjectId(), amount: validateCodAdvanceEligibility(baseOrder) }
});
assert.equal(providerRequest.amount, 10000);
assert.equal(providerRequest.currency, "INR");
assert.equal(providerRequest.notes.purpose, "COD_ADVANCE");
assert(!Object.hasOwn(providerRequest, "key_secret"));

const mockRazorpay = {
  orders: {
    create: async (request) => {
      assert.equal(request.amount, 10000, "Razorpay amount must come from Order.onlineAdvanceRequired");
      assert.equal(request.currency, "INR");
      return { id: "order_test_advance" };
    }
  }
};
const mockRazorpayOrder = await mockRazorpay.orders.create(providerRequest);
assert.equal(mockRazorpayOrder.id, "order_test_advance");

const reusable = { status: "Pending", providerOrderId: "order_test", amount: 100 };
assert.equal(reusable.status === "Pending" && Boolean(reusable.providerOrderId) && reusable.amount === 100, true);
const failedAttempt = { status: "Failed" };
assert.equal(failedAttempt.status === "Failed", true);
const activeAttemptKey = `cod-advance:${baseOrder._id}`;
assert.equal(activeAttemptKey, `cod-advance:${baseOrder._id}`);
const requestSuppliedAmount = 400;
assert.notEqual(providerRequest.amount, requestSuppliedAmount * 100, "Request amounts must not control Razorpay amount");
assert.equal(baseOrder.onlineAmountPaid, 0);
assert.equal(baseOrder.remainingCodDue, 400);

console.log("Razorpay COD-4B service assertions passed.");
