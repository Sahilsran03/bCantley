import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { AppError } from "../utils/appError.js";

export const ONLINE_INVENTORY_RESERVATION_MS = 20 * 60 * 1000;

export const getOnlineInventoryReservationWindow = (now = new Date()) => ({
  inventoryReservedAt: now,
  inventoryReservationExpiresAt: new Date(now.getTime() + ONLINE_INVENTORY_RESERVATION_MS)
});

const resolveVariant = (product, item) => {
  if (!product?.variants?.length) return null;
  if (item.variantSku) {
    const matches = product.variants.filter((variant) => variant.sku && variant.sku === item.variantSku);
    if (matches.length !== 1) throw new AppError("Reserved inventory SKU requires reconciliation.", 409);
    return matches[0];
  }

  const matches = product.variants.filter((variant) =>
    String(variant.size || "") === String(item.size || "") &&
    String(variant.color || "") === String(item.color || "") &&
    String(variant.material || "") === String(item.material || "") &&
    String(variant.printType || "") === String(item.printType || "") &&
    String(variant.finish || "") === String(item.finish || "")
  );
  if (matches.length !== 1) throw new AppError("Reserved inventory variant requires reconciliation.", 409);
  return matches[0];
};

const useSession = (query, session) => session && typeof query?.session === "function" ? query.session(session) : query;

const releaseWithinBoundary = async ({
  orderId,
  now,
  requireExpired,
  session,
  OrderModel,
  ProductModel
}) => {
  const releaseQuery = {
    _id: orderId,
    paymentMethod: "ONLINE",
    paymentStatus: { $in: ["Pending", "Failed"] },
    inventoryStatus: "Reserved",
    ...(requireExpired ? { inventoryReservationExpiresAt: { $lte: now } } : {})
  };
  const releasedOrder = await OrderModel.findOneAndUpdate(
    releaseQuery,
    { $set: { inventoryStatus: "Released" } },
    { new: true, runValidators: true, ...(session ? { session } : {}) }
  );

  if (!releasedOrder) {
    const current = await useSession(OrderModel.findById(orderId), session);
    return { released: false, order: current || null };
  }

  for (const item of releasedOrder.items || []) {
    const product = await useSession(ProductModel.findById(item.product), session);
    if (!product) throw new AppError("Reserved product requires reconciliation.", 409);
    const variant = resolveVariant(product, item);
    if (!variant) continue;
    variant.stock += Number(item.quantity || 0);
    await product.save(session ? { session } : undefined);
  }

  return { released: true, order: releasedOrder };
};

export const releaseOnlineInventoryReservation = async ({
  orderId,
  now = new Date(),
  requireExpired = true,
  dependencies = {}
}) => {
  const OrderModel = dependencies.OrderModel || Order;
  const ProductModel = dependencies.ProductModel || Product;
  const startSession = dependencies.startSession === undefined && OrderModel === Order && ProductModel === Product
    ? () => mongoose.startSession()
    : dependencies.startSession;

  if (!startSession) {
    return releaseWithinBoundary({ orderId, now, requireExpired, session: null, OrderModel, ProductModel });
  }

  const session = await startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await releaseWithinBoundary({ orderId, now, requireExpired, session, OrderModel, ProductModel });
    });
  } finally {
    await session.endSession();
  }
  return result;
};
