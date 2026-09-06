import mongoose from "mongoose";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { AppError } from "../utils/appError.js";

const id = (value) => String(value?._id || value || "");
const sessionQuery = (query, session) => session ? query.session(session) : query;
const assertId = (value, label) => { if (!mongoose.Types.ObjectId.isValid(value)) throw new AppError(`A valid ${label} is required.`, 400); };
const assertAmount = (amount) => { if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError("Wallet amount must be a positive safe whole-INR number.", 400); };
const assertKey = (key) => { if (typeof key !== "string" || !key.trim() || key !== key.trim() || key.length > 160) throw new AppError("A valid wallet idempotency key is required.", 400); };
const assertSession = (session) => { if (!session?.inTransaction?.()) throw new AppError("Wallet operations require an active MongoDB transaction.", 500); };
const samePosting = (entry, posting) => {
  for (const field of ["user", "order", "reward", "refund", "reversalOf"]) {
    if (id(entry[field]) !== id(posting[field])) throw new AppError("Wallet idempotency key was used for a different operation.", 409);
  }
  for (const field of ["purpose", "direction", "amount", "reason"]) {
    if ((entry[field] || "") !== (posting[field] || "")) throw new AppError("Wallet idempotency key was used for a different operation.", 409);
  }
  if (entry.status !== "POSTED") throw new AppError("Wallet posting requires reconciliation.", 409);
  return { transaction: entry, posted: false };
};
const normalize = (input, direction, reversal = false) => {
  assertId(input.userId, "wallet user"); assertAmount(input.amount); assertKey(input.idempotencyKey);
  const posting = { user: input.userId, purpose: input.purpose, direction, amount: input.amount,
    idempotencyKey: input.idempotencyKey, order: input.orderId || null, reward: input.rewardId || null,
    refund: input.refundId || null, reversalOf: input.reversalOf || null, reason: input.reason || "" };
  for (const field of ["order", "reward", "refund", "reversalOf"]) if (posting[field]) assertId(posting[field], field);
  if (typeof posting.reason !== "string" || posting.reason.length > 500) throw new AppError("Wallet reason is invalid.", 400);
  const valid = posting.purpose === "REWARD_CREDIT" ? direction === "CREDIT" && posting.reward && !posting.order && !posting.refund && !posting.reversalOf
    : posting.purpose === "ORDER_PAYMENT" ? direction === "DEBIT" && posting.order && !posting.reward && !posting.refund && !posting.reversalOf
    : posting.purpose === "ORDER_REFUND" ? direction === "CREDIT" && posting.order && posting.refund && !posting.reward && !posting.reversalOf
    : reversal && posting.purpose === "REVERSAL" && posting.reversalOf && posting.reason.trim();
  if (!valid) throw new AppError("Wallet purpose, direction or attribution is invalid.", 400);
  return posting;
};

