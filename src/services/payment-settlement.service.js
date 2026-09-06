import mongoose from "mongoose";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import { AppError } from "../utils/appError.js";

const useSession = (query, session) => session && typeof query?.session === "function" ? query.session(session) : query;

export const isExactCodAdvanceSettledState = (order, amount, paymentId) => {
  const paid = Number(order.onlineAmountPaid || 0);
  const required = Number(order.onlineAdvanceRequired || 0);
  const expectedRemaining = Math.max(0, Number(order.totalAmount || 0) - paid - Number(order.codAmountCollected || 0));
  const settledPaymentId = String(order.codAdvancePayment || "");
  const expectedPaymentId = String(paymentId || "");
  return (
    paid === amount &&
    required === amount &&
    Number(order.remainingCodDue) === expectedRemaining &&
    Boolean(settledPaymentId) &&
    Boolean(expectedPaymentId) &&
    settledPaymentId === expectedPaymentId
  );
};

export const isExactFullOnlineSettledState = (order, amount, paymentId) => {
  const settledPaymentId = String(order.onlinePayment || "");
  const expectedPaymentId = String(paymentId || "");
  return (
    order.paymentMethod === "ONLINE" &&
    order.orderStatus !== "Cancelled" &&
    Number(order.totalAmount) === amount &&
    Number(order.onlineAmountPaid) === amount &&
    Number(order.codAmountCollected || 0) === 0 &&
    Number(order.remainingCodDue) === 0 &&
    Number(order.potentialCodAmount) === 0 &&
    order.paymentStatus === "Paid" &&
    order.inventoryStatus === "Committed" &&
    Boolean(settledPaymentId) &&
    Boolean(expectedPaymentId) &&
    settledPaymentId === expectedPaymentId
  );
};

export const settleCapturedCodAdvancePayment = async ({
  orderId,
  paymentId,
  providerPaymentId,
  providerSignature = null,
  OrderModel = Order,
  PaymentModel = Payment
}) => {
  let payment = await PaymentModel.findOne({
    _id: paymentId,
    order: orderId,
    provider: "razorpay",
    purpose: "COD_ADVANCE"
  });
  if (!payment) throw new AppError("Payment attempt not found.", 404);
  if (!providerPaymentId || (payment.providerPaymentId && payment.providerPaymentId !== providerPaymentId)) {
    throw new AppError("Payment details do not match this payment attempt.", 409);
  }

  payment = await PaymentModel.findOneAndUpdate(
    {
      _id: payment._id,
      order: orderId,
      $or: [{ providerPaymentId: null }, { providerPaymentId: "" }, { providerPaymentId }]
    },
    { providerPaymentId },
    { new: true, runValidators: true }
  );
  if (!payment) throw new AppError("Payment details do not match this payment attempt.", 409);

  let order = await OrderModel.findById(orderId);
  if (!order) throw new AppError("Order not found.", 404);
  const amount = Number(payment.amount);
  if (order.paymentMethod !== "COD" || payment.currency !== "INR" || !Number.isSafeInteger(amount * 100) || amount <= 0 || amount !== Number(order.onlineAdvanceRequired)) {
    throw new AppError("Payment amount does not match this order's required advance.", 409);
  }

  if (payment.status !== "Captured" && !isExactCodAdvanceSettledState(order, amount, payment._id)) {
    order = await OrderModel.findOneAndUpdate(
      {
        _id: orderId,
        onlineAdvanceRequired: amount,
        onlineAmountPaid: 0,
        codAdvancePayment: null
      },
      [
        { $set: { onlineAmountPaid: amount, codAdvancePayment: payment._id } },
        {
          $set: {
            remainingCodDue: { $max: [0, { $subtract: [{ $subtract: ["$totalAmount", amount] }, "$codAmountCollected"] }] },
            potentialCodAmount: { $max: [0, { $subtract: [{ $subtract: ["$totalAmount", amount] }, "$codAmountCollected"] }] }
          }
        },
        {
          $set: {
            paymentStatus: { $cond: [{ $gt: ["$remainingCodDue", 0] }, "AdvancePaid", "Paid"] }
          }
        }
      ],
      { new: true }
    );

    if (!order) {
      order = await OrderModel.findById(orderId);
      if (!order || !isExactCodAdvanceSettledState(order, amount, payment._id)) {
        throw new AppError("This advance payment has already been settled or is being processed.", 409);
      }
    }
  } else if (payment.status === "Captured" && !isExactCodAdvanceSettledState(order, amount, payment._id)) {
    throw new AppError("Captured payment financial state requires reconciliation.", 409);
  }

  const capturedPayment = await PaymentModel.findOneAndUpdate(
    {
      _id: payment._id,
      order: orderId,
      providerPaymentId
    },
    {
      providerPaymentId,
      ...(providerSignature ? { providerSignature } : {}),
      status: "Captured",
      capturedAt: payment.capturedAt || new Date(),
      advanceAttemptKey: null
    },
    { new: true }
  );
  if (!capturedPayment) throw new AppError("Payment details do not match this payment attempt.", 409);

  return { order, payment: capturedPayment };
};

