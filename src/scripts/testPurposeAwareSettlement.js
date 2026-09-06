import assert from "node:assert/strict";
import {
  settleCapturedPayment
} from "../services/payment-settlement.service.js";

const makeModels = ({ purpose, paymentMethod, amount = 400, onlineAdvanceRequired = 0 }) => {
  let order = {
    _id: "order_test",
    paymentMethod,
    paymentStatus: "Pending",
    inventoryStatus: paymentMethod === "ONLINE" ? "Reserved" : "Committed",
    items: [{ product: "product_test", quantity: 1 }],
    totalAmount: 400,
    onlineAdvanceRequired,
    onlineAmountPaid: 0,
    codAmountCollected: 0,
    remainingCodDue: 400,
    potentialCodAmount: 400,
    codAdvancePayment: null,
    onlinePayment: null
  };
  let payment = {
    _id: "payment_test",
    user: "user_test",
    order: order._id,
    provider: "razorpay",
    purpose,
    status: "Pending",
    amount,
    currency: "INR",
    providerOrderId: "provider_order_test",
    providerPaymentId: null,
    capturedAt: null,
    advanceAttemptKey: purpose === "COD_ADVANCE" ? `cod-advance:${order._id}` : null
  };
  let financialWrites = 0;
  let salesCountWrites = 0;

  const PaymentModel = {
    async findOne(query) {
      return query._id === payment._id && query.order === payment.order && query.purpose === payment.purpose
        ? { ...payment }
        : null;
    },
    async findOneAndUpdate(query, update) {
      if (query._id !== payment._id || query.order !== payment.order) return null;
      if (query.purpose && query.purpose !== payment.purpose) return null;
      if (query.providerPaymentId && query.providerPaymentId !== payment.providerPaymentId) return null;
      if (query.$or && !query.$or.some((entry) => entry.providerPaymentId === payment.providerPaymentId)) return null;
      payment = { ...payment, ...update };
      return { ...payment };
    }
  };

  const ProductModel = {
    async updateOne(query, update) {
      assert.equal(query._id, "product_test");
      salesCountWrites += Number(update.$inc.soldCount || 0);
      return { matchedCount: 1 };
    }
  };

  const OrderModel = {
    async findById(id) {
      return id === order._id ? { ...order } : null;
    },
    async findOneAndUpdate(query, update) {
      if (query._id !== order._id || query.onlineAmountPaid !== order.onlineAmountPaid) return null;
      if (query.paymentMethod && query.paymentMethod !== order.paymentMethod) return null;
      if (Object.hasOwn(query, "codAdvancePayment") && query.codAdvancePayment !== order.codAdvancePayment) return null;
      if (Object.hasOwn(query, "onlinePayment") && query.onlinePayment !== order.onlinePayment) return null;
      if (Object.hasOwn(query, "codAmountCollected") && query.codAmountCollected !== order.codAmountCollected) return null;
      if (query.onlineAdvanceRequired !== undefined && query.onlineAdvanceRequired !== order.onlineAdvanceRequired) return null;
      if (query.totalAmount !== undefined && query.totalAmount !== order.totalAmount) return null;

      financialWrites += 1;
      if (Array.isArray(update)) {
        order.onlineAmountPaid = payment.amount;
        order.codAdvancePayment = payment._id;
        order.remainingCodDue = Math.max(0, order.totalAmount - payment.amount - order.codAmountCollected);
        order.potentialCodAmount = order.remainingCodDue;
        order.paymentStatus = order.remainingCodDue > 0 ? "AdvancePaid" : "Paid";
      } else {
        order = { ...order, ...update.$set };
      }
      return { ...order };
    }
  };

  return {
    persistedPayment: () => ({ ...payment }),
    OrderModel,
    PaymentModel,
    ProductModel,
    current: () => ({ order: { ...order }, payment: { ...payment }, financialWrites, salesCountWrites })
  };
};

const dispatch = (models, persistedPayment = models.persistedPayment()) => settleCapturedPayment({
  payment: persistedPayment,
  providerPaymentId: "provider_payment_test",
  OrderModel: models.OrderModel,
  PaymentModel: models.PaymentModel,
  ProductModel: models.ProductModel,
  startSession: null
});

const cod = makeModels({ purpose: "COD_ADVANCE", paymentMethod: "COD", amount: 100, onlineAdvanceRequired: 100 });
const codResult = await dispatch(cod);
assert.equal(codResult.order.paymentStatus, "AdvancePaid");
assert.equal(codResult.order.onlineAmountPaid, 100);
assert.equal(codResult.order.remainingCodDue, 300);
assert.equal(codResult.order.codAdvancePayment, "payment_test");
assert.equal(codResult.order.onlinePayment, null);

const online = makeModels({ purpose: "FULL_ONLINE", paymentMethod: "ONLINE" });
const onlineResult = await dispatch(online);
assert.equal(onlineResult.order.paymentStatus, "Paid");
assert.equal(onlineResult.order.inventoryStatus, "Committed");
assert.equal(onlineResult.order.onlineAmountPaid, 400);
assert.equal(onlineResult.order.remainingCodDue, 0);
assert.equal(onlineResult.order.onlinePayment, "payment_test");
assert.equal(onlineResult.order.codAdvancePayment, null);

const duplicate = await dispatch(online);
assert.equal(duplicate.order.paymentStatus, "Paid");
assert.equal(duplicate.order.onlineAmountPaid, 400);
assert.equal(duplicate.order.remainingCodDue, 0);
assert.equal(online.current().financialWrites, 1, "duplicate full-online settlement must not repeat the financial mutation");
assert.equal(online.current().salesCountWrites, 1, "duplicate full-online settlement must not increment soldCount twice");

await assert.rejects(
  dispatch(online, { ...online.persistedPayment(), purpose: "UNEXPECTED" }),
  (error) => error.statusCode === 409 && /Manual reconciliation/.test(error.message),
  "unknown persisted purpose must fail safely"
);

const incompatible = makeModels({ purpose: "FULL_ONLINE", paymentMethod: "COD" });
await assert.rejects(
  dispatch(incompatible),
  (error) => error.statusCode === 409 && /not eligible/.test(error.message),
  "full-online settlement must reject the current COD Order representation"
);
assert.equal(incompatible.current().financialWrites, 0);

console.log("Purpose-aware Razorpay settlement dispatcher assertions passed.");
