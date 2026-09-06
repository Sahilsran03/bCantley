import assert from "node:assert/strict";
import Order from "../models/Order.js";
import { validateTrackingUpdateInput } from "../validators/shipping.validator.js";
import { assertReviewOrderEligible } from "../services/review-reward.service.js";
import {
  assertCanonicalOrderStatus,
  assertOrderStatusTransition,
  transitionOrderStatus
} from "../services/order-status.service.js";

const clone = (value) => structuredClone(value);

const createOrderModel = (initial) => {
  let state = clone(initial);
  let updateCount = 0;
  return {
    async findById(id) {
      return state && String(state._id) === String(id) ? clone(state) : null;
    },
    async findOneAndUpdate(filter, update) {
      if (!state || String(state._id) !== String(filter._id) || state.orderStatus !== filter.orderStatus) return null;
      state = { ...state, ...clone(update.$set) };
      state.trackingHistory.push(clone(update.$push.trackingHistory));
      updateCount += 1;
      return clone(state);
    },
    snapshot: () => clone(state),
    updateCount: () => updateCount
  };
};

const createProductModel = () => {
  const product = {
    variants: [{ sku: "SKU-1", stock: 2 }],
    async save() {
      this.saveCount = (this.saveCount || 0) + 1;
    }
  };
  return { product, async findById() { return product; } };
};

const baseOrder = (overrides = {}) => ({
  _id: "order-1",
  user: "user-1",
  orderStatus: "Pending",
  paymentStatus: "AdvancePaid",
  remainingCodDue: 300,
  codAmountCollected: 0,
  shippedAt: null,
  deliveredAt: null,
  trackingHistory: [{ status: "Pending", message: "Order placed", timestamp: new Date("2026-01-01") }],
  items: [{ product: "product-1", variantSku: "SKU-1", quantity: 2 }],
  ...overrides
});

assert.equal(Order.schema.path("orderStatus").defaultValue, "Pending");
assert.deepEqual(baseOrder().trackingHistory.map((event) => event.status), ["Pending"]);
assert.doesNotThrow(() => assertOrderStatusTransition("Pending", "Design Review"));
assert.doesNotThrow(() => assertOrderStatusTransition("Pending", "Packing"));
assert.throws(() => assertOrderStatusTransition("Delivered", "Shipped"), /cannot change/);
assert.throws(() => assertOrderStatusTransition("Delivered", "Pending"), /cannot change/);
assert.throws(() => assertOrderStatusTransition("Cancelled", "Delivered"), /cannot change/);
assert.doesNotThrow(() => assertOrderStatusTransition("Pending", "Cancelled"));
assert.doesNotThrow(() => assertOrderStatusTransition("Design Review", "Cancelled"));
assert.doesNotThrow(() => assertOrderStatusTransition("Approved", "Cancelled"));
assert.throws(() => assertOrderStatusTransition("Printing", "Cancelled"), /before Printing/);
assert.throws(() => assertCanonicalOrderStatus("Out for Delivery"), /Invalid/);
assert.throws(() => assertCanonicalOrderStatus("In Transit"), /Invalid/);
assert.throws(() => validateTrackingUpdateInput({ status: "Delivered", message: "No" }), /controlled/);
assert.deepEqual(Object.keys(validateTrackingUpdateInput({ message: "Package handed to courier" })).sort(), ["message", "timestamp"]);

const earlyModel = createOrderModel(baseOrder());
const designReview = await transitionOrderStatus({ orderId: "order-1", nextStatus: "Design Review", OrderModel: earlyModel });
assert.equal(designReview.order.orderStatus, "Design Review");
assert.equal(designReview.order.trackingHistory.at(-1).status, "Design Review");
const skippedForward = await transitionOrderStatus({ orderId: "order-1", nextStatus: "Printing", OrderModel: earlyModel });
assert.equal(skippedForward.order.orderStatus, "Printing");
assert.equal(skippedForward.order.trackingHistory.at(-1).status, "Printing");

