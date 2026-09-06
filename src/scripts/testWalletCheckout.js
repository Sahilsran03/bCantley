import assert from "node:assert/strict";
import fs from "node:fs";
import { createPaidWalletCheckout, respondForExistingAttempt } from "../controllers/order.controller.js";
import { createWalletService } from "../services/wallet.service.js";
import { makeWalletHarness, walletUserId } from "./helpers/walletHarness.js";
import { buildCheckoutPreview, assertShippingForPaymentMethod } from "../services/checkout-preview.service.js";
import { validateCheckoutInput, validateCheckoutPreviewInput } from "../validators/order.validator.js";
import { emailTemplates } from "../services/email.service.js";
import { transitionOrderStatus } from "../services/order-status.service.js";
import Order from "../models/Order.js";
import ReturnRequest from "../models/ReturnRequest.js";
import { createReturnRequest } from "../controllers/return.controller.js";

const payload = { paymentMethod: "WALLET", expectedCartVersion: 3, couponCode: "SAVE50", notes: "",
  shippingAddress: { fullName: "Test Customer", phone: "9999999999", email: "test@example.com", addressLine1: "Test",
    addressLine2: "", city: "Delhi", state: "Delhi", country: "India", postalCode: "110001" } };
const shipping = { isServiceable: true, isInternational: false, isCODAvailable: false, shippingFee: 50 };
const pricing = { subtotal: 400, discountAmount: 50, totalAmount: 350,
  appliedCoupon: { code: "SAVE50", type: "FIXED", value: 50, discountAmount: 50 }, appliedOffers: [] };
const product = "222222222222222222222222";
const item = { product, name: "Test", productType: "other", quantity: 1, unitPrice: 400, finalPrice: 400, codAvailable: false, variantSku: "SKU-1" };
const preview = (walletBalance) => buildCheckoutPreview({ pricing, shipping, orderItems: [item], paymentMethod: "WALLET", walletBalance });
assertShippingForPaymentMethod(shipping, "WALLET");
assert.throws(() => assertShippingForPaymentMethod(shipping, "COD"), /COD/);
assert.throws(() => assertShippingForPaymentMethod({ ...shipping, isServiceable: false }, "WALLET"), /Shipping/);
assert.equal(preview(1000).walletAmountRequired, 400); assert.equal(preview(1000).walletBalanceAfterPayment, 600);
assert.equal(preview(250).isWalletSufficient, false); assert.equal(preview(250).walletBalanceAfterPayment, null);
assert.equal(preview(500).isWalletSufficient, true);
const untrusted = { walletBalance: 99999, walletAmountRequired: 1, walletBalanceAfterPayment: 99998, isWalletSufficient: true,
  totalAmount: 1, shippingFee: 0, discount: 999, stock: 999, paymentStatus: "Paid", walletPayment: product, purpose: "REWARD_CREDIT", amount: 1 };
assert.deepEqual(validateCheckoutInput({ ...payload, ...untrusted }), validateCheckoutInput(payload));
const previewInput = { postalCode: "110001", expectedCartVersion: 3, paymentMethod: "WALLET" };
assert.deepEqual(validateCheckoutPreviewInput({ ...previewInput, ...untrusted }), validateCheckoutPreviewInput(previewInput));
assert.throws(() => validateCheckoutPreviewInput({ ...previewInput, paymentMethod: "SPLIT" }), /Invalid payment/);
assert(Order.schema.path("paymentMethod").enumValues.includes("WALLET"));
assert.equal(Order.schema.path("walletPayment").options.ref, "WalletTransaction");

