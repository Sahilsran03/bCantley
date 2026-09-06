import assert from "node:assert/strict";
import { respondForExistingAttempt } from "../controllers/order.controller.js";
import { releaseOnlineInventoryReservation } from "../services/inventory-reservation.service.js";

const makeHarness = ({ expired = false, released = false, fallback = false, paidRace = false } = {}) => {
  const order = {
    _id: "order-1", user: "user-1", checkoutIdempotencyKey: "key-1",
    paymentMethod: "ONLINE", paymentStatus: "Pending", inventoryStatus: released ? "Released" : "Reserved",
    inventoryReservationExpiresAt: new Date(Date.now() + (expired ? -1000 : 1200000)),
    items: [{ product: "product-1", variantSku: "sku-1", quantity: 2 }], totalAmount: 500
  };
  const product = { variants: [{ sku: "sku-1", stock: 3 }], async save() {} };
  let releases = 0;
  const OrderModel = {
    async findOne(query) { assert.equal(query.user, "user-1"); return fallback && query.checkoutIdempotencyKey ? null : order; },
    async findById() { return order; },
    async findOneAndUpdate(query, update) {
      if (paidRace) { order.paymentStatus = "Paid"; order.inventoryStatus = "Committed"; return null; }
      if (order.inventoryStatus !== query.inventoryStatus || order.inventoryReservationExpiresAt > query.inventoryReservationExpiresAt.$lte) return null;
      Object.assign(order, update.$set); releases += 1; return order;
    }
  };
  const dependencies = {
    OrderModel,
    releaseReservation: (args) => releaseOnlineInventoryReservation({ ...args, dependencies: {
      OrderModel, ProductModel: { findById: async () => product }, startSession: null
    } })
  };
  const attempt = { key: "key-1", requestFingerprint: "fingerprint", status: "Completed", order: order._id };
  const responses = [];
  const res = { status(code) { assert.equal(code, 201); return this; }, json(body) { responses.push(body); } };
  return { order, product, attempt, responses, releases: () => releases,
    run: (fingerprint = "fingerprint") => respondForExistingAttempt(res, "user-1", attempt, fingerprint, dependencies) };
};
const active = makeHarness();
await active.run(); await active.run();
assert.equal(active.responses[0].order._id, active.responses[1].order._id);
assert.equal(active.product.variants[0].stock, 3);
await assert.rejects(active.run("different"), /different checkout request/);
for (const fallback of [false, true]) {
  const expired = makeHarness({ expired: true, fallback });
  await assert.rejects(expired.run(), /expired/);
  assert.equal(expired.order.inventoryStatus, "Released");
  assert.equal(expired.product.variants[0].stock, 5);
  assert.equal(expired.responses.length, 0);
  await assert.rejects(expired.run(), /no longer payable/);
  assert.equal(expired.product.variants[0].stock, 5);
  assert.equal(expired.releases(), 1);
}
const released = makeHarness({ released: true });
await assert.rejects(released.run(), /no longer payable/);
assert.equal(released.releases(), 0);
const invalidExpiry = makeHarness();
invalidExpiry.order.inventoryReservationExpiresAt = null;
await assert.rejects(invalidExpiry.run(), /expiry is invalid/);
const paidRace = makeHarness({ expired: true, paidRace: true });
await paidRace.run();
assert.equal(paidRace.responses[0].order.paymentStatus, "Paid");
assert.equal(paidRace.product.variants[0].stock, 3);
const cod = makeHarness({ expired: true });
cod.order.paymentMethod = "COD";
await cod.run();
assert.equal(cod.releases(), 0);
console.log("Online checkout retry, expiry release, fallback and settlement-race assertions passed.");
