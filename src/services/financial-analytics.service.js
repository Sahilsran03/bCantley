import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import WalletTransaction from "../models/WalletTransaction.js";

const walletReceipt = (order) => {
  const posting = order.walletPayment;
  return posting && posting.status === "POSTED" && posting.purpose === "ORDER_PAYMENT" && posting.direction === "DEBIT" &&
    String(posting.order) === String(order._id) && String(posting.user) === String(order.user) &&
    Number.isSafeInteger(posting.amount) && posting.amount > 0 && posting.amount === order.totalAmount ? posting.amount : null;
};

const money = (value) => Number(value || 0);
const canonicalFields = ["totalAmount", "onlineAmountPaid", "codAmountCollected", "remainingCodDue"];

export const getFinancialIssues = (order) => {
  const issues = canonicalFields.filter((field) => typeof order[field] !== "number" || !Number.isFinite(order[field])).map((field) => `Missing or invalid ${field}`);
  if (issues.length) return issues;
  const received = money(order.onlineAmountPaid) + money(order.codAmountCollected);
  if (received > money(order.totalAmount)) issues.push("Received components exceed totalAmount");
  if (order.paymentMethod === "WALLET") {
    if (["onlineAmountPaid", "codAmountCollected", "remainingCodDue", "onlineAdvanceRequired", "potentialCodAmount"].some((field) => money(order[field]) !== 0)) issues.push("Wallet Order has non-wallet components");
    if (order.paymentStatus !== "Paid" || walletReceipt(order) === null) issues.push("Wallet Order requires an exact posted payment debit");
  } else if (order.paymentMethod === "ONLINE") {
    if (money(order.remainingCodDue) !== 0 || money(order.codAmountCollected) !== 0) issues.push("Online Order has COD components");
    if (order.paymentStatus === "Paid" && received !== money(order.totalAmount)) issues.push("Paid Online Order does not reconcile to totalAmount");
  } else if (received + money(order.remainingCodDue) !== money(order.totalAmount)) issues.push("Financial components do not reconcile to totalAmount");
  if (order.paymentStatus === "Paid" && money(order.remainingCodDue) > 0) issues.push("Paid Order has an outstanding balance");
  return issues;
};

export const classifyOrderFinancials = (order) => {
  const issues = getFinancialIssues(order);
  const received = issues.length ? null : order.paymentMethod === "WALLET" ? walletReceipt(order) : money(order.onlineAmountPaid) + money(order.codAmountCollected);
  return {
    complete: issues.length === 0,
    issues,
    received,
    fullyPaid: order.orderStatus !== "Cancelled" && (order.paymentMethod !== "ONLINE" || order.paymentStatus === "Paid") && received !== null && received >= money(order.totalAmount) && money(order.remainingCodDue) === 0
  };
};

export const summarizeOrderFinancials = (orders) => orders.reduce((summary, order) => {
  const classification = classifyOrderFinancials(order);
  if (order.orderStatus === "Cancelled") summary.cancelledOrderValue += money(order.totalAmount);
  else summary.grossOrderValue += money(order.totalAmount);
  if (!classification.complete) summary.incompleteFinancialOrders += 1;
  else {
    summary.orderLevelOnlineReceived += money(order.onlineAmountPaid);
    summary.orderLevelCodCollected += money(order.codAmountCollected);
    summary.orderLevelWalletReceived += order.paymentMethod === "WALLET" ? classification.received : 0;
    summary.orderLevelGrossReceived += classification.received;
    if (order.orderStatus !== "Cancelled" && !["ONLINE", "WALLET"].includes(order.paymentMethod)) summary.codOutstanding += money(order.remainingCodDue);
    if (classification.fullyPaid) summary.paidOrders += 1;
    else if (order.orderStatus !== "Cancelled") summary.unpaidOrPartiallyPaidOrders += 1;
  }
  return summary;
}, {
  grossOrderValue: 0, cancelledOrderValue: 0, orderLevelOnlineReceived: 0, orderLevelCodCollected: 0,
  orderLevelWalletReceived: 0, orderLevelGrossReceived: 0, codOutstanding: 0, paidOrders: 0, unpaidOrPartiallyPaidOrders: 0,
  incompleteFinancialOrders: 0
});

