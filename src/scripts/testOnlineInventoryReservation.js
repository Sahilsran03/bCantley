import assert from "node:assert/strict";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import { releaseOnlineInventoryReservation, getOnlineInventoryReservationWindow, ONLINE_INVENTORY_RESERVATION_MS } from "../services/inventory-reservation.service.js";
import { settleCapturedFullOnlinePayment } from "../services/payment-settlement.service.js";

const now = new Date("2026-09-05T10:00:00.000Z");
const reservationWindow = getOnlineInventoryReservationWindow(now);
assert.equal(reservationWindow.inventoryReservationExpiresAt.getTime() - now.getTime(), ONLINE_INVENTORY_RESERVATION_MS);
assert.equal(ONLINE_INVENTORY_RESERVATION_MS, 20 * 60 * 1000);

const baseOrderDocument = (paymentMethod) => ({
  user: new mongoose.Types.ObjectId(),
  orderNumber: `CNT-TEST-${paymentMethod}`,
  items: [{
    product: new mongoose.Types.ObjectId(), name: "Test", productType: "other",
    quantity: 1, unitPrice: 400, finalPrice: 400
  }],
  shippingAddress: {
    fullName: "Test Customer", phone: "9999999999", email: "test@example.com",
    addressLine1: "Test address", city: "Test", state: "Test", country: "India", postalCode: "100001"
  },
  subtotal: 400, advanceAmount: 0, remainingAmount: 400, totalAmount: 400,
  onlineAdvanceRequired: 0, onlineAmountPaid: 0, remainingCodDue: 400,
  codAmountCollected: 0, potentialCodAmount: 400,
  paymentMethod, paymentStatus: "Pending",
  inventoryStatus: paymentMethod === "ONLINE" ? "Reserved" : "Committed",
  ...(paymentMethod === "ONLINE" ? reservationWindow : {})
});
await new Order(baseOrderDocument("COD")).validate();
await new Order(baseOrderDocument("ONLINE")).validate();
assert(Order.schema.path("inventoryReservedAt"));
assert(Order.schema.path("inventoryReservationExpiresAt"));
assert(Order.schema.indexes().some(([fields]) => fields.paymentMethod === 1 && fields.paymentStatus === 1 && fields.inventoryStatus === 1 && fields.inventoryReservationExpiresAt === 1));

const makeModels = ({ expiresAt = new Date(now.getTime() - 1) } = {}) => {
  const product = {
    _id: "product_test",
    variants: [{ sku: "SKU-1", stock: 2 }],
    soldCount: 0,
    async save() { return this; }
  };
  let order = {
    _id: "order_test", paymentMethod: "ONLINE", paymentStatus: "Pending", orderStatus: "Pending",
    inventoryStatus: "Reserved", inventoryReservedAt: new Date(now.getTime() - ONLINE_INVENTORY_RESERVATION_MS),
    inventoryReservationExpiresAt: expiresAt,
    totalAmount: 400, onlineAdvanceRequired: 0, onlineAmountPaid: 0, codAmountCollected: 0,
    remainingCodDue: 400, potentialCodAmount: 400, onlinePayment: null, codAdvancePayment: null,
    items: [{ product: product._id, variantSku: "SKU-1", quantity: 1 }]
  };
  let payment = {
    _id: "payment_test", user: "user_test", order: order._id, provider: "razorpay",
    purpose: "FULL_ONLINE", status: "Pending", amount: 400, currency: "INR",
    providerOrderId: "provider_order_test", providerPaymentId: null, capturedAt: null
  };
  let releaseWrites = 0;
  let settlementWrites = 0;
  let salesCountWrites = 0;

  const OrderModel = {
    async findById(id) { return id === order._id ? { ...order, items: order.items.map((item) => ({ ...item })) } : null; },
    async findOneAndUpdate(query, update) {
      if (query._id !== order._id) return null;
      if (query.inventoryStatus && query.inventoryStatus !== order.inventoryStatus) return null;
      if (query.paymentMethod && query.paymentMethod !== order.paymentMethod) return null;
      if (query.paymentStatus?.$in && !query.paymentStatus.$in.includes(order.paymentStatus)) return null;
      if (typeof query.paymentStatus === "string" && query.paymentStatus !== order.paymentStatus) return null;
      if (query.inventoryReservationExpiresAt?.$lte && order.inventoryReservationExpiresAt > query.inventoryReservationExpiresAt.$lte) return null;
      if (query.onlineAmountPaid !== undefined && query.onlineAmountPaid !== order.onlineAmountPaid) return null;
      if (query.codAmountCollected !== undefined && query.codAmountCollected !== order.codAmountCollected) return null;
      if (query.onlinePayment !== undefined && query.onlinePayment !== order.onlinePayment) return null;
      if (query.totalAmount !== undefined && query.totalAmount !== order.totalAmount) return null;
      if (update.$set.inventoryStatus === "Released") releaseWrites += 1;
      else settlementWrites += 1;
      order = { ...order, ...update.$set };
      return { ...order, items: order.items.map((item) => ({ ...item })) };
    }
  };
  const ProductModel = {
    async findById(id) { return id === product._id ? product : null; },
    async updateOne(query, update) {
      if (query._id !== product._id) return { matchedCount: 0 };
      product.soldCount += Number(update.$inc.soldCount || 0);
      salesCountWrites += 1;
      return { matchedCount: 1 };
    }
  };
  const PaymentModel = {
    async findOne(query) { return query._id === payment._id && query.order === payment.order && query.purpose === payment.purpose ? { ...payment } : null; },
    async findOneAndUpdate(query, update) {
      if (query._id !== payment._id || query.order !== payment.order) return null;
      if (query.purpose && query.purpose !== payment.purpose) return null;
      if (query.providerPaymentId && query.providerPaymentId !== payment.providerPaymentId) return null;
      if (query.$or && !query.$or.some((entry) => entry.providerPaymentId === payment.providerPaymentId)) return null;
      payment = { ...payment, ...update };
      return { ...payment };
    }
  };
  return {
    OrderModel, ProductModel, PaymentModel,
    current: () => ({ order: { ...order }, payment: { ...payment }, stock: product.variants[0].stock, soldCount: product.soldCount, releaseWrites, settlementWrites, salesCountWrites })
  };
};

