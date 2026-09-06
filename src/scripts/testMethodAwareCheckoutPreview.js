import assert from "node:assert/strict";
import { validateCheckoutInput, validateCheckoutPreviewInput } from "../validators/order.validator.js";
import { assertShippingForPaymentMethod, buildCheckoutPreview } from "../services/checkout-preview.service.js";

const address = {
  fullName: "Test Customer", phone: "9999999999", email: "test@example.com",
  addressLine1: "Test", city: "Delhi", state: "Delhi", country: "India", postalCode: "110001"
};
assert.equal(validateCheckoutInput({ shippingAddress: address, expectedCartVersion: 1 }).paymentMethod, "COD");
assert.equal(validateCheckoutPreviewInput({ postalCode: "110001", expectedCartVersion: 1 }).paymentMethod, "COD");
assert.equal(validateCheckoutInput({ shippingAddress: address, expectedCartVersion: 1, paymentMethod: "ONLINE" }).paymentMethod, "ONLINE");
assert.equal(validateCheckoutPreviewInput({ postalCode: "110001", expectedCartVersion: 1, paymentMethod: "ONLINE" }).paymentMethod, "ONLINE");
assert.equal(validateCheckoutInput({ shippingAddress: address, expectedCartVersion: 1, paymentMethod: "WALLET" }).paymentMethod, "WALLET");
assert.equal(validateCheckoutPreviewInput({ postalCode: "110001", expectedCartVersion: 1, paymentMethod: "WALLET" }).paymentMethod, "WALLET");
for (const value of ["WALLET+ONLINE", "OTHER", "cod", 1, 0, false, null, "", " COD ", [], ["ONLINE"], {}]) {
  assert.throws(() => validateCheckoutInput({ shippingAddress: address, expectedCartVersion: 1, paymentMethod: value }), /Invalid payment method/);
  assert.throws(() => validateCheckoutPreviewInput({ postalCode: "110001", expectedCartVersion: 1, paymentMethod: value }), /Invalid payment method/);
}

const codUnavailableShipping = {
  isServiceable: true, isInternational: false, isCODAvailable: false,
  shippingFee: 50, estimatedDeliveryDate: new Date("2026-09-10T00:00:00.000Z")
};
assert.throws(() => assertShippingForPaymentMethod(codUnavailableShipping, "COD"), /COD is not available/);
assert.doesNotThrow(() => assertShippingForPaymentMethod(codUnavailableShipping, "ONLINE"));
assert.throws(() => assertShippingForPaymentMethod({ ...codUnavailableShipping, isServiceable: false, message: "Unavailable" }, "ONLINE"), /Unavailable/);

const pricing = { totalAmount: 350 };
const codEligibleItem = [{ name: "Eligible", codAvailable: true, codAdvanceAmount: 100, quantity: 1 }];
const codPreview = buildCheckoutPreview({ pricing, shipping: { ...codUnavailableShipping, isCODAvailable: true }, orderItems: codEligibleItem, paymentMethod: "COD" });
assert.equal(codPreview.totalAmount, 400);
assert.equal(codPreview.onlineAdvanceRequired, 100);
assert.equal(codPreview.codDueAfterAdvance, 300);
assert.equal(codPreview.currentUnpaidBalance, 400);

const codIneligibleItem = [{ name: "Online-only product", codAvailable: false, codAdvanceAmount: 0, quantity: 1 }];
assert.throws(() => buildCheckoutPreview({ pricing, shipping: { ...codUnavailableShipping, isCODAvailable: true }, orderItems: codIneligibleItem, paymentMethod: "COD" }), /not available for COD/);
const onlinePreview = buildCheckoutPreview({ pricing, shipping: codUnavailableShipping, orderItems: codIneligibleItem, paymentMethod: "ONLINE" });
assert.equal(onlinePreview.paymentMethod, "ONLINE");
assert.equal(onlinePreview.totalAmount, 400);
assert.equal(onlinePreview.onlineAmountRequired, 400);
assert.equal(onlinePreview.onlineAdvanceRequired, 0);
assert.equal(onlinePreview.currentUnpaidBalance, 400);
assert.equal(onlinePreview.codDueAfterAdvance, 0);
assert.equal(onlinePreview.remainingCodDue, 0);
assert.equal(onlinePreview.potentialCodAmount, 0);
assert.equal(onlinePreview.isCODAvailable, false, "COD availability remains informational for Online preview");

console.log("Method-aware checkout preview assertions passed.");

const forged = validateCheckoutInput({
  shippingAddress: address, expectedCartVersion: 1, paymentMethod: "ONLINE",
  totalAmount: 1, shippingFee: 0, discount: 99999, onlineAmountRequired: 1,
  paymentStatus: "Paid", inventoryStatus: "Committed", inventoryReservationExpiresAt: "2099-01-01",
  onlineAmountPaid: 500, remainingCodDue: 0, stock: 999, walletBalance: 999
});
for (const field of ["totalAmount", "shippingFee", "discount", "onlineAmountRequired", "paymentStatus",
  "inventoryStatus", "inventoryReservationExpiresAt", "onlineAmountPaid", "remainingCodDue", "stock", "walletBalance"]) {
  assert.equal(Object.hasOwn(forged, field), false);
}
console.log("Checkout financial and inventory input allowlist assertions passed.");