const dateFormat = (unit) => unit === "year" ? "%Y" : unit === "month" ? "%Y-%m" : unit === "week" ? "%G-W%V" : "%Y-%m-%d";
const rangeMatch = (field, range) => ({ [field]: { $gte: range.from, $lte: range.to } });

export const getOrderFinancialMetrics = async (range, OrderModel = Order) => {
  const orders = await OrderModel.find({ createdAt: { $gte: range.from, $lte: range.to } })
    .select("user walletPayment paymentMethod totalAmount onlineAmountPaid onlineAdvanceRequired potentialCodAmount codAmountCollected remainingCodDue paymentStatus orderStatus")
    .populate("walletPayment", "user order amount direction purpose status")
    .lean();
  const rangeSummary = summarizeOrderFinancials(orders);
  const currentOrders = await OrderModel.find({ orderStatus: { $ne: "Cancelled" } })
    .select("user walletPayment paymentMethod totalAmount onlineAmountPaid onlineAdvanceRequired potentialCodAmount codAmountCollected remainingCodDue paymentStatus orderStatus")
    .populate("walletPayment", "user order amount direction purpose status")
    .lean();
  const currentSummary = summarizeOrderFinancials(currentOrders);
  return { ...rangeSummary, codOutstanding: currentSummary.codOutstanding };
};

export const walletReceiptPipeline = (range) => [
  { $match: { status: "POSTED", purpose: "ORDER_PAYMENT", direction: "DEBIT", ...rangeMatch("createdAt", range) } },
  { $lookup: { from: "orders", localField: "order", foreignField: "_id", as: "settledOrder" } },
  { $unwind: "$settledOrder" },
  { $match: { "settledOrder.paymentMethod": "WALLET", $expr: { $and: [
    { $eq: ["$_id", "$settledOrder.walletPayment"] },
    { $eq: ["$user", "$settledOrder.user"] },
    { $eq: ["$amount", "$settledOrder.totalAmount"] }
  ] } } }
];

export const walletRefundPipeline = (range) => [
  { $match: { status: "POSTED", purpose: "ORDER_REFUND", direction: "CREDIT", ...rangeMatch("createdAt", range) } },
  { $lookup: { from: "orders", localField: "order", foreignField: "_id", as: "settledOrder" } },
  { $unwind: "$settledOrder" },
  { $lookup: { from: "refundtransactions", localField: "refund", foreignField: "_id", as: "refundEvidence" } },
  { $unwind: "$refundEvidence" },
  { $lookup: { from: "wallettransactions", localField: "refundEvidence.walletPayment", foreignField: "_id", as: "originalDebit" } },
  { $unwind: "$originalDebit" },
  { $match: { "settledOrder.paymentMethod": "WALLET", "refundEvidence.method": "WALLET", "refundEvidence.status": "Completed",
    currency: "INR", "refundEvidence.currency": "INR", "settledOrder.paymentStatus": "Paid",
    "originalDebit.status": "POSTED", "originalDebit.purpose": "ORDER_PAYMENT", "originalDebit.direction": "DEBIT", "originalDebit.currency": "INR",
    $expr: { $and: [
      { $eq: ["$_id", "$refundEvidence.walletTransaction"] },
      { $eq: ["$order", "$refundEvidence.order"] },
      { $eq: ["$settledOrder.walletPayment", "$refundEvidence.walletPayment"] },
      { $eq: ["$user", "$settledOrder.user"] },
      { $eq: ["$amount", "$refundEvidence.amount"] },
      { $eq: [{ $multiply: ["$amount", 100] }, "$refundEvidence.amountPaise"] },
      { $eq: ["$idempotencyKey", "$refundEvidence.idempotencyKey"] },
      { $eq: ["$originalDebit.order", "$order"] },
      { $eq: ["$originalDebit.user", "$user"] },
      { $eq: ["$originalDebit.amount", "$settledOrder.totalAmount"] }
    ] } } }
];

