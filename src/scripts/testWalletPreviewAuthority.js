import assert from "node:assert/strict";
import Cart from "../models/Cart.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import Coupon from "../models/Coupon.js";
import Offer from "../models/Offer.js";
import ShippingZone from "../models/ShippingZone.js";
import { checkoutPreview } from "../controllers/order.controller.js";
const product = { _id: "222222222222222222222222", name: "Test", isActive: true, productType: "other", codAvailable: false,
  basePrice: 350, variants: [{ sku: "sku-1", priceModifier: 50, stock: 5 }] };
let balance = 1000;
const query = (value) => ({ populate() { return this; }, select() { return this; }, sort() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const originals = [Cart.findOne, User.findById, Product.findById, Coupon.findOne, Offer.find, ShippingZone.findOne];
Cart.findOne = () => query({ version: 3, items: [{ product, unitPrice: 1, quantity: 1, variantSku: "sku-1" }], appliedCouponCode: "SAVE50" });
User.findById = (id) => { assert.equal(id, "customer"); return query({ walletBalance: balance }); };
Product.findById = () => query(product);
Coupon.findOne = () => query({ code: "SAVE50", type: "FIXED", value: 50, isActive: true, usedCount: 0, usageLimit: 5,
  excludedProducts: [], applicableProducts: [], applicableCategories: [] });
Offer.find = () => query([]);
ShippingZone.findOne = () => query({ isCODAvailable: false, shippingFee: 50, estimatedDays: 4 });
const invoke = () => new Promise((resolve, reject) => checkoutPreview({ user: { _id: "customer", walletBalance: 999999 },
  body: { postalCode: "110001", expectedCartVersion: 3, paymentMethod: "WALLET", totalAmount: 1, walletBalance: 999999 } },
  { status(code) { assert.equal(code, 200); return this; }, json: resolve }, reject));
try {
  const sufficient = (await invoke()).preview;
  assert.equal(sufficient.walletBalance, 1000); assert.equal(sufficient.totalAmount, 400); assert.equal(sufficient.walletAmountRequired, 400);
  assert.equal(sufficient.isWalletSufficient, true); assert.equal(sufficient.walletBalanceAfterPayment, 600);
  balance = 250;
  const insufficient = (await invoke()).preview;
  assert.equal(insufficient.walletBalance, 250); assert.equal(insufficient.isWalletSufficient, false); assert.equal(insufficient.walletBalanceAfterPayment, null);
} finally { [Cart.findOne, User.findById, Product.findById, Coupon.findOne, Offer.find, ShippingZone.findOne] = originals; }
console.log("Wallet preview handler uses actual authoritative pricing/shipping/stock services and server User balance; forged body and stale auth balance ignored (mocked models).");
