import Order from "../models/Order.js";
import { AppError } from "../utils/appError.js";

const eligiblePaymentStatuses = ["Pending", "AdvancePaid"];

const financialInvariantHolds = (order) =>
  Number(order.onlineAmountPaid) + Number(order.codAmountCollected) + Number(order.remainingCodDue) === Number(order.totalAmount);

export const collectRemainingCod = async ({ orderId, adminId, amount, now = new Date(), OrderModel = Order }) => {
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    throw new AppError("COD collection amount must be a positive whole-INR number.", 400);
  }

  const order = await OrderModel.findOneAndUpdate(
    {
      _id: orderId,
      paymentMethod: "COD",
      orderStatus: "Delivered",
      paymentStatus: { $in: eligiblePaymentStatuses },
      remainingCodDue: amount,
      $expr: {
        $and: [
          { $gt: ["$remainingCodDue", 0] },
          { $gte: ["$onlineAmountPaid", "$onlineAdvanceRequired"] },
          {
            $eq: [
              { $add: ["$onlineAmountPaid", "$codAmountCollected", "$remainingCodDue"] },
              "$totalAmount"
            ]
          }
        ]
      }
    },
    [
      {
        $set: {
          codAmountCollected: { $add: ["$codAmountCollected", "$remainingCodDue"] },
          remainingCodDue: 0,
          potentialCodAmount: 0,
          paymentStatus: "Paid",
          codCollectedAt: now,
          codCollectedBy: adminId
        }
      }
    ],
    { new: true }
  );

  if (order) return order;

  const current = await OrderModel.findById(orderId);
  if (!current) throw new AppError("Order not found.", 404);
  if (current.paymentMethod !== "COD") throw new AppError("This Order is not eligible for COD collection.", 409);
  if (current.orderStatus !== "Delivered") throw new AppError("COD collection can only be confirmed for a Delivered Order.", 409);
  if (current.paymentStatus === "Paid" || Number(current.remainingCodDue) === 0) {
    throw new AppError("COD collection has already been completed.", 409);
  }
  if (!eligiblePaymentStatuses.includes(current.paymentStatus)) {
    throw new AppError("This Order is not in an eligible payment state for COD collection.", 409);
  }
  if (Number(current.onlineAmountPaid) < Number(current.onlineAdvanceRequired)) {
    throw new AppError("The required online advance must be paid before COD collection.", 409);
  }
  if (!financialInvariantHolds(current)) {
    throw new AppError("Order financial state requires reconciliation before COD collection.", 409);
  }
  if (Number(current.remainingCodDue) !== amount) {
    throw new AppError("COD collection amount does not match the current remaining COD due.", 409);
  }
  throw new AppError("COD collection could not be confirmed because the Order changed. Please retry.", 409);
};