export const getReceiptMetrics = async (range, { PaymentModel = Payment, OrderModel = Order, WalletTransactionModel = WalletTransaction } = {}) => {
  const [online] = await PaymentModel.aggregate([
    { $match: { status: "Captured", purpose: { $in: ["COD_ADVANCE", "FULL_ONLINE"] }, ...rangeMatch("capturedAt", range) } },
    { $lookup: { from: "orders", localField: "order", foreignField: "_id", as: "settledOrder" } },
    { $unwind: "$settledOrder" },
    { $match: { $expr: { $eq: ["$_id", { $cond: [{ $eq: ["$purpose", "FULL_ONLINE"] }, "$settledOrder.onlinePayment", "$settledOrder.codAdvancePayment"] }] } } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);
  const [cod] = await OrderModel.aggregate([
    { $match: { codAmountCollected: { $gt: 0 }, ...rangeMatch("codCollectedAt", range) } },
    { $group: { _id: null, total: { $sum: "$codAmountCollected" } } }
  ]);
  const [wallet] = await WalletTransactionModel.aggregate([...walletReceiptPipeline(range),
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);
  const [refund] = await WalletTransactionModel.aggregate([...walletRefundPipeline(range),
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);
  const walletRefunded = money(refund?.total);
  const walletReceived = money(wallet?.total);
  const onlineReceived = money(online?.total);
  const codCollected = money(cod?.total);
  return { onlineReceived, codCollected, walletReceived, walletRefunded, netWalletReceived: walletReceived - walletRefunded, grossMoneyReceived: onlineReceived + codCollected + walletReceived };
};

const group = async (Model, pipeline) => Model.aggregate(pipeline);

export const getMoneyReceivedByDate = async (range, unit = "day", { PaymentModel = Payment, OrderModel = Order, WalletTransactionModel = WalletTransaction } = {}) => {
  const format = dateFormat(unit);
  const [online, cod] = await Promise.all([
    group(PaymentModel, [
      { $match: { status: "Captured", purpose: { $in: ["COD_ADVANCE", "FULL_ONLINE"] }, ...rangeMatch("capturedAt", range) } },
      { $lookup: { from: "orders", localField: "order", foreignField: "_id", as: "settledOrder" } },
      { $unwind: "$settledOrder" },
      { $match: { $expr: { $eq: ["$_id", { $cond: [{ $eq: ["$purpose", "FULL_ONLINE"] }, "$settledOrder.onlinePayment", "$settledOrder.codAdvancePayment"] }] } } },
      { $group: { _id: { $dateToString: { date: "$capturedAt", format } }, onlineReceived: { $sum: "$amount" } } }
    ]),
    group(OrderModel, [
      { $match: { codAmountCollected: { $gt: 0 }, ...rangeMatch("codCollectedAt", range) } },
      { $group: { _id: { $dateToString: { date: "$codCollectedAt", format } }, codCollected: { $sum: "$codAmountCollected" } } }
    ])
  ]);
  const wallet = await group(WalletTransactionModel, [...walletReceiptPipeline(range),
    { $group: { _id: { $dateToString: { date: "$createdAt", format } }, walletReceived: { $sum: "$amount" } } }
  ]);
  const refunds = await group(WalletTransactionModel, [...walletRefundPipeline(range),
    { $group: { _id: { $dateToString: { date: "$createdAt", format } }, walletRefunded: { $sum: "$amount" } } }
  ]);
  const rows = new Map();
  for (const entry of online) rows.set(entry._id, { label: entry._id, onlineReceived: money(entry.onlineReceived), codCollected: 0, walletReceived: 0, walletRefunded: 0 });
  for (const entry of cod) {
    const row = rows.get(entry._id) || { label: entry._id, onlineReceived: 0, codCollected: 0, walletReceived: 0, walletRefunded: 0 };
    row.codCollected = money(entry.codCollected);
    rows.set(entry._id, row);
  }
  for (const entry of wallet) {
    const row = rows.get(entry._id) || { label: entry._id, onlineReceived: 0, codCollected: 0, walletReceived: 0, walletRefunded: 0 };
    row.walletReceived = money(entry.walletReceived); rows.set(entry._id, row);
  }
  for (const entry of refunds) {
    const row = rows.get(entry._id) || { label: entry._id, onlineReceived: 0, codCollected: 0, walletReceived: 0, walletRefunded: 0 };
    row.walletRefunded = money(entry.walletRefunded); rows.set(entry._id, row);
  }
  return [...rows.values()].map((row) => ({ ...row, netWalletReceived: row.walletReceived - row.walletRefunded, totalReceived: row.onlineReceived + row.codCollected + row.walletReceived })).sort((a, b) => a.label.localeCompare(b.label));
};