const settleFullOnlineWithinBoundary = async ({
  orderId,
  paymentId,
  providerPaymentId,
  providerSignature,
  session,
  OrderModel,
  PaymentModel,
  ProductModel
}) => {
  let payment = await useSession(PaymentModel.findOne({
    _id: paymentId,
    order: orderId,
    provider: "razorpay",
    purpose: "FULL_ONLINE"
  }), session);
  if (!payment) throw new AppError("Payment attempt not found.", 404);
  if (!providerPaymentId || (payment.providerPaymentId && payment.providerPaymentId !== providerPaymentId)) {
    throw new AppError("Payment details do not match this payment attempt.", 409);
  }

  payment = await PaymentModel.findOneAndUpdate(
    {
      _id: payment._id,
      order: orderId,
      purpose: "FULL_ONLINE",
      $or: [{ providerPaymentId: null }, { providerPaymentId: "" }, { providerPaymentId }]
    },
    { providerPaymentId },
    { new: true, runValidators: true, ...(session ? { session } : {}) }
  );
  if (!payment) throw new AppError("Payment details do not match this payment attempt.", 409);

  let order = await useSession(OrderModel.findById(orderId), session);
  if (!order) throw new AppError("Order not found.", 404);
  if (order.orderStatus === "Cancelled") {
    throw new AppError("Captured payment for a cancelled Order requires manual reconciliation.", 409);
  }
  if (order.paymentMethod !== "ONLINE") {
    throw new AppError("This Order is not eligible for a full online payment.", 409);
  }

  const amount = Number(payment.amount);
  if (payment.currency !== "INR" || !Number.isSafeInteger(amount * 100) || !Number.isInteger(amount) || amount <= 0 || amount !== Number(order.totalAmount)) {
    throw new AppError("Payment amount does not match this Order's total.", 409);
  }

  if (payment.status !== "Captured" && !isExactFullOnlineSettledState(order, amount, payment._id)) {
    order = await OrderModel.findOneAndUpdate(
      {
        _id: orderId,
        paymentMethod: "ONLINE",
        orderStatus: { $ne: "Cancelled" },
        paymentStatus: "Pending",
        inventoryStatus: "Reserved",
        totalAmount: amount,
        onlineAmountPaid: 0,
        codAmountCollected: 0,
        onlinePayment: null
      },
      {
        $set: {
          onlineAmountPaid: amount,
          remainingCodDue: 0,
          potentialCodAmount: 0,
          paymentStatus: "Paid",
          inventoryStatus: "Committed",
          onlinePayment: payment._id
        }
      },
      { new: true, runValidators: true, ...(session ? { session } : {}) }
    );

    if (order) {
      for (const item of order.items || []) {
        const salesUpdate = await ProductModel.updateOne(
          { _id: item.product },
          { $inc: { soldCount: Number(item.quantity || 0) } },
          session ? { session } : undefined
        );
        if (salesUpdate?.matchedCount === 0) {
          throw new AppError("Online Order sales count requires reconciliation.", 409);
        }
      }
    } else {
      order = await useSession(OrderModel.findById(orderId), session);
      if (!order || !isExactFullOnlineSettledState(order, amount, payment._id)) {
        throw new AppError("This full online payment cannot be settled against the current inventory state. Manual reconciliation is required.", 409);
      }
    }
  } else if (payment.status === "Captured" && !isExactFullOnlineSettledState(order, amount, payment._id)) {
    throw new AppError("Captured payment financial or inventory state requires reconciliation.", 409);
  }

  const capturedPayment = await PaymentModel.findOneAndUpdate(
    {
      _id: payment._id,
      order: orderId,
      purpose: "FULL_ONLINE",
      providerPaymentId
    },
    {
      providerPaymentId,
      ...(providerSignature ? { providerSignature } : {}),
      status: "Captured",
      capturedAt: payment.capturedAt || new Date()
    },
    { new: true, runValidators: true, ...(session ? { session } : {}) }
  );
  if (!capturedPayment) throw new AppError("Payment details do not match this payment attempt.", 409);

  return { order, payment: capturedPayment };
};

export const settleCapturedFullOnlinePayment = async ({
  orderId,
  paymentId,
  providerPaymentId,
  providerSignature = null,
  OrderModel = Order,
  PaymentModel = Payment,
  ProductModel = Product,
  startSession
}) => {
  const sessionFactory = startSession === undefined && OrderModel === Order && PaymentModel === Payment && ProductModel === Product
    ? () => mongoose.startSession()
    : startSession;

  if (!sessionFactory) {
    return settleFullOnlineWithinBoundary({
      orderId, paymentId, providerPaymentId, providerSignature,
      session: null, OrderModel, PaymentModel, ProductModel
    });
  }

  const session = await sessionFactory();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await settleFullOnlineWithinBoundary({
        orderId, paymentId, providerPaymentId, providerSignature,
        session, OrderModel, PaymentModel, ProductModel
      });
    });
  } finally {
    await session.endSession();
  }
  return result;
};

export const settleCapturedPayment = async ({
  payment,
  providerPaymentId,
  providerSignature = null,
  OrderModel = Order,
  PaymentModel = Payment,
  ProductModel = Product,
  startSession
}) => {
  if (!payment?._id || !payment.order || payment.provider !== "razorpay") {
    throw new AppError("Persisted Razorpay payment attribution is invalid.", 409);
  }

  const settlement = {
    orderId: payment.order,
    paymentId: payment._id,
    providerPaymentId,
    providerSignature,
    OrderModel,
    PaymentModel
  };

  if (payment.purpose === "COD_ADVANCE") {
    return settleCapturedCodAdvancePayment(settlement);
  }
  if (payment.purpose === "FULL_ONLINE") {
    return settleCapturedFullOnlinePayment({ ...settlement, ProductModel, startSession });
  }
  throw new AppError("Unsupported Razorpay payment purpose. Manual reconciliation is required.", 409);
};