const release = (models, options = {}) => releaseOnlineInventoryReservation({
  orderId: "order_test", now, ...options,
  dependencies: { OrderModel: models.OrderModel, ProductModel: models.ProductModel, startSession: null }
});
const settle = (models) => settleCapturedFullOnlinePayment({
  orderId: "order_test", paymentId: "payment_test", providerPaymentId: "provider_payment_test",
  OrderModel: models.OrderModel, PaymentModel: models.PaymentModel, ProductModel: models.ProductModel, startSession: null
});

const expired = makeModels();
assert.equal((await release(expired)).released, true);
assert.equal(expired.current().order.inventoryStatus, "Released");
assert.equal(expired.current().stock, 3);
assert.equal((await release(expired)).released, false);
assert.equal(expired.current().stock, 3);
assert.equal(expired.current().releaseWrites, 1);
await assert.rejects(settle(expired), /Manual reconciliation/);
assert.equal(expired.current().order.paymentStatus, "Pending");

const paidFirst = makeModels();
const settled = await settle(paidFirst);
assert.equal(settled.order.paymentStatus, "Paid");
assert.equal(settled.order.inventoryStatus, "Committed");
assert.equal(settled.order.onlineAmountPaid, 400);
assert.equal(settled.order.remainingCodDue, 0);
assert.equal(paidFirst.current().stock, 2, "settlement commits an existing reservation without decrementing stock again");
assert.equal(paidFirst.current().soldCount, 1);
assert.equal((await release(paidFirst)).released, false);
assert.equal(paidFirst.current().stock, 2);
await settle(paidFirst);
assert.equal(paidFirst.current().settlementWrites, 1);
assert.equal(paidFirst.current().salesCountWrites, 1);
assert.equal(paidFirst.current().soldCount, 1);

const notExpired = makeModels({ expiresAt: new Date(now.getTime() + 1) });
assert.equal((await release(notExpired)).released, false);
assert.equal(notExpired.current().stock, 2);

const cancelledReservation = makeModels({ expiresAt: new Date(now.getTime() + ONLINE_INVENTORY_RESERVATION_MS) });
assert.equal((await release(cancelledReservation, { requireExpired: false })).released, true);
assert.equal(cancelledReservation.current().order.inventoryStatus, "Released");
assert.equal(cancelledReservation.current().stock, 3);
assert.equal((await release(cancelledReservation, { requireExpired: false })).released, false);
assert.equal(cancelledReservation.current().stock, 3);

console.log("Online inventory reservation and settlement boundary assertions passed.");
