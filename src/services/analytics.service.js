import Order from "../models/Order.js";
import Product from "../models/Product.js";
import RecentlyViewed from "../models/RecentlyViewed.js";
import Review from "../models/Review.js";
import Reward from "../models/Reward.js";
import User from "../models/User.js";

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

export const getDateRange = (query = {}) => {
  const now = new Date();
  let from = new Date(0);
  let to = now;

  if (query.range === "today") from = startOfDay(now);
  if (query.range === "7d") from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (query.range === "30d") from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (query.range === "12m") from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  if (query.from) from = new Date(query.from);
  if (query.to) to = new Date(query.to);

  return { from, to };
};

export const orderDateMatch = (range) => ({
  createdAt: { $gte: range.from, $lte: range.to }
});

export const groupSalesByDate = async (range, unit = "day") => {
  const format = unit === "year" ? "%Y" : unit === "month" ? "%Y-%m" : unit === "week" ? "%G-W%V" : "%Y-%m-%d";
  return Order.aggregate([
    { $match: { ...orderDateMatch(range), orderStatus: { $ne: "Cancelled" } } },
    {
      $group: {
        _id: { $dateToString: { date: "$createdAt", format } },
        orderValue: { $sum: "$totalAmount" },
        orders: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, label: "$_id", orderValue: 1, orders: 1 } }
  ]);
};

export const getTopSellingProducts = (range, limit = 8) =>
  Order.aggregate([
    { $match: { ...orderDateMatch(range), orderStatus: { $ne: "Cancelled" } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        name: { $first: "$items.name" },
        quantity: { $sum: "$items.quantity" },
        orderValue: { $sum: { $multiply: ["$items.finalPrice", "$items.quantity"] } }
      }
    },
    { $sort: { quantity: -1, orderValue: -1 } },
    { $limit: limit }
  ]);

export const getCategorySales = (range) =>
  Order.aggregate([
    { $match: { ...orderDateMatch(range), orderStatus: { $ne: "Cancelled" } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.productType",
        orderValue: { $sum: { $multiply: ["$items.finalPrice", "$items.quantity"] } },
        quantity: { $sum: "$items.quantity" }
      }
    },
    { $sort: { orderValue: -1 } },
    { $project: { _id: 0, category: "$_id", orderValue: 1, quantity: 1 } }
  ]);

export const getLowStockProducts = (limit = 10) =>
  Product.find({ "variants.stock": { $lte: 5 } })
    .select("name slug variants basePrice")
    .limit(limit)
    .lean();

export const getMostViewedProducts = (limit = 8) =>
  RecentlyViewed.aggregate([
    { $unwind: "$products" },
    { $group: { _id: "$products.product", views: { $sum: 1 }, lastViewedAt: { $max: "$products.viewedAt" } } },
    { $sort: { views: -1, lastViewedAt: -1 } },
    { $limit: limit },
    { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "product" } },
    { $unwind: "$product" },
    { $project: { _id: 1, views: 1, name: "$product.name", slug: "$product.slug" } }
  ]);

export const getHighestRatedProducts = (limit = 8) =>
  Product.find({ ratingCount: { $gt: 0 } })
    .select("name slug ratingAverage ratingCount")
    .sort({ ratingAverage: -1, ratingCount: -1 })
    .limit(limit)
    .lean();

export const getTopCustomers = (range, limit = 8) =>
  Order.aggregate([
    { $match: { ...orderDateMatch(range), orderStatus: { $ne: "Cancelled" } } },
    { $group: { _id: "$user", orders: { $sum: 1 }, orderValue: { $sum: "$totalAmount" } } },
    { $sort: { orderValue: -1, orders: -1 } },
    { $limit: limit },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $project: { _id: 1, orders: 1, orderValue: 1, name: "$user.name", email: "$user.email", loyaltyRank: "$user.loyaltyRank" } }
  ]);
