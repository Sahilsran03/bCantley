import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { calculateCodTerms } from "../services/cod.service.js";
import { assertCurrentCartVersion, buildCheckoutPreview } from "../services/checkout-preview.service.js";
import { validateCheckoutPreviewInput } from "../validators/order.validator.js";

const item = (codAdvanceAmount, quantity = 1, codAvailable = true) => ({
  name: "Test product",
  codAdvanceAmount,
  quantity,
  codAvailable
});
const preview = (orderItems, pricingTotal = 350, shippingFee = 50) => buildCheckoutPreview({
  pricing: { totalAmount: pricingTotal },
  shipping: { shippingFee, estimatedDeliveryDate: null },
  orderItems
});

assert.deepEqual(preview([item(0)]), {
  totalAmount: 400, shippingFee: 50, isCODAvailable: true, onlineAdvanceRequired: 0,
  onlineAmountPaid: 0, currentUnpaidBalance: 400, codDueAfterAdvance: 400,
  estimatedDeliveryDate: null, preview: true
});
assert.equal(preview([item(100)]).codDueAfterAdvance, 300);
assert.equal(preview([item(400)]).codDueAfterAdvance, 0);
assert.equal(preview([item(60, 2)]).onlineAdvanceRequired, 120);
assert.equal(preview([item(500)]).onlineAdvanceRequired, 400);
assert.throws(() => preview([item(0), item(0, 1, false)]), /not available for COD/);
assert.equal(calculateCodTerms({ orderItems: [item(100)], totalAmount: 400 }).onlineAdvanceRequired, preview([item(100)]).onlineAdvanceRequired);
assert.doesNotThrow(() => assertCurrentCartVersion({ version: 3 }, 3));
assert.throws(() => assertCurrentCartVersion({ version: 3 }, 2), /Cart has changed/);
assert.equal(preview([item(100)], 300, 100).totalAmount, 400, "server pricing plus shipping determines total");
assert.equal(preview([item(100)], 250, 50).totalAmount, 300, "coupon-adjusted pricing is retained");

const sanitized = validateCheckoutPreviewInput({
  postalCode: "110001", country: "India", couponCode: "save10", expectedCartVersion: 2,
  totalAmount: 1, shippingFee: 1, onlineAdvanceRequired: 1, remainingCodDue: 1
});
assert.deepEqual(sanitized, { paymentMethod: "COD", postalCode: "110001", country: "India", couponCode: "SAVE10", expectedCartVersion: 2 });

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const sources = Object.fromEntries(await Promise.all([
  "frontend/src/pages/Checkout.jsx",
  "frontend/src/components/CodAdvancePayment.jsx",
  "frontend/src/pages/MyOrders.jsx",
  "frontend/src/pages/Home.jsx",
  "frontend/src/data/customerPolicies.js",
  "frontend/src/utils/razorpay.js",
  "backend/src/controllers/order.controller.js"
].map(async (path) => [path, await readFile(join(root, path), "utf8")])));

assert.doesNotMatch(sources["frontend/src/pages/Checkout.jsx"], /Math\.max\(100|0\.2|20%|Rs\. 100/);
assert.match(sources["frontend/src/components/CodAdvancePayment.jsx"], /Advance payment pending/);
assert.match(sources["frontend/src/components/CodAdvancePayment.jsx"], /Advance paid/);
assert.match(sources["frontend/src/components/CodAdvancePayment.jsx"], /Fully paid/);
assert.match(sources["frontend/src/components/CodAdvancePayment.jsx"], /Order cancelled/);
assert.doesNotMatch(sources["frontend/src/pages/MyOrders.jsx"], /advanceAmount|remainingAmount/);
assert.doesNotMatch(sources["frontend/src/pages/Home.jsx"] + sources["frontend/src/data/customerPolicies.js"], /manual advance confirmation|₹100 or 20%/i);
assert.match(sources["frontend/src/components/CodAdvancePayment.jsx"], /initiated\.amount/);
assert.match(sources["frontend/src/components/CodAdvancePayment.jsx"], /amount: amountPaise/);

const previewController = sources["backend/src/controllers/order.controller.js"].slice(
  sources["backend/src/controllers/order.controller.js"].indexOf("export const checkoutPreview"),
  sources["backend/src/controllers/order.controller.js"].indexOf("const createTransactionalCheckout")
);
for (const forbidden of ["Order.create", "Payment.create", "reduceStock(", "incrementCouponUsage(", "cart.save("]) {
  assert.doesNotMatch(previewController, new RegExp(forbidden.replace("(", "\\(")), `preview must not call ${forbidden}`);
}
const itemBuilder = sources["backend/src/controllers/order.controller.js"].slice(
  sources["backend/src/controllers/order.controller.js"].indexOf("const buildOrderItemsAndStockUpdates"),
  sources["backend/src/controllers/order.controller.js"].indexOf("const reduceStock")
);
assert.doesNotMatch(itemBuilder, /stock\s*[-+]=|\.save\(/, "preview item preparation must remain read-only");
const finalCheckout = sources["backend/src/controllers/order.controller.js"].slice(
  sources["backend/src/controllers/order.controller.js"].indexOf("export const checkout =")
);
assert.match(finalCheckout, /calculateCodTerms\(\{\s*orderItems:\s*pricedOrderItems,\s*totalAmount\s*\}\)/, "final checkout recalculates COD terms");
assert.match(finalCheckout, /await reduceStock\(stockUpdates\)/, "only final checkout applies stock changes");

console.log("COD customer messaging tests passed.");
console.log("PURE ASSERTION: COD examples, quantity, cap, mixed cart, version validation, payload allowlist.");
console.log("STATIC ASSERTION: preview has no checkout writes; UI copy, legacy-field removal, and Razorpay initiated amount wiring.");
console.log("MOCKED MODEL: not used. REAL DATABASE: not run. REAL HTTP: not run.");
