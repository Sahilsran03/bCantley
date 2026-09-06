import assert from "node:assert/strict";
import mongoose from "mongoose";
import Reward from "../models/Reward.js";
import { makeWalletHarness, walletUserId } from "./helpers/walletHarness.js";
import { assertReviewOrderEligible, createEligibleReview } from "../services/review-reward.service.js";
import { REVIEW_REWARD_AMOUNT, validateReviewInput } from "../validators/review.validator.js";

const orderId = new mongoose.Types.ObjectId().toString();
const productId = new mongoose.Types.ObjectId().toString();
const otherProductId = new mongoose.Types.ObjectId().toString();
const validBody = { orderId, productId, rating: 5, reviewText: "Excellent quality" };
const eligibleOrder = { orderStatus: "Delivered", paymentStatus: "Paid", remainingCodDue: 0, items: [{ product: productId, quantity: 2 }] };

assert.deepEqual(validateReviewInput(validBody), validBody);
assert.equal(REVIEW_REWARD_AMOUNT, 10);
assert.equal(validateReviewInput({ ...validBody, reviewText: "   " }).reviewText, "");
assert.throws(() => validateReviewInput({ ...validBody, orderId: "bad" }), /valid order/);
assert.throws(() => validateReviewInput({ ...validBody, productId: "bad" }), /valid product/);
assert.throws(() => validateReviewInput({ ...validBody, rating: 4.5 }), /whole number/);
assert.throws(() => validateReviewInput({ ...validBody, reviewText: "good" }), /at least 10/);
assert.throws(() => validateReviewInput({ ...validBody, reviewText: "x".repeat(1201) }), /must not exceed/);
assert.doesNotThrow(() => assertReviewOrderEligible(eligibleOrder, productId));

for (const [label, order, message] of [
  ["AdvancePaid", { ...eligibleOrder, paymentStatus: "AdvancePaid", remainingCodDue: 300 }, /fully paid/],
  ["Pending payment", { ...eligibleOrder, paymentStatus: "Pending", remainingCodDue: 400 }, /fully paid/],
  ["Pending order", { ...eligibleOrder, orderStatus: "Pending" }, /delivered/],
  ["Shipped order", { ...eligibleOrder, orderStatus: "Shipped" }, /delivered/],
  ["Cancelled order", { ...eligibleOrder, orderStatus: "Cancelled" }, /Cancelled/],
  ["COD due", { ...eligibleOrder, remainingCodDue: 1 }, /fully paid/],
  ["missing order", null, /not found/]
]) {
  assert.throws(() => assertReviewOrderEligible(order, productId), message, label);
}
assert.throws(() => assertReviewOrderEligible(eligibleOrder, otherProductId), /not part/);
assert.doesNotThrow(() => assertReviewOrderEligible({ ...eligibleOrder, items: [{ product: productId, quantity: 5 }] }, productId));

const rewardIndex = Reward.schema.indexes().find(([fields, options]) => fields.review === 1 && options.unique);
assert.ok(rewardIndex, "Review rewards require a unique review index");
assert.equal(rewardIndex[1].partialFilterExpression.type, "REVIEW");

const makeDependencies = ({ existing = false, failReward = false, order = eligibleOrder } = {}) => {
  const harness = makeWalletHarness();
  harness.state.order = order;
  harness.state.existingReview = existing;
  harness.state.failRewardCreate = failReward;
  return harness;
};

const written = makeDependencies();
const writtenResult = await createEligibleReview({ userId: walletUserId, payload: validBody, dependencies: written.dependencies });
assert.equal(writtenResult.rewardGranted, true);
assert.equal(writtenResult.rewardAmount, 10);
assert.equal(written.state.reviews.length, 1);
assert.equal(written.state.rewards.length, 1);
assert.equal(written.state.users[walletUserId].walletBalance, 10);

const ratingOnly = makeDependencies();
const ratingResult = await createEligibleReview({ userId: walletUserId, payload: { ...validBody, reviewText: "" }, dependencies: ratingOnly.dependencies });
assert.equal(ratingResult.rewardGranted, false);
assert.equal(ratingOnly.state.reviews.length, 1);
assert.equal(ratingOnly.state.rewards.length, 0);
assert.equal(ratingOnly.state.users[walletUserId].walletBalance, 0);

const duplicate = makeDependencies({ existing: true });
await assert.rejects(createEligibleReview({ userId: walletUserId, payload: validBody, dependencies: duplicate.dependencies }), (error) => error.statusCode === 409);

const failing = makeDependencies({ failReward: true });
await assert.rejects(createEligibleReview({ userId: walletUserId, payload: validBody, dependencies: failing.dependencies }), /injected reward failure/);
assert.equal(failing.state.reviews.length, 0);
assert.equal(failing.state.rewards.length, 0);
assert.equal(failing.state.entries.length, 0);
assert.equal(failing.state.users[walletUserId].walletBalance, 0);

const foreign = makeDependencies({ order: null });
await assert.rejects(createEligibleReview({ userId: walletUserId, payload: validBody, dependencies: foreign.dependencies }), (error) => error.statusCode === 404);

console.log("Review security assertions passed (pure and mocked-transaction checks; no real MongoDB transaction or concurrency test).");

assert.equal(written.state.entries.length, 1);
assert.equal(written.state.entries[0].purpose, "REWARD_CREDIT");
assert.equal(written.state.entries[0].reward, written.state.rewards[0]._id);
assert.equal(written.state.rewards[0].walletTransaction, written.state.entries[0]._id);
assert(written.state.rewards[0].creditedAt);
await assert.rejects(createEligibleReview({ userId: walletUserId, payload: validBody, dependencies: written.dependencies }), /already reviewed/);
assert.equal(written.state.entries.length, 1);
const ledgerFailure = makeDependencies(); ledgerFailure.state.failLedger = true;
await assert.rejects(createEligibleReview({ userId: walletUserId, payload: validBody, dependencies: ledgerFailure.dependencies }), /ledger failure/);
assert.equal(ledgerFailure.state.reviews.length, 0);
assert.equal(ledgerFailure.state.rewards.length, 0);
assert.equal(ledgerFailure.state.users[walletUserId].walletBalance, 0);
const rewardSaveFailure = makeDependencies(); rewardSaveFailure.state.failRewardSave = true;
await assert.rejects(createEligibleReview({ userId: walletUserId, payload: validBody, dependencies: rewardSaveFailure.dependencies }), /reward save failure/);
assert.equal(rewardSaveFailure.state.entries.length, 0);
assert.equal(rewardSaveFailure.state.users[walletUserId].walletBalance, 0);
console.log("Review reward shared-ledger attribution, duplicate prevention and rollback passed.");
