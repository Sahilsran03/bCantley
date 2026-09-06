import assert from "node:assert/strict";
import Product from "../models/Product.js";
import Coupon from "../models/Coupon.js";
import Offer from "../models/Offer.js";
import ShippingZone from "../models/ShippingZone.js";
import { buildOrderItemsAndStockUpdates, reduceStock } from "../controllers/order.controller.js";
import { calculateCartPricing, incrementCouponUsage } from "../services/pricing.service.js";
import { checkShippingByPostalCode } from "../services/shipping.service.js";
import { withAuthoritativeCartPrices, buildCheckoutPreview } from "../services/checkout-preview.service.js";

const session = {};
let reads = 0;
const query = (value) => ({
  sort() { return this; },
  session(actual) { assert.equal(actual, session); reads += 1; return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});
const originals = [Product.findById, Coupon.findOne, Coupon.updateOne, Offer.find, ShippingZone.findOne];
const product = {
  _id: "product-1", name: "Test", productType: "other", basePrice: 300, isActive: true, codAvailable: false,
  soldCount: 7, variants: [{ sku: "sku-1", size: "M", stock: 3, priceModifier: 50 }],
  async save(options) { assert.equal(options.session, session); }
};
const coupon = { code: "SAVE50", type: "FIXED", value: 50, isActive: true, usedCount: 0, usageLimit: 1,
  excludedProducts: [], applicableProducts: [], applicableCategories: [] };
Product.findById = () => query(product);
Coupon.findOne = () => query(coupon);
Coupon.updateOne = async (filter, update, options) => { assert.equal(options.session, session); coupon.usedCount += update.$inc.usedCount; };
Offer.find = () => query([]);
ShippingZone.findOne = () => query({ isCODAvailable: false, shippingFee: 75, estimatedDays: 4 });
const cart = { items: [{ product, unitPrice: 1, quantity: 2, variantSku: "sku-1" }] };
try {
  const { orderItems, stockUpdates } = await buildOrderItemsAndStockUpdates(cart, { session, strictInventory: true });
  withAuthoritativeCartPrices(cart, orderItems);
  const pricing = await calculateCartPricing(cart, "SAVE50", { session });
  const shipping = await checkShippingByPostalCode("110001", "India", { session });
  const preview = buildCheckoutPreview({ pricing, shipping, orderItems, paymentMethod: "ONLINE" });
  assert.equal(pricing.subtotal, 700);
  assert.equal(pricing.discountAmount, 50);
  assert.equal(preview.totalAmount, 725);
  assert.equal(preview.onlineAmountRequired, 725);
  assert.equal(preview.isCODAvailable, false);
  await reduceStock(stockUpdates, { session });
  assert.equal(product.variants[0].stock, 1);
  assert.equal(product.soldCount, 7);
  await incrementCouponUsage("SAVE50", { session });
  await assert.rejects(calculateCartPricing(cart, "SAVE50", { session }), /usage limit/);
  product.variants[0].stock = 3;
  const duplicateLines = { items: [cart.items[0], { ...cart.items[0] }] };
  await assert.rejects(buildOrderItemsAndStockUpdates(duplicateLines, { session, strictInventory: true }), /enough stock/);
  product.variants.push({ ...product.variants[0] });
  await assert.rejects(buildOrderItemsAndStockUpdates(cart, { session, strictInventory: true }), /reconciliation/);
  product.variants.pop();
  cart.items[0].variantSku = "missing";
  await assert.rejects(buildOrderItemsAndStockUpdates(cart, { session, strictInventory: true }), /review variants/);
  cart.items[0].variantSku = "sku-1";
  cart.items[0].quantity = -1;
  await assert.rejects(buildOrderItemsAndStockUpdates(cart, { session, strictInventory: true }), /quantities/);
  assert(reads >= 8, "authoritative reads use the transaction session");
} finally {
  [Product.findById, Coupon.findOne, Coupon.updateOne, Offer.find, ShippingZone.findOne] = originals;
}
console.log("Authoritative Product, stock, coupon and shipping session assertions passed.");
