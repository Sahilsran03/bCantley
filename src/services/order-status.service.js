import { finalizeWalletCancellation } from "./wallet-cancellation.service.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { AppError } from "../utils/appError.js";
import { releaseOnlineInventoryReservation } from "./inventory-reservation.service.js";

export const CANONICAL_ORDER_STATUSES = [
  "Pending",
  "Design Review",
  "Approved",
  "Printing",
  "Quality Check",
  "Packing",
  "Shipped",
  "Delivered",
  "Cancelled"
];

export const CANCELLABLE_ORDER_STATUSES = ["Pending", "Design Review", "Approved"];

const activeStatusRank = new Map(
  CANONICAL_ORDER_STATUSES.filter((status) => status !== "Cancelled").map((status, index) => [status, index])
);

const defaultMessages = {
  Pending: "Order is pending.",
  "Design Review": "Order design is under review.",
  Approved: "Order has been approved.",
  Printing: "Order is being printed.",
  "Quality Check": "Order is undergoing quality checks.",
  Packing: "Order is being packed.",
  Shipped: "Order has been shipped.",
  Delivered: "Order has been delivered.",
  Cancelled: "Order has been cancelled."
};

export const assertCanonicalOrderStatus = (status) => {
  if (!CANONICAL_ORDER_STATUSES.includes(status)) throw new AppError("Invalid order status.", 400);
};

export const assertOrderStatusTransition = (currentStatus, nextStatus) => {
  assertCanonicalOrderStatus(currentStatus);
  assertCanonicalOrderStatus(nextStatus);

  if (currentStatus === nextStatus) return;
  if (currentStatus === "Delivered") throw new AppError("Delivered Orders cannot change status.", 409);
  if (currentStatus === "Cancelled") throw new AppError("Cancelled Orders cannot change status.", 409);

  if (nextStatus === "Cancelled") {
    if (!CANCELLABLE_ORDER_STATUSES.includes(currentStatus)) {
      throw new AppError("Orders can be cancelled only before Printing starts.", 409);
    }
    return;
  }

  if (activeStatusRank.get(nextStatus) < activeStatusRank.get(currentStatus)) {
    throw new AppError("Order status cannot move backward.", 409);
  }
};

const restoreOrderStock = async (order, ProductModel) => {
  for (const item of order.items || []) {
    const product = await ProductModel.findById(item.product);
    if (!product?.variants?.length) continue;

    const variant = item.variantSku
      ? product.variants.find((entry) => entry.sku && entry.sku === item.variantSku)
      : product.variants.find(
          (entry) =>
            String(entry.size || "") === String(item.size || "") &&
            String(entry.color || "") === String(item.color || "") &&
            String(entry.material || "") === String(item.material || "") &&
            String(entry.printType || "") === String(item.printType || "") &&
            String(entry.finish || "") === String(item.finish || "")
        );

    if (variant) {
      variant.stock += Number(item.quantity || 0);
      await product.save();
    }
  }
};

export const transitionOrderStatus = async ({
  orderId,
  nextStatus,
  message,
  adminId,
  walletCancellation = finalizeWalletCancellation,
  now = new Date(),
  OrderModel = Order,
  ProductModel = Product
}) => {
  assertCanonicalOrderStatus(nextStatus);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await OrderModel.findById(orderId);
    if (!current) throw new AppError("Order not found.", 404);

    assertOrderStatusTransition(current.orderStatus, nextStatus);
    if (nextStatus === "Cancelled" && current.paymentMethod === "WALLET") {
      return walletCancellation({ orderId, adminId, now });
    }
    if (current.orderStatus === nextStatus) return { order: current, changed: false };

    const set = { orderStatus: nextStatus };
    if (nextStatus === "Shipped" && !current.shippedAt) set.shippedAt = now;
    if (nextStatus === "Delivered") set.deliveredAt = now;

    const order = await OrderModel.findOneAndUpdate(
      { _id: orderId, orderStatus: current.orderStatus },
      {
        $set: set,
        $push: {
          trackingHistory: {
            status: nextStatus,
            message: String(message || defaultMessages[nextStatus]).trim(),
            timestamp: now
          }
        }
      },
      { new: true, runValidators: true }
    );

    if (!order) continue;

    // The compare-and-set above makes only the winning cancellation request
    // responsible for restoring inventory.
    if (nextStatus === "Cancelled" && order.paymentMethod === "ONLINE" && order.inventoryStatus === "Reserved") {
      await releaseOnlineInventoryReservation({
        orderId: order._id,
        now,
        requireExpired: false,
        dependencies: { OrderModel, ProductModel }
      });
      order.inventoryStatus = "Released";
    } else if (nextStatus === "Cancelled") {
      await restoreOrderStock(order, ProductModel);
    }
    return { order, changed: true };
  }

  throw new AppError("Order status changed concurrently. Please retry.", 409);
};
