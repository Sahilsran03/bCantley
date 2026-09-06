import assert from "node:assert/strict";
import { settleCapturedCodAdvancePayment } from "../services/payment-settlement.service.js";
import { calculateCodTerms } from "../services/cod.service.js";
import { classifyOrderFinancials, summarizeOrderFinancials } from "../services/financial-analytics.service.js";

const makeModels = (advanceAmount) => {
  let order = {
    _id: "order_test",
    paymentMethod: "COD",
    paymentStatus: "Pending",
    orderStatus: "Pending",
    totalAmount: 400,
    onlineAdvanceRequired: advanceAmount,
    onlineAmountPaid: 0,
    codAmountCollected: 0,
    remainingCodDue: 400,
    potentialCodAmount: 400,
    codAdvancePayment: null
  };
  let payment = {
    _id: "payment_test",
    order: order._id,
    provider: "razorpay",
    purpose: "COD_ADVANCE",
    status: "Pending",
    amount: advanceAmount,
    currency: "INR",
    providerOrderId: "razorpay_order_test",
    providerPaymentId: null,
    capturedAt: null,
    advanceAttemptKey: `cod-advance:${order._id}`
  };
  let orderSettlementWrites = 0;

  const PaymentModel = {
    async findOne(query) {
      return query._id === payment._id && query.order === payment.order ? { ...payment } : null;
    },
    async findOneAndUpdate(query, update) {
      if (query._id !== payment._id || query.order !== payment.order) return null;
      if (query.providerPaymentId && payment.providerPaymentId !== query.providerPaymentId) return null;
      if (query.$or) {
        const accepted = query.$or.some((condition) => Object.hasOwn(condition, "providerPaymentId") && condition.providerPaymentId === payment.providerPaymentId);
        if (!accepted) return null;
      }
      payment = { ...payment, ...update };
      return { ...payment };
    }
  };

  const OrderModel = {
    async findById(id) {
      return id === order._id ? { ...order } : null;
    },
    async findOneAndUpdate(query, pipeline) {
      if (
        query._id !== order._id ||
        order.onlineAdvanceRequired !== query.onlineAdvanceRequired ||
        order.onlineAmountPaid !== query.onlineAmountPaid ||
        order.codAdvancePayment !== query.codAdvancePayment
      ) return null;

      for (const field of ["remainingCodDue", "potentialCodAmount"]) {
        assert.deepEqual(pipeline[1].$set[field], { $max: [0, { $subtract: [{ $subtract: ["$totalAmount", payment.amount] }, "$codAmountCollected"] }] });
      }
      orderSettlementWrites += 1;
      order.onlineAmountPaid = payment.amount;
      order.codAdvancePayment = payment._id;
      order.remainingCodDue = Math.max(0, order.totalAmount - payment.amount - order.codAmountCollected);
      order.potentialCodAmount = order.remainingCodDue;
      const statusExpression = pipeline[2].$set.paymentStatus.$cond;
      assert.deepEqual(statusExpression, [{ $gt: ["$remainingCodDue", 0] }, "AdvancePaid", "Paid"]);
      order.paymentStatus = order.remainingCodDue > 0 ? "AdvancePaid" : "Paid";
      return { ...order };
    }
  };

  return {
    OrderModel,
    PaymentModel,
    current: () => ({ order: { ...order }, payment: { ...payment }, orderSettlementWrites })
  };
};

const settle = (models) => settleCapturedCodAdvancePayment({
  orderId: "order_test",
  paymentId: "payment_test",
  providerPaymentId: "razorpay_payment_test",
  OrderModel: models.OrderModel,
  PaymentModel: models.PaymentModel
});

const partial = makeModels(100);
const partialResult = await settle(partial);
assert.equal(partialResult.order.onlineAmountPaid, 100);
assert.equal(partialResult.order.remainingCodDue, 300);
assert.equal(partialResult.order.paymentStatus, "AdvancePaid");

const full = makeModels(400);
const fullResult = await settle(full);
assert.equal(fullResult.order.onlineAmountPaid, 400);
assert.equal(fullResult.order.remainingCodDue, 0);
assert.equal(fullResult.order.paymentStatus, "Paid");

const duplicateResult = await settle(full);
assert.equal(duplicateResult.order.onlineAmountPaid, 400);
assert.equal(duplicateResult.order.remainingCodDue, 0);
assert.equal(duplicateResult.order.paymentStatus, "Paid");
assert.equal(full.current().orderSettlementWrites, 1, "duplicate settlement must not write Order financials twice");

const raced = makeModels(400);
const raceResults = await Promise.all([settle(raced), settle(raced)]);
assert.equal(raceResults.length, 2);
assert.equal(raced.current().order.onlineAmountPaid, 400);
assert.equal(raced.current().order.remainingCodDue, 0);
assert.equal(raced.current().order.paymentStatus, "Paid");
assert.equal(raced.current().orderSettlementWrites, 1, "verification/webhook race must settle Order financials once");

const noAdvanceTerms = calculateCodTerms({
  orderItems: [{ name: "COD item", codAvailable: true, codAdvanceAmount: 0, quantity: 1 }],
  totalAmount: 400
});
assert.deepEqual(noAdvanceTerms, {
  onlineAdvanceRequired: 0,
  onlineAmountPaid: 0,
  codAmountCollected: 0,
  remainingCodDue: 400,
  potentialCodAmount: 400
});

const analyticsOrder = raced.current().order;
assert.deepEqual(classifyOrderFinancials(analyticsOrder), {
  complete: true,
  issues: [],
  received: 400,
  fullyPaid: true
});
const summary = summarizeOrderFinancials([analyticsOrder]);
assert.equal(summary.orderLevelOnlineReceived, 400);
assert.equal(summary.orderLevelCodCollected, 0);
assert.equal(summary.codOutstanding, 0);
assert.equal(summary.paidOrders, 1);

console.log("COD full-advance settlement invariant assertions passed.");