export const createWalletService = ({ UserModel = User, LedgerModel = WalletTransaction, startSession = () => mongoose.startSession() } = {}) => {
  const boundary = async (session, work, duplicateRecovery) => {
    if (session) { assertSession(session); return work(session); }
    const owned = await startSession();
    let result;
    try {
      await owned.withTransaction(async () => { result = await work(owned); });
      return result;
    } catch (error) {
      if (error.code === 11000 && duplicateRecovery) {
        const recovered = await duplicateRecovery();
        if (recovered) return recovered;
      }
      throw error;
    } finally { await owned.endSession(); }
  };
  const existing = async (posting, session) => {
    const entry = await sessionQuery(LedgerModel.findOne({ user: posting.user, idempotencyKey: posting.idempotencyKey }), session);
    return entry ? samePosting(entry, posting) : null;
  };
  const post = async (posting, session) => {
    assertSession(session);
    const replay = await existing(posting, session);
    if (replay) return replay;
    const debit = posting.direction === "DEBIT";
    // Conditional update serializes competing postings on the exact User document.
    // No blind read-then-save balance write; malformed legacy balances fail closed.
    const before = await UserModel.findOneAndUpdate({
      _id: posting.user,
      walletBalance: { $type: "number", $gte: debit ? posting.amount : 0, $lte: Number.MAX_SAFE_INTEGER - (debit ? 0 : posting.amount) },
      $expr: { $eq: ["$walletBalance", { $trunc: "$walletBalance" }] }
    }, { $inc: { walletBalance: debit ? -posting.amount : posting.amount } }, { new: false, session, runValidators: true });
    if (!before) {
      const user = await UserModel.findById(posting.user).session(session);
      if (!user) throw new AppError("Customer account not found.", 404);
      if (Number.isSafeInteger(user.walletBalance) && user.walletBalance >= 0 && debit && user.walletBalance < posting.amount) {
        throw new AppError("Insufficient wallet balance.", 409);
      }
      throw new AppError("Wallet balance requires reconciliation before posting.", 409);
    }
    const balanceBefore = before.walletBalance;
    const balanceAfter = balanceBefore + (debit ? -posting.amount : posting.amount);
    if (!Number.isSafeInteger(balanceBefore) || !Number.isSafeInteger(balanceAfter) || balanceAfter < 0) throw new AppError("Wallet balance requires reconciliation.", 409);
    const [entry] = await LedgerModel.create([{ ...posting, currency: "INR", status: "POSTED", balanceBefore, balanceAfter }], { session });
    return { transaction: entry, posted: true };
  };
  const perform = (input, direction) => {
    const posting = normalize(input, direction);
    return boundary(input.session, (session) => post(posting, session), () => existing(posting));
  };
  const creditWallet = (input) => perform(input, "CREDIT");
  const debitWallet = (input) => perform(input, "DEBIT");
  const reverseWalletTransaction = async ({ userId, transactionId, idempotencyKey, reason, allowCreditReversal = false, session }) => {
    assertId(userId, "wallet user"); assertId(transactionId, "original wallet transaction"); assertKey(idempotencyKey);
    let reversalPosting;
    const work = async (active) => {
      const original = await sessionQuery(LedgerModel.findOne({ _id: transactionId, user: userId }), active);
      if (!original || original.status !== "POSTED") throw new AppError("Original wallet posting not found.", 404);
      if (original.purpose === "REVERSAL") throw new AppError("A reversal cannot itself be reversed by this primitive.", 409);
      if (original.direction === "CREDIT" && allowCreditReversal !== true) throw new AppError("Reversing a wallet credit requires explicit business authorization.", 403);
      const posting = normalize({ userId, amount: original.amount, purpose: "REVERSAL", reversalOf: original._id,
        orderId: original.order, rewardId: original.reward, refundId: original.refund, idempotencyKey, reason },
        original.direction === "DEBIT" ? "CREDIT" : "DEBIT", true);
      reversalPosting = posting;
      const keyReplay = await existing(posting, active);
      if (keyReplay) return keyReplay;
      const prior = await sessionQuery(LedgerModel.findOne({ user: userId, reversalOf: original._id }), active);
      if (prior) return samePosting(prior, posting);
      return post(posting, active);
    };
    // A concurrent reversal under another key is still the same original operation.
    return boundary(session, work, async () => {
      if (!reversalPosting) return null;
      const replay = await existing(reversalPosting);
      if (replay) return replay;
      const prior = await LedgerModel.findOne({ user: userId, reversalOf: transactionId });
      return prior ? samePosting(prior, reversalPosting) : null;
    });
  };
  const reconcileWallet = async ({ userId, openingBalance, session }) => {
    assertId(userId, "wallet user");
    if (openingBalance !== undefined && (!Number.isSafeInteger(openingBalance) || openingBalance < 0)) throw new AppError("Opening balance must be a safe non-negative whole-INR amount.", 400);
    return boundary(session, async (active) => {
      const user = await UserModel.findById(userId).session(active);
      if (!user) throw new AppError("Customer account not found.", 404);
      const entries = await LedgerModel.find({ user: userId }).sort({ createdAt: 1, _id: 1 }).session(active);
      return reconcileWalletEntries({ walletBalance: user.walletBalance, entries, openingBalance });
    });
  };
  return { creditWallet, debitWallet, reverseWalletTransaction, reconcileWallet };
};

export const reconcileWalletEntries = ({ walletBalance, entries, openingBalance }) => {
  let delta = 0;
  let previous;
  let chainValid = Number.isSafeInteger(walletBalance) && walletBalance >= 0;
  for (const entry of entries) {
    const signed = entry.direction === "CREDIT" ? entry.amount : -entry.amount;
    chainValid &&= entry.status === "POSTED" && ["CREDIT", "DEBIT"].includes(entry.direction) &&
      Number.isSafeInteger(entry.amount) && entry.amount > 0 && Number.isSafeInteger(entry.balanceBefore) && entry.balanceBefore >= 0 &&
      Number.isSafeInteger(entry.balanceAfter) && entry.balanceAfter >= 0 && entry.balanceAfter === entry.balanceBefore + signed &&
      (previous === undefined || previous === entry.balanceBefore);
    delta += signed; previous = entry.balanceAfter;
  }
  chainValid &&= Number.isSafeInteger(delta);
  const inferredOpeningBalance = entries.length ? entries[0].balanceBefore : walletBalance;
  const baselineProvided = openingBalance !== undefined;
  const ledgerDerivedBalance = baselineProvided ? openingBalance + delta : null;
  return {
    currentBalance: walletBalance, postingCount: entries.length, postedNetChange: delta,
    inferredOpeningBalance, baselineProvided, ledgerDerivedBalance, chainValid,
    trackedBalanceMatches: chainValid && (previous === undefined || previous === walletBalance),
    matchesProvidedBaseline: baselineProvided ? chainValid && Number.isSafeInteger(ledgerDerivedBalance) && ledgerDerivedBalance === walletBalance && (!entries.length || entries[0].balanceBefore === openingBalance) : null,
    historicalReconciliationComplete: false,
    legacyNote: "An inferred opening balance is not historical proof. Reconcile and migrate the pre-ledger baseline separately."
  };
};
const service = createWalletService();
export const creditWallet = service.creditWallet;
export const debitWallet = service.debitWallet;
export const reverseWalletTransaction = service.reverseWalletTransaction;
export const reconcileWallet = service.reconcileWallet;
