import assert from "node:assert/strict";
import fs from "node:fs";
import { emailTemplates } from "../services/email.service.js";
import { createPendingOnlineCheckout, respondForExistingAttempt } from "../controllers/order.controller.js";

const payload = {
  paymentMethod: "ONLINE",
  expectedCartVersion: 3,
  couponCode: "SAVE50",
  notes: "",
  shippingAddress: {
    fullName: "Test Customer", phone: "9999999999", email: "test@example.com",
    addressLine1: "Test", addressLine2: "", city: "Delhi", state: "Delhi", country: "India", postalCode: "110001"
  }
};

const makeHarness = ({ insufficientStock = false, failOrderCreation = false, failCoupon = false, partialStockFailure = false, cartVersion = 3 } = {}) => {
  const state = {
    stock: 5, soldCount: 0, orders: [], attempts: [], couponUses: 0,
    cart: { version: cartVersion, appliedCouponCode: "SAVE50", items: [{ unitPrice: 999, quantity: 1 }] }
  };
  state.cart.save = async (options) => { assert.equal(options.session, session); return state.cart; };
  const snapshot = () => ({
    stock: state.stock, soldCount: state.soldCount, orders: [...state.orders], attempts: [...state.attempts],
    cartVersion: state.cart.version, couponUses: state.couponUses, cartItems: structuredClone(state.cart.items), appliedCouponCode: state.cart.appliedCouponCode
  });
  const restore = (saved) => {
    state.cart.version = saved.cartVersion;
    state.stock = saved.stock; state.soldCount = saved.soldCount; state.orders = saved.orders;
    state.attempts = saved.attempts; state.couponUses = saved.couponUses;
    state.cart.items = saved.cartItems; state.cart.appliedCouponCode = saved.appliedCouponCode;
  };
  const session = {
    async withTransaction(callback) {
      const saved = snapshot();
      try { await callback(); } catch (error) { restore(saved); throw error; }
    },
    async endSession() {}
  };
  const query = {
    populate() { return this; }, session(value) { assert.equal(value, session); return this; },
    then(resolve, reject) { return Promise.resolve(state.cart).then(resolve, reject); }
  };
  const CartModel = { findOne: () => query };
  const CheckoutAttemptModel = {
    async create([data], options) {
      assert.equal(options.session, session);
      if (state.attempts.some((attempt) => attempt.key === data.key)) { const error = new Error("duplicate"); error.code = 11000; throw error; }
      const attempt = { ...data, _id: `attempt_${state.attempts.length + 1}`, async save(options) { assert.equal(options.session, session); return this; } };
      state.attempts.push(attempt);
      return [attempt];
    },
    async findOne({ key }) { return state.attempts.find((attempt) => attempt.key === key) || null; }
  };
  const OrderModel = {
    findOne({ checkoutIdempotencyKey, _id }) {
      const result = state.orders.find((order) => checkoutIdempotencyKey ? order.checkoutIdempotencyKey === checkoutIdempotencyKey : order._id === _id) || null;
      return { session(value) { assert.equal(value, session); return this; }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
    },
    async create([data], options) {
      assert.equal(options.session, session);
      if (failOrderCreation) throw new Error("simulated Order creation failure");
      const order = { ...data, _id: "online_order_1" };
      state.orders.push(order);
      return [order];
    }
  };
  const dependencies = {
    CartModel, CheckoutAttemptModel, OrderModel,
    startSession: async () => session,
    buildItems: async (cart, options) => {
      assert.equal(options.session, session);
      assert.equal(options.strictInventory, true);
      if (insufficientStock) throw Object.assign(new Error("Test does not have enough stock."), { statusCode: 400 });
      return {
        orderItems: [{
          product: "product_1", name: "Test", productType: "other", quantity: 1,
          unitPrice: 300, priceModifier: 50, finalPrice: 350, codAvailable: false,
          codAdvanceAmount: 0, variantSku: "SKU-1"
        }],
        stockUpdates: [{ productId: "product_1", sku: "SKU-1", quantity: 1 }]
      };
    },
    reduceInventory: async (updates, options) => { assert.equal(options.session, session); if (state.stock < 1) throw new Error("insufficient"); state.stock -= 1; if (partialStockFailure) throw new Error("second item stock failure"); },
    calculatePricing: async (cart, couponCode, options) => {
      assert.equal(options.session, session);
      assert.equal(cart.items[0].unitPrice, 350, "pricing must use the current authoritative Product/variant price");
      assert.equal(couponCode, "SAVE50");
      return {
        subtotal: 350, discountAmount: 50, totalAmount: 300,
        appliedCoupon: { code: "SAVE50", type: "FIXED", value: 50, discountAmount: 50 }, appliedOffers: []
      };
    },
    checkShipping: async (postalCode, country, options) => { assert.equal(options.session, session); return ({
      isServiceable: true, isInternational: false, isCODAvailable: false,
      shippingFee: 50, estimatedDeliveryDate: new Date("2026-09-10T00:00:00.000Z")
    }); },
    incrementCoupon: async (code, options) => { assert.equal(options.session, session); state.couponUses += 1; if (failCoupon) throw new Error("coupon bookkeeping failure"); },
    orderNumberFactory: async () => "CNT-ONLINE-TEST",
    notify: async () => {}, sendEmail: async () => {},
    respondExisting: (res, userId, attempt, fingerprint) => respondForExistingAttempt(res, userId, attempt, fingerprint, { OrderModel })
  };
  const responses = [];
  const res = { status(code) { this.code = code; return this; }, json(body) { responses.push({ code: this.code, body }); return this; } };
  const req = { user: { _id: "user_1" } };
  return { state, dependencies, req, res, responses };
};

const execute = (harness) => createPendingOnlineCheckout({
  req: harness.req, res: harness.res, payload, key: "11111111-1111-4111-8111-111111111111",
  fingerprint: "fingerprint", dependencies: harness.dependencies
});

const successful = makeHarness();
await execute(successful);
assert.equal(successful.responses[0].code, 201);
const order = successful.responses[0].body.order;
assert.equal(order.paymentMethod, "ONLINE");
assert.equal(order.paymentStatus, "Pending");
assert.equal(order.inventoryStatus, "Reserved");
assert.equal(order.totalAmount, 350);
assert.equal(order.onlineAmountPaid, 0);
assert.equal(order.onlineAdvanceRequired, 0);
assert.equal(order.remainingCodDue, 0);
assert.equal(order.potentialCodAmount, 0);
assert.equal(order.onlinePayment, null);
assert.equal(order.inventoryReservationExpiresAt.getTime() - order.inventoryReservedAt.getTime(), 20 * 60 * 1000);
assert.equal(successful.state.stock, 4);
assert.equal(successful.state.soldCount, 0);
assert.equal(successful.state.cart.items.length, 0);
assert.equal(successful.state.cart.version, 4);
assert.equal(order.codAmountCollected, 0);
assert.equal(order.checkoutRequestFingerprint, "fingerprint");
assert.equal(successful.state.couponUses, 1);
assert.equal(successful.state.attempts[0].status, "Completed");

await execute(successful);
assert.equal(successful.responses[1].body.order._id, order._id);
assert.equal(successful.state.orders.length, 1);
assert.equal(successful.state.stock, 4);
assert.equal(successful.state.couponUses, 1);

const insufficient = makeHarness({ insufficientStock: true });
await assert.rejects(execute(insufficient), /enough stock/);
assert.equal(insufficient.state.orders.length, 0);
assert.equal(insufficient.state.stock, 5);
assert.equal(insufficient.state.attempts.length, 0);
assert.equal(insufficient.state.cart.items.length, 1);

const failedOrder = makeHarness({ failOrderCreation: true });
await assert.rejects(execute(failedOrder), /Order creation failure/);
assert.equal(failedOrder.state.orders.length, 0);
assert.equal(failedOrder.state.stock, 5, "transaction rollback must restore reserved stock");
assert.equal(failedOrder.state.attempts.length, 0);
assert.equal(failedOrder.state.cart.items.length, 1);
assert.equal(failedOrder.state.couponUses, 0);

const versionConflict = makeHarness({ cartVersion: 4 });
await assert.rejects(execute(versionConflict), /Cart has changed/);
assert.equal(versionConflict.state.orders.length, 0);
assert.equal(versionConflict.state.stock, 5);
assert.equal(versionConflict.state.attempts.length, 0);

const controllerSource = fs.readFileSync(new URL("../controllers/order.controller.js", import.meta.url), "utf8");
assert.match(controllerSource, /payload\.paymentMethod === "ONLINE"/);
assert.doesNotMatch(controllerSource, /purpose:\s*"FULL_ONLINE"/);
assert.match(controllerSource, /Online inventory reservation expired\. Start a new checkout attempt/);
assert.match(controllerSource, /releaseOnlineInventoryReservation/);

console.log("Transactional pending Online checkout assertions passed.");

// Order replay remains authoritative after CheckoutAttempt TTL cleanup.
successful.state.attempts = [];
await execute(successful);
assert.equal(successful.responses.at(-1).body.order._id, order._id);
assert.equal(successful.state.stock, 4);
assert.equal(successful.state.couponUses, 1);

for (const options of [{ failCoupon: true }, { partialStockFailure: true }]) {
  const failed = makeHarness(options);
  await assert.rejects(execute(failed), /failure/);
  assert.equal(failed.state.stock, 5);
  assert.equal(failed.state.orders.length, 0);
  assert.equal(failed.state.attempts.length, 0);
  assert.equal(failed.state.couponUses, 0);
  assert.equal(failed.state.cart.version, 3);
  assert.equal(failed.state.cart.items[0].unitPrice, 999);
}
// A genuine transaction abort leaves the same key available for retry.
const recoverable = makeHarness();
const originalCreate = recoverable.dependencies.OrderModel.create;
recoverable.dependencies.OrderModel.create = async () => { throw new Error("temporary failure"); };
await assert.rejects(execute(recoverable), /temporary failure/);
recoverable.dependencies.OrderModel.create = originalCreate;
await execute(recoverable);
assert.equal(recoverable.state.orders.length, 1);
assert.equal(recoverable.state.stock, 4);
console.log("Rollback, session propagation, TTL replay and failure recovery assertions passed.");

const message = emailTemplates.onlineOrderReserved(order);
assert.match(message.text, /awaiting payment/);
assert.match(message.text, /remains unpaid/);
assert.doesNotMatch(message.text, /payable on delivery/);