const makeHarness = ({ balance = 1000, failure = "" } = {}) => {
  const h = makeWalletHarness({ balance }); const { state } = h;
  Object.assign(state, { stock: 5, soldCount: 0, orders: [], attempts: [], couponUses: 0,
    cart: { version: 3, items: [{ unitPrice: 999, quantity: 1 }], appliedCouponCode: "SAVE50" } });
  const active = (options) => assert.equal(options?.session?.inTransaction(), true);
  const query = (get) => ({ session(value) { active({ session: value }); return this; }, populate() { return this; },
    then(resolve, reject) { return Promise.resolve().then(get).then(resolve, reject); } });
  const cartDoc = () => ({ ...structuredClone(state.cart), async save(options) { active(options); if (failure === "cart") throw new Error("cart failure");
    const { save, ...data } = this; state.cart = data; } });
  const CartModel = { findOne: () => query(cartDoc) };
  const CheckoutAttemptModel = {
    async create([data], options) { active(options);
      if (state.attempts.some((entry) => entry.key === data.key)) throw Object.assign(new Error("duplicate"), { code: 11000 });
      state.attempts.push({ ...data });
      return [{ ...data, async save(options) { active(options); if (failure === "attempt") throw new Error("attempt failure");
        const { save, ...values } = this; state.attempts[state.attempts.findIndex((entry) => entry.key === data.key)] = values; } }];
    },
    findOne: ({ key }) => query(() => state.attempts.find((entry) => entry.key === key))
  };
  const OrderModel = {
    findOne: ({ checkoutIdempotencyKey, _id }) => query(() => state.orders.find((entry) => checkoutIdempotencyKey ? entry.checkoutIdempotencyKey === checkoutIdempotencyKey : String(entry._id) === String(_id)) || null),
    async create([data], options) { active(options); if (failure === "order") throw new Error("order failure");
      const order = { ...data, _id: String(data._id) }; state.orders.push(order); return [order]; }
  };
  const ledgerCreate = h.LedgerModel.create;
  h.LedgerModel.create = ([data], options) => ledgerCreate([{ ...data, order: String(data.order) }], options);
  const wallet = createWalletService(h);
  const dependencies = { CartModel, CheckoutAttemptModel, OrderModel, startSession: h.startSession, debit: wallet.debitWallet,
    buildItems: async (cart, options) => { active(options); assert.equal(options.strictInventory, true);
      if (failure === "stock-check") throw new Error("stock-check failure");
      return { orderItems: [{ ...item }], stockUpdates: [{ productId: product, sku: "SKU-1", quantity: 1 }] }; },
    calculatePricing: async (cart, code, options) => { active(options); assert.equal(cart.items[0].unitPrice, 400); assert.equal(code, "SAVE50"); return pricing; },
    checkShipping: async (postalCode, country, options) => { active(options); return shipping; },
    reduceInventory: async (updates, options) => { active(options); state.stock -= 1; if (failure === "stock-write") throw new Error("stock-write failure"); },
    incrementSales: async (items, options) => { active(options); state.soldCount += items[0].quantity; if (failure === "sales") throw new Error("sales failure"); },
    incrementCoupon: async (code, options) => { active(options); state.couponUses += 1; if (failure === "coupon") throw new Error("coupon failure"); },
    orderNumberFactory: async () => "CNT-WALLET-TEST", notify: async () => {}, sendEmail: async () => {},
    respondExisting: (res, userId, attempt, fingerprint) => respondForExistingAttempt(res, userId, attempt, fingerprint, { OrderModel }) };
  const responses = []; const res = { status(code) { this.code = code; return this; }, json(body) { responses.push(body); } };
  const execute = ({ key = "11111111-1111-4111-8111-111111111111", version = 3, fingerprint = "fingerprint" } = {}) => createPaidWalletCheckout({
    req: { user: { _id: walletUserId } }, res, payload: { ...payload, expectedCartVersion: version }, key, fingerprint, dependencies });
  return { state, execute, responses, wallet, dependencies };
};
const h = makeHarness(); await h.execute(); const order = h.responses[0].order;
assert.equal(order.totalAmount, 400); assert.equal(h.state.users[walletUserId].walletBalance, 600);
assert.equal(order.paymentStatus, "Paid"); assert.equal(order.paymentMethod, "WALLET"); assert.equal(order.inventoryStatus, "Committed");
assert.equal(order.inventoryReservationExpiresAt, undefined);
for (const field of ["onlineAmountPaid", "onlineAdvanceRequired", "remainingCodDue", "potentialCodAmount", "codAmountCollected", "remainingAmount", "codDueAfterRequiredAdvance"]) assert.equal(order[field], 0);
assert.equal(order.onlinePayment, null); assert.equal(order.walletPayment, h.state.entries[0]._id);
assert.equal(h.state.entries[0].order, order._id); assert.equal(h.state.entries[0].purpose, "ORDER_PAYMENT");
assert.equal(h.state.entries[0].direction, "DEBIT"); assert.equal(h.state.entries[0].amount, 400);
assert.equal(h.state.entries[0].balanceBefore, 1000); assert.equal(h.state.entries[0].balanceAfter, 600);
assert.equal(h.state.stock, 4); assert.equal(h.state.soldCount, 1); assert.equal(h.state.couponUses, 1);
assert.equal(h.state.cart.items.length, 0); assert.equal(h.state.cart.version, 4); assert.equal(h.state.attempts[0].status, "Completed");
await h.execute(); assert.equal(h.responses.at(-1).order._id, order._id);
h.state.attempts = []; await h.execute(); assert.equal(h.responses.at(-1).order._id, order._id);
assert.equal(h.state.entries.length, 1); assert.equal(h.state.orders.length, 1); assert.equal(h.state.users[walletUserId].walletBalance, 600);
assert.equal(h.state.stock, 4); assert.equal(h.state.soldCount, 1); assert.equal(h.state.couponUses, 1);
await assert.rejects(h.execute({ fingerprint: "different" }), /different checkout/);
for (const failure of ["stock-check", "stock-write", "order", "sales", "coupon", "cart", "attempt"]) {
  const failing = makeHarness({ failure }); await assert.rejects(failing.execute(), /failure/);
  assert.equal(failing.state.users[walletUserId].walletBalance, 1000, failure);
  assert.equal(failing.state.entries.length, 0); assert.equal(failing.state.orders.length, 0); assert.equal(failing.state.attempts.length, 0);
  assert.equal(failing.state.stock, 5); assert.equal(failing.state.soldCount, 0); assert.equal(failing.state.couponUses, 0);
  assert.equal(failing.state.cart.version, 3); assert.equal(failing.state.cart.items[0].unitPrice, 999);
}
const insufficient = makeHarness({ balance: 250 }); await assert.rejects(insufficient.execute(), /Insufficient/);
assert.equal(insufficient.state.entries.length, 0); assert.equal(insufficient.state.orders.length, 0); assert.equal(insufficient.state.stock, 5);
assert.equal(insufficient.state.cart.items.length, 1); assert.equal(insufficient.state.couponUses, 0); assert.equal(insufficient.state.soldCount, 0);
const race = makeHarness({ balance: 500 }); assert.equal(preview(500).isWalletSufficient, true);
await race.wallet.debitWallet({ userId: walletUserId, amount: 200, purpose: "ORDER_PAYMENT", orderId: product, idempotencyKey: "other-operation" });
await assert.rejects(race.execute(), /Insufficient/); assert.equal(race.state.users[walletUserId].walletBalance, 300);
assert.equal(race.state.entries.length, 1); assert.equal(race.state.orders.length, 0); assert.equal(race.state.cart.items.length, 1);
const concurrent = makeHarness({ balance: 500 });
// Supply two distinct authoritative carts to isolate wallet contention from Cart-version conflicts.
concurrent.dependencies.CartModel.findOne = () => { const doc = { version: 3, items: [{ unitPrice: 999, quantity: 1 }], appliedCouponCode: "SAVE50", async save() {} };
  return { populate() { return this; }, session() { return this; }, then(resolve, reject) { return Promise.resolve(doc).then(resolve, reject); } }; };
