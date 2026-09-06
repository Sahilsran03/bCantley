import assert from "node:assert/strict";
import mongoose from "mongoose";
const equal = (a, b) => String(a ?? "") === String(b ?? "");
const matches = (entry, query) => Object.entries(query).every(([key, value]) => equal(entry[key], value));
export const walletUserId = "111111111111111111111111";
export const makeWalletHarness = ({ balance = 0, userId = walletUserId } = {}) => {
  const state = { users: { [userId]: { _id: userId, walletBalance: balance } }, entries: [], rewards: [], reviews: [], order: null };
  let queue = Promise.resolve();
  const startSession = async () => ({
    active: false,
    inTransaction() { return this.active; },
    async withTransaction(work) {
      const prior = queue; let release;
      queue = new Promise((resolve) => { release = resolve; });
      await prior;
      const saved = structuredClone(state); this.active = true;
      try { await work(); } catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, saved); throw error; }
      finally { this.active = false; release(); }
    }, async endSession() {}
  });
  const active = (options) => assert.equal(options?.session?.inTransaction(), true, "writes must participate in the transaction");
  const query = (get) => ({
    session(value) { assert.equal(value.inTransaction(), true); return this; },
    sort() { return this; },
    then(resolve, reject) { return Promise.resolve().then(get).then(resolve, reject); }
  });
  const UserModel = {
    findById(id) { return query(() => state.users[String(id)] ? { ...state.users[String(id)] } : null); },
    async findOneAndUpdate(filter, update, options) {
      active(options); assert.equal(options.new, false);
      assert.deepEqual(filter.$expr, { $eq: ["$walletBalance", { $trunc: "$walletBalance" }] });
      const user = state.users[String(filter._id)]; const amount = user?.walletBalance;
      if (!user || !Number.isSafeInteger(amount) || amount < filter.walletBalance.$gte || amount > filter.walletBalance.$lte) return null;
      const before = { ...user }; user.walletBalance += update.$inc.walletBalance; return before;
    }
  };
  const LedgerModel = {
    findOne(filter) { return query(() => state.entries.find((entry) => matches(entry, filter)) || null); },
    find(filter) { return query(() => state.entries.filter((entry) => matches(entry, filter))); },
    async create([data], options) {
      active(options);
      if (state.failLedger) throw new Error("injected ledger failure");
      const duplicate = state.entries.some((entry) =>
        (equal(entry.user, data.user) && entry.idempotencyKey === data.idempotencyKey) ||
        (data.reversalOf && equal(entry.reversalOf, data.reversalOf)) ||
        (data.purpose === "REWARD_CREDIT" && entry.purpose === "REWARD_CREDIT" && equal(entry.reward, data.reward)));
      if (duplicate) throw Object.assign(new Error("duplicate ledger operation"), { code: 11000 });
      const entry = { ...data, _id: new mongoose.Types.ObjectId().toString(), createdAt: new Date(100000 + state.entries.length * 1000) };
      state.entries.push(entry); return [entry];
    }
  };
  const rewardDoc = (record) => record ? { ...record, async save(options) {
    active(options); if (state.failRewardSave) throw new Error("injected reward save failure");
    const { save, ...values } = this;
    Object.assign(state.rewards.find((entry) => equal(entry._id, values._id)), values);
    return this;
  } } : null;
  const RewardModel = {
    findById(id) { return query(() => rewardDoc(state.rewards.find((entry) => equal(entry._id, id)))); },
    async create([data], options) {
      active(options); if (state.failRewardCreate) throw new Error("injected reward failure");
      const reward = { ...data, _id: new mongoose.Types.ObjectId().toString() }; state.rewards.push(reward); return [rewardDoc(reward)];
    }
  };
  const ReviewModel = {
    exists(filter) { return query(() => state.existingReview || state.reviews.some((entry) => matches(entry, filter))); },
    async create([data], options) {
      active(options); const review = { ...data, _id: new mongoose.Types.ObjectId().toString() }; state.reviews.push(review); return [review];
    }
  };
  const OrderModel = { findOne() { return query(() => state.order); } };
  return { state, userId, UserModel, LedgerModel, startSession,
    dependencies: { UserModel, WalletTransactionModel: LedgerModel, RewardModel, ReviewModel, OrderModel, startSession } };
};
