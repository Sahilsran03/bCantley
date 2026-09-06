import assert from "node:assert/strict";
import { collectRemainingCod } from "../services/cod-collection.service.js";
import { validateCodCollection } from "../validators/order.validator.js";

const adminId = "admin_test";
const now = new Date("2026-09-02T12:00:00.000Z");

const baseOrder = (overrides = {}) => ({
  _id: "order_test",
  paymentMethod: "COD",
  orderStatus: "Delivered",
  paymentStatus: "AdvancePaid",
  totalAmount: 400,
  onlineAdvanceRequired: 100,
  onlineAmountPaid: 100,
  remainingCodDue: 300,
  codAmountCollected: 0,
  potentialCodAmount: 300,
  advanceAmount: 100,
  remainingAmount: 300,
  codCollectedAt: null,
  codCollectedBy: null,
  ...overrides
});

const makeAtomicOrderModel = (initialOrder) => {
  let state = initialOrder ? { ...initialOrder } : null;
  return {
    async findOneAndUpdate(query) {
      if (!state) return null;
      const invariant = state.onlineAmountPaid + state.codAmountCollected + state.remainingCodDue === state.totalAmount;
      const eligible =
        state._id === query._id &&
        state.paymentMethod === "COD" &&
        state.orderStatus === "Delivered" &&
        query.paymentStatus.$in.includes(state.paymentStatus) &&
        state.remainingCodDue === query.remainingCodDue &&
        state.remainingCodDue > 0 &&
        state.onlineAmountPaid >= state.onlineAdvanceRequired &&
        invariant;
      if (!eligible) return null;

      state = {
        ...state,
        codAmountCollected: state.codAmountCollected + state.remainingCodDue,
        remainingCodDue: 0,
        potentialCodAmount: 0,
        paymentStatus: "Paid",
        codCollectedAt: now,
        codCollectedBy: adminId
      };
      return { ...state };
    },
    async findById(orderId) {
      return state?._id === orderId ? { ...state } : null;
    },
    current() {
      return state ? { ...state } : null;
    }
  };
};

const collect = (model, amount = 300) =>
  collectRemainingCod({ orderId: "order_test", adminId, amount, now, OrderModel: model });

for (const invalid of [0, -1, 1.5, "300", "garbage", NaN, Infinity, null]) {
  assert.throws(() => validateCodCollection({ amount: invalid }), undefined, `invalid amount ${String(invalid)}`);
}
assert.deepEqual(validateCodCollection({ amount: 300 }), { amount: 300 });

const advanceModel = makeAtomicOrderModel(baseOrder());
const advanceResult = await collect(advanceModel);
assert.equal(advanceResult.onlineAmountPaid, 100);
assert.equal(advanceResult.codAmountCollected, 300);
assert.equal(advanceResult.remainingCodDue, 0);
assert.equal(advanceResult.potentialCodAmount, 0);
assert.equal(advanceResult.paymentStatus, "Paid");
assert.equal(advanceResult.codCollectedAt.getTime(), now.getTime());
assert.equal(advanceResult.codCollectedBy, adminId);
assert.equal(advanceResult.onlineAmountPaid + advanceResult.codAmountCollected + advanceResult.remainingCodDue, 400);
assert.equal(advanceResult.advanceAmount, 100, "legacy advanceAmount must remain unchanged");
assert.equal(advanceResult.remainingAmount, 300, "legacy remainingAmount must remain unchanged");
await assert.rejects(collect(advanceModel), (error) => error.statusCode === 409, "duplicate collection");

const fullCodModel = makeAtomicOrderModel(baseOrder({
  paymentStatus: "Pending",
  onlineAdvanceRequired: 0,
  onlineAmountPaid: 0,
  remainingCodDue: 400,
  potentialCodAmount: 400,
  advanceAmount: 100,
  remainingAmount: 300
}));
const fullCodResult = await collect(fullCodModel, 400);
assert.equal(fullCodResult.codAmountCollected, 400);
assert.equal(fullCodResult.remainingCodDue, 0);
assert.equal(fullCodResult.paymentStatus, "Paid");
assert.equal(fullCodResult.onlineAmountPaid + fullCodResult.codAmountCollected + fullCodResult.remainingCodDue, 400);

for (const [label, order, amount, message] of [
  ["partial amount", baseOrder(), 200, /does not match/],
  ["amount greater than due", baseOrder(), 400, /does not match/],
  ["advance unpaid", baseOrder({ onlineAmountPaid: 0, remainingCodDue: 400 }), 400, /advance must be paid/],
  ["not Delivered", baseOrder({ orderStatus: "Shipped" }), 300, /Delivered/],
  ["Cancelled", baseOrder({ orderStatus: "Cancelled" }), 300, /Delivered/],
  ["already collected", baseOrder({ paymentStatus: "Paid", remainingCodDue: 0, codAmountCollected: 300, potentialCodAmount: 0 }), 300, /already/],
  ["inconsistent finances", baseOrder({ remainingCodDue: 250 }), 250, /requires reconciliation/]
]) {
  await assert.rejects(collect(makeAtomicOrderModel(order), amount), message, label);
}

const concurrentModel = makeAtomicOrderModel(baseOrder());
const concurrent = await Promise.allSettled([collect(concurrentModel), collect(concurrentModel)]);
assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1, "only one mocked atomic collection succeeds");
assert.equal(concurrent.filter((result) => result.status === "rejected" && result.reason.statusCode === 409).length, 1);
assert.equal(concurrentModel.current().codAmountCollected, 300);

await assert.rejects(
  collectRemainingCod({ orderId: "missing", adminId, amount: 300, now, OrderModel: makeAtomicOrderModel(null) }),
  (error) => error.statusCode === 404,
  "nonexistent Order"
);

console.log("COD-5 Admin collection service assertions passed (atomic model mocked; no real MongoDB concurrency test).");