const competing = await Promise.allSettled([concurrent.execute(), concurrent.execute({ key: "22222222-2222-4222-8222-222222222222" })]);
assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
assert.match(competing.find((result) => result.status === "rejected").reason.message, /Insufficient/);
assert.equal(concurrent.state.users[walletUserId].walletBalance, 100); assert.equal(concurrent.state.entries.length, 1);
assert.equal(concurrent.state.orders.length, 1); assert.equal(concurrent.state.stock, 4); assert.equal(concurrent.state.soldCount, 1); assert.equal(concurrent.state.couponUses, 1);
const versionConflict = makeHarness(); await assert.rejects(versionConflict.execute({ version: 2 }), /Cart has changed/);
assert.equal(versionConflict.state.entries.length, 0); assert.equal(versionConflict.state.attempts.length, 0);
const recoverable = makeHarness(); const originalCreate = recoverable.dependencies.OrderModel.create;
recoverable.dependencies.OrderModel.create = async () => { throw new Error("temporary failure"); };
await assert.rejects(recoverable.execute(), /temporary failure/);
recoverable.dependencies.OrderModel.create = originalCreate; await recoverable.execute();
assert.equal(recoverable.state.entries.length, 1); assert.equal(recoverable.state.users[walletUserId].walletBalance, 600);
const duplicate = makeHarness(); await Promise.all([duplicate.execute(), duplicate.execute()]); assert.equal(duplicate.state.entries.length, 1);
const email = emailTemplates.orderConfirmation(order); assert.match(email.text, /Payment method: Wallet/); assert.match(email.text, /Payment status: Paid/);
assert.doesNotMatch(email.text, /COD|Razorpay|advance|payable on delivery/i);
await assert.rejects(transitionOrderStatus({ orderId: order._id, nextStatus: "Cancelled", OrderModel: { findById: async () => ({ ...order, orderStatus: "Printing" }),
  findOneAndUpdate: async () => assert.fail("Wallet cancellation must not mutate Order") } }), /before Printing/);
const originalFindOrder = Order.findOne; const originalCreateReturn = ReturnRequest.create;
Order.findOne = async () => ({ ...order, orderStatus: "Printing" });
ReturnRequest.create = async () => assert.fail("Wallet cancellation must not create a NotRequired refund request");
try {
  await assert.rejects(new Promise((resolve, reject) => createReturnRequest({ user: { _id: walletUserId },
    body: { order: order._id, type: "CANCEL", reason: "Please cancel my order" } },
    { status() { return this; }, json: resolve }, reject)), /before Printing/);
} finally { Order.findOne = originalFindOrder; ReturnRequest.create = originalCreateReturn; }
const controller = fs.readFileSync(new URL("../controllers/order.controller.js", import.meta.url), "utf8");
const transactional = controller.slice(controller.indexOf("const createTransactionalCheckout"), controller.indexOf("export const createPendingOnlineCheckout"));
assert.doesNotMatch(transactional, /Payment\.(create|save)|razorpay\.|createRazorpayClient|\$inc.*walletBalance/);
assert.match(controller, /User\.findById\(req.user._id\)\.select\("walletBalance"\)/);
assert.match(controller, /walletBalance: walletUser\?\.walletBalance/);
console.log("Wallet preview, security allowlists, paid checkout, exact debit, retries, failure rollback, legacy spending, contention, email and cancellation safety passed.");
console.log("Actual wallet/checkout services with serialized rollback model mocks; no real MongoDB contention, provider calls or live financial writes.");
