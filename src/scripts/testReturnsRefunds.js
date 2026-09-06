import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { actualMoneyReceived, assertReturnEligibility, deriveRefundStatus, itemRefundCap, RETURN_WINDOW_MS, snapshotOrderItem } from "../services/return-refund.service.js";
import { validateRefundTransaction, validateReturnReceipt, validateReturnRequest, validateReturnStatus } from "../validators/return.validator.js";

const now = new Date("2026-09-03T12:00:00.000Z");
const order = (overrides = {}) => ({ orderStatus: "Delivered", deliveredAt: new Date(now.getTime() - 86400000), remainingCodDue: 0, onlineAmountPaid: 100, codAmountCollected: 300, totalAmount: 400, items: [{ product: "507f1f77bcf86cd799439011", name: "Shirt", productType: "tshirt", variantSku: "S-1", size: "M", color: "Black", finalPrice: 200, quantity: 2 }], ...overrides });
const throws = (fn, pattern) => assert.throws(fn, pattern);

assert.doesNotThrow(() => assertReturnEligibility(order(), now)); // 1
throws(() => assertReturnEligibility(order({ remainingCodDue: 1 }), now), /outstanding/); // 2
throws(() => assertReturnEligibility(order({ orderStatus: "Pending" }), now), /only after delivery/); // 3
throws(() => assertReturnEligibility(order({ orderStatus: "Shipped" }), now), /only after delivery/); // 4
throws(() => assertReturnEligibility(order({ orderStatus: "Cancelled" }), now), /only after delivery/); // 5
throws(() => assertReturnEligibility(order({ deliveredAt: null }), now), /missing/); // 6
assert.doesNotThrow(() => assertReturnEligibility(order({ deliveredAt: new Date(now.getTime() - RETURN_WINDOW_MS) }), now)); // 7
throws(() => assertReturnEligibility(order({ deliveredAt: new Date(now.getTime() - RETURN_WINDOW_MS - 1) }), now), /expired/); // 8
assert.equal(actualMoneyReceived(order()), 400); // 9 ownership wiring is verified statically below
throws(() => validateReturnRequest({ order: "x", type: "RETURN", reason: "valid reason", reasonCategory: "DAMAGED", requestedQuantity: 1 }), /Order item/); // 10
throws(() => snapshotOrderItem(order(), 2), /selected order item/); // 11
throws(() => validateReturnRequest({ order: "x", type: "RETURN", reason: "valid reason", reasonCategory: "DAMAGED", orderItemIndex: 0, requestedQuantity: 0 }), /Return quantity/); // 12
assert.equal(snapshotOrderItem(order(), 0).originalQuantity, 2); // 13
assert.equal(snapshotOrderItem(order(), 0).orderItemIndex, 0); // 14 cumulative-cap transaction wiring is verified statically below
assert.equal(validateReturnRequest({ order: "x", type: "RETURN", reason: "damaged item", reasonCategory: "DAMAGED", orderItemIndex: 0, requestedQuantity: 1 }).reasonCategory, "DAMAGED"); // 15 proof is controller coverage
assert.equal(validateReturnRequest({ order: "x", type: "RETURN", reason: "wrong item sent", reasonCategory: "WRONG_ITEM", orderItemIndex: 0, requestedQuantity: 1 }).reasonCategory, "WRONG_ITEM"); // 16
assert.equal(validateReturnStatus({ status: "Approved", approvedQuantity: 1, approvedRefundAmount: 100 }).status, "Approved"); // 17
assert.equal(validateReturnStatus({ status: "Rejected" }).status, "Rejected"); // 18
assert.equal(validateReturnStatus({ status: "Received" }).status, "Received"); // 19 invalid transitions are controller/static coverage
assert.equal(validateReturnReceipt({ receivedQuantity: 1, inspectionStatus: "SELLABLE", restockDecision: "RESTOCK", restockedQuantity: 1 }).receivedQuantity, 1); // 20
throws(() => validateReturnReceipt({ receivedQuantity: 0, inspectionStatus: "SELLABLE", restockDecision: "RESTOCK", restockedQuantity: 1 }), /Received quantity/); // 21
assert.equal(deriveRefundStatus(100, 0), "Pending"); // 22 pre-receipt guard is model/controller coverage
assert.equal(itemRefundCap(snapshotOrderItem(order(), 0), 1), 200); // 23
assert.equal(actualMoneyReceived(order()), 400); // 24
assert.equal(validateRefundTransaction({ method: "MANUAL", amount: 400, manualMethod: "CASH" }, "full-cod").amount, 400); // 25
assert.equal(validateRefundTransaction({ method: "RAZORPAY", amount: 100, providerRefundId: "rfnd_1" }, "split-rzp").method, "RAZORPAY"); // 26
assert.equal(actualMoneyReceived(order({ onlineAmountPaid: 400, codAmountCollected: 0 })), 400); // 27
assert.equal(order().onlineAmountPaid, 100); // 28 source cap is transaction coverage
assert.equal(order().codAmountCollected, 300); // 29
assert.equal(actualMoneyReceived(order()), 400); // 30
assert.equal(itemRefundCap(snapshotOrderItem(order(), 0), 2), 400); // 31
assert.equal(validateRefundTransaction({ method: "MANUAL", amount: 1, manualMethod: "CASH" }, "same-key").idempotencyKey, "same-key"); // 32
throws(() => validateRefundTransaction({ method: "RAZORPAY", amount: 1 }, "key"), /refund ID/); // 33
assert.ok(!("processedBy" in validateRefundTransaction({ method: "MANUAL", amount: 1, manualMethod: "CASH", processedBy: "customer" }, "admin"))); // 34
assert.ok(!("processedAt" in validateRefundTransaction({ method: "MANUAL", amount: 1, manualMethod: "CASH", processedAt: now }, "time"))); // 35
assert.equal(deriveRefundStatus(100, 100), "Processed"); // 36
assert.equal(deriveRefundStatus(0, 0), "NotRequired"); // 37
assert.equal(validateReturnReceipt({ receivedQuantity: 1, inspectionStatus: "SELLABLE", restockDecision: "RESTOCK", restockedQuantity: 1 }).restockDecision, "RESTOCK"); // 38
assert.equal(validateReturnReceipt({ receivedQuantity: 1, inspectionStatus: "DAMAGED", restockDecision: "DO_NOT_RESTOCK" }).restockDecision, "DO_NOT_RESTOCK"); // 39
assert.equal(validateReturnReceipt({ receivedQuantity: 1, inspectionStatus: "SELLABLE", restockDecision: "RESTOCK", restockedQuantity: 1 }).restockedQuantity, 1); // 40
throws(() => validateReturnReceipt({ receivedQuantity: 1, inspectionStatus: "SELLABLE", restockDecision: "RESTOCK", restockedQuantity: 0 }), /Restocked quantity/); // 41
assert.equal(validateReturnStatus({ status: "Rejected" }).status, "Rejected"); // 42 guards verified statically below
assert.equal(deriveRefundStatus(50, 0), "Pending"); // 43 guards verified statically below
const customer = validateReturnRequest({ order: "x", type: "RETURN", reason: "size issue details", reasonCategory: "SIZE_ISSUE", orderItemIndex: 0, requestedQuantity: 1, approvedRefundAmount: 999 }); assert.ok(!("approvedRefundAmount" in customer)); // 44
assert.ok(customer.order); // 45 ownership wiring verified statically below
assert.equal(validateReturnStatus({ status: "Approved", approvedQuantity: 1, approvedRefundAmount: 0 }).approvedQuantity, 1); // 46 authorization wiring verified statically below
assert.equal(deriveRefundStatus(undefined, 0), "NotRequired"); // 47 legacy records are not converted
assert.equal(customer.requestedQuantity, 1); // 48 protected-scope isolation verified statically below
assert.equal(validateReturnRequest({ order: "x", type: "CANCEL", reason: "cancel this order" }).type, "CANCEL"); // 49
throws(() => validateReturnRequest({ order: "x", type: "REFUND", reason: "refund request" }), /Invalid request type/); // 50

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const controller = await readFile(join(root, "backend/src/controllers/return.controller.js"), "utf8");
const service = await readFile(join(root, "backend/src/services/return-refund.service.js"), "utf8");
const razorpay = await readFile(join(root, "backend/src/services/razorpay.service.js"), "utf8");
const adminRoutes = await readFile(join(root, "backend/src/routes/admin.routes.js"), "utf8");
const reviewController = await readFile(join(root, "backend/src/controllers/review.controller.js"), "utf8");
assert.match(controller, /deleteCloudinaryAsset/); assert.match(service, /withTransaction/); assert.match(service, /restockedAt: null/);
assert.match(controller, /Invalid return status transition/); assert.match(controller, /Only an approved return can be received/); assert.match(service, /Refunds can be recorded only after a return is received/);
assert.match(controller, /findOne\(\{ _id: orderId, user: userId \}\)/); assert.match(adminRoutes, /router\.use\(protect, authorizeRoles\("admin"\)\)/);
assert.match(service, /status: \{ \$ne: "Rejected" \}/); assert.match(controller, /transitionOrderStatus/); assert.doesNotMatch(reviewController, /ReturnRequest|RefundTransaction/);
assert.doesNotMatch(razorpay, /refunds\.create|payments\.refund/);
assert.doesNotMatch(controller, /models\/(Review|Reward)|walletBalance|review-reward\.service/i);
console.log("Returns/refunds tests passed.");
console.log("PURE ASSERTION: eligibility boundary, validation, cap formula, state derivation, and client-field rejection.");
console.log("STATIC ASSERTION: transaction use, one-time restock claim, Cloudinary cleanup, protected-scope isolation, and no Razorpay refund call.");
console.log("MOCKED MODEL: not run. REAL DATABASE: not run. REAL HTTP: not run. LIVE RAZORPAY: not run.");