const nowShipped = new Date("2026-02-01T10:00:00.000Z");
const model = createOrderModel(baseOrder({ orderStatus: "Packing" }));
const shipped = await transitionOrderStatus({ orderId: "order-1", nextStatus: "Shipped", now: nowShipped, OrderModel: model });
assert.equal(shipped.changed, true);
assert.equal(shipped.order.orderStatus, "Shipped");
assert.equal(shipped.order.trackingHistory.at(-1).status, "Shipped");
assert.equal(new Date(shipped.order.shippedAt).toISOString(), nowShipped.toISOString());
assert.equal(shipped.order.remainingCodDue, 300);
assert.equal(shipped.order.paymentStatus, "AdvancePaid");

const duplicateShipped = await transitionOrderStatus({ orderId: "order-1", nextStatus: "Shipped", OrderModel: model });
assert.equal(duplicateShipped.changed, false);
assert.equal(model.snapshot().trackingHistory.filter((event) => event.status === "Shipped").length, 1);
assert.equal(model.snapshot().shippedAt.toISOString(), nowShipped.toISOString());

const nowDelivered = new Date("2026-02-03T10:00:00.000Z");
const delivered = await transitionOrderStatus({ orderId: "order-1", nextStatus: "Delivered", now: nowDelivered, OrderModel: model });
assert.equal(delivered.order.trackingHistory.at(-1).status, "Delivered");
assert.equal(new Date(delivered.order.deliveredAt).toISOString(), nowDelivered.toISOString());
assert.equal(delivered.order.paymentStatus, "AdvancePaid");
assert.equal(delivered.order.remainingCodDue, 300);
assert.equal(delivered.order.codAmountCollected, 0);

const duplicateDelivered = await transitionOrderStatus({ orderId: "order-1", nextStatus: "Delivered", OrderModel: model });
assert.equal(duplicateDelivered.changed, false);
assert.equal(model.snapshot().trackingHistory.filter((event) => event.status === "Delivered").length, 1);
assert.doesNotThrow(() => assertReviewOrderEligible({ ...model.snapshot(), paymentStatus: "Paid", remainingCodDue: 0 }, "product-1"));
assert.throws(() => assertReviewOrderEligible(model.snapshot(), "product-1"), /fully paid/);

const concurrentModel = createOrderModel(baseOrder({ orderStatus: "Packing" }));
const concurrentResults = await Promise.all([
  transitionOrderStatus({ orderId: "order-1", nextStatus: "Shipped", OrderModel: concurrentModel }),
  transitionOrderStatus({ orderId: "order-1", nextStatus: "Shipped", OrderModel: concurrentModel })
]);
assert.equal(concurrentResults.filter((result) => result.changed).length, 1);
assert.equal(concurrentModel.snapshot().trackingHistory.filter((event) => event.status === "Shipped").length, 1);

for (const message of ["Order cancelled by Admin.", "Cancellation approved by Cantley."]) {
  const cancellationModel = createOrderModel(baseOrder());
  const products = createProductModel();
  const [first, duplicate] = await Promise.all([
    transitionOrderStatus({ orderId: "order-1", nextStatus: "Cancelled", message, OrderModel: cancellationModel, ProductModel: products }),
    transitionOrderStatus({ orderId: "order-1", nextStatus: "Cancelled", message, OrderModel: cancellationModel, ProductModel: products })
  ]);
  assert.equal(Number(first.changed) + Number(duplicate.changed), 1);
  assert.equal(cancellationModel.snapshot().trackingHistory.filter((event) => event.status === "Cancelled").length, 1);
  assert.equal(products.product.variants[0].stock, 4);
  assert.equal(products.product.saveCount, 1);
}

console.log("Order/tracking tests passed.");
console.log("Coverage classification:");
console.log("PURE ASSERTION: canonical validation, transition rules, tracking-note validation, review eligibility.");
console.log("MOCKED MODEL: atomic status/history/timestamps, duplicate requests, COD fields unchanged, cancellation inventory once.");
console.log("REAL DATABASE: not run by this script.");
console.log("REAL HTTP: not run by this script; route authorization is covered by existing middleware wiring, not an HTTP harness.");
