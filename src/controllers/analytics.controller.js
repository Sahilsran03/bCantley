import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Review from "../models/Review.js";
import Reward from "../models/Reward.js";
import User from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getCategorySales,
  getDateRange,
  getHighestRatedProducts,
  getLowStockProducts,
  getMostViewedProducts,
  getTopCustomers,
  getTopSellingProducts,
  groupSalesByDate,
  orderDateMatch
} from "../services/analytics.service.js";
import { getMoneyReceivedByDate, getOrderFinancialMetrics, getReceiptMetrics } from "../services/financial-analytics.service.js";

const sumField = async (Model, match, field) => {
  const [result] = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` } } }]);
  return result?.total || 0;
};

export const getDashboardAnalytics = asyncHandler(async (req, res) => {
  const range = getDateRange(req.query);
  const match = orderDateMatch(range);
  const [
    financials,
    receipts,
    totalOrders,
    totalCustomers,
    totalProducts,
    pendingOrders,
    deliveredOrders,
    cancelledOrders,
    lowStockProducts,
    totalReviews,
    totalRewardsGiven,
    recentOrders,
    topProducts,
    rewardSummary
  ] = await Promise.all([
    getOrderFinancialMetrics(range),
    getReceiptMetrics(range),
    Order.countDocuments(match),
    User.countDocuments({ role: "customer" }),
    Product.countDocuments(),
    Order.countDocuments({ ...match, orderStatus: "Pending" }),
    Order.countDocuments({ ...match, orderStatus: "Delivered" }),
    Order.countDocuments({ ...match, orderStatus: "Cancelled" }),
    getLowStockProducts(6),
    Review.countDocuments(),
    sumField(Reward, { status: "Approved" }, "amount"),
    Order.find(match).populate("user", "name email").sort({ createdAt: -1 }).limit(6).lean(),
    getTopSellingProducts(range, 6),
    Reward.aggregate([{ $match: { status: "Approved" } }, { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
  ]);

  res.status(200).json({
    success: true,
    metrics: {
      grossOrderValue: financials.grossOrderValue,
      cancelledOrderValue: financials.cancelledOrderValue,
      grossMoneyReceived: receipts.grossMoneyReceived,
      onlineReceived: receipts.onlineReceived,
      codCollected: receipts.codCollected,
      walletReceived: receipts.walletReceived,
      walletRefunded: receipts.walletRefunded,
      netWalletReceived: receipts.netWalletReceived,
      codOutstanding: financials.codOutstanding,
      paidOrders: financials.paidOrders,
      unpaidOrPartiallyPaidOrders: financials.unpaidOrPartiallyPaidOrders,
      incompleteFinancialOrders: financials.incompleteFinancialOrders,
      totalOrders,
      totalCustomers,
      totalProducts,
      pendingOrders,
      deliveredOrders,
      cancelledOrders,
      lowStockProducts: lowStockProducts.length,
      totalReviews,
      totalRewardsGiven
    },
    lowStockProducts,
    recentOrders,
    topProducts,
    rewardSummary
  });
});

export const getSalesAnalytics = asyncHandler(async (req, res) => {
  const range = getDateRange(req.query);
  const [daily, weekly, monthly, yearly, categorySales, receivedDaily, receivedWeekly, receivedMonthly, receivedYearly] = await Promise.all([
    groupSalesByDate(range, "day"),
    groupSalesByDate(range, "week"),
    groupSalesByDate(range, "month"),
    groupSalesByDate(range, "year"),
    getCategorySales(range),
    getMoneyReceivedByDate(range, "day"),
    getMoneyReceivedByDate(range, "week"),
    getMoneyReceivedByDate(range, "month"),
    getMoneyReceivedByDate(range, "year")
  ]);

  res.status(200).json({ success: true, daily, weekly, monthly, yearly, categorySales, receivedDaily, receivedWeekly, receivedMonthly, receivedYearly });
});

export const getProductAnalytics = asyncHandler(async (req, res) => {
  const range = getDateRange(req.query);
  const [topSellingProducts, lowStockProducts, mostViewedProducts, highestRatedProducts] = await Promise.all([
    getTopSellingProducts(range),
    getLowStockProducts(),
    getMostViewedProducts(),
    getHighestRatedProducts()
  ]);

  res.status(200).json({ success: true, topSellingProducts, lowStockProducts, mostViewedProducts, highestRatedProducts });
});

export const getCustomerAnalytics = asyncHandler(async (req, res) => {
  const range = getDateRange(req.query);
  const [topCustomers, repeatCustomers, newCustomersCount, loyaltyRankDistribution, customerGrowth] = await Promise.all([
    getTopCustomers(range),
    Order.aggregate([{ $group: { _id: "$user", orders: { $sum: 1 } } }, { $match: { orders: { $gte: 2 } } }, { $count: "count" }]),
    User.countDocuments({ role: "customer", createdAt: { $gte: range.from, $lte: range.to } }),
    User.aggregate([{ $match: { role: "customer" } }, { $group: { _id: "$loyaltyRank", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    User.aggregate([
      { $match: { role: "customer", createdAt: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d" } }, customers: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, label: "$_id", customers: 1 } }
    ])
  ]);

  res.status(200).json({
    success: true,
    topCustomers,
    repeatCustomers: repeatCustomers[0]?.count || 0,
    newCustomersCount,
    loyaltyRankDistribution,
    customerGrowth
  });
});

export const getRewardAnalytics = asyncHandler(async (req, res) => {
  const range = getDateRange(req.query);
  const rewards = await Reward.aggregate([
    { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
    { $group: { _id: "$type", totalAmount: { $sum: { $cond: [{ $eq: ["$status", "Approved"] }, "$amount", 0] } }, count: { $sum: 1 }, approved: { $sum: { $cond: [{ $eq: ["$status", "Approved"] }, 1, 0] } } } },
    { $sort: { _id: 1 } }
  ]);

  res.status(200).json({
    success: true,
    reviewRewards: rewards.find((item) => item._id === "REVIEW") || null,
    reelRewards: rewards.find((item) => item._id === "REEL") || null,
    storyRewards: rewards.find((item) => item._id === "STORY") || null,
    wearEarnRewards: rewards.find((item) => item._id === "WEAR_AND_EARN") || null,
    rewards
  });
});
