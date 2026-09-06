import mongoose from "mongoose";
import { debitWallet } from "../services/wallet.service.js";
import crypto from "node:crypto";
import Cart from "../models/Cart.js";
import CheckoutAttempt from "../models/CheckoutAttempt.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getLoyaltyRank } from "../utils/loyalty.js";
import { calculateCartPricing, incrementCouponUsage } from "../services/pricing.service.js";
import { calculateCodTerms } from "../services/cod.service.js";
import {
  assertCustomerOwnsOrder,
  buildCodAdvanceRazorpayOrder,
  createRazorpayClient,
  fetchAndValidateCapturedRazorpayPayment,
  validateCodAdvanceEligibility,
  validateRazorpayIdentifiers,
  verifyRazorpayPaymentSignature
} from "../services/razorpay.service.js";
import { settleCapturedCodAdvancePayment } from "../services/payment-settlement.service.js";
import { env } from "../config/env.js";
import { checkShippingByPostalCode } from "../services/shipping.service.js";
import { createNotification } from "../services/notification.service.js";
import { emailTemplates, sendTemplateEmail } from "../services/email.service.js";
import { validateCheckoutInput, validateCheckoutPreviewInput, validateCodCollection, validateOrderStatus } from "../validators/order.validator.js";
import { collectRemainingCod } from "../services/cod-collection.service.js";
import { transitionOrderStatus } from "../services/order-status.service.js";
import { assertCurrentCartVersion, assertShippingForPaymentMethod, buildCheckoutPreview, withAuthoritativeCartPrices, withCodDisplayValues } from "../services/checkout-preview.service.js";
import { allocateRefundableMerchandise } from "../utils/refundMoney.js";
import { getOnlineInventoryReservationWindow, releaseOnlineInventoryReservation } from "../services/inventory-reservation.service.js";

const useSession = (query, session) => session && typeof query?.session === "function" ? query.session(session) : query;

const matchesSelectedOptions = (variant, selectedOptions) =>
  ["size", "color", "material", "printType", "finish"].every(
    (field) => String(variant[field] || "") === String(selectedOptions[field] || "")
  );

const findVariant = (product, cartItem) => {
  if (cartItem.variantSku) {
    return product.variants.find((variant) => variant.sku && variant.sku === cartItem.variantSku);
  }

  return product.variants.find((variant) => matchesSelectedOptions(variant, cartItem.selectedOptions || {}));
};

const generateOrderNumber = () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CNT-${datePart}-${randomPart}`;
};

const createOrderNumber = async (session = null) => {
  for (let index = 0; index < 5; index += 1) {
    const orderNumber = generateOrderNumber();
    const exists = await useSession(Order.exists({ orderNumber }), session);

    if (!exists) {
      return orderNumber;
    }
  }

  throw new AppError("Unable to generate order number.", 500);
};

const calculateAdvance = (totalAmount) => {
  return Math.min(totalAmount, Math.max(100, Math.ceil(totalAmount * 0.2)));
};

export const buildOrderItemsAndStockUpdates = async (cart, { session = null, strictInventory = false } = {}) => {
  const requestedStock = new Map();
  const orderItems = [];
  const stockUpdates = [];

  for (const cartItem of cart.items) {
    const product = await useSession(Product.findById(cartItem.product?._id || cartItem.product), session);

    if (!product || !product.isActive) {
      throw new AppError("One or more Cart products are no longer available.", 400);
    }

    if (strictInventory && (!Number.isInteger(cartItem.quantity) || cartItem.quantity < 1)) {
      throw new AppError("Please review Cart quantities.", 400);
    }
    const variant = product.variants.length ? findVariant(product, cartItem) : null;
    if (strictInventory && variant) {
      const matches = product.variants.filter((item) => cartItem.variantSku
        ? item.sku === cartItem.variantSku
        : matchesSelectedOptions(item, cartItem.selectedOptions || {}));
      if (matches.length !== 1) throw new AppError("Cart variant requires reconciliation.", 409);
      const stockKey = `${product._id}:${product.variants.indexOf(variant)}`;
      const requested = (requestedStock.get(stockKey) || 0) + cartItem.quantity;
      requestedStock.set(stockKey, requested);
      if (variant.stock < requested) throw new AppError(`${product.name} does not have enough stock.`, 400);
    }

    if (product.variants.length && !variant) {
      throw new AppError(`Please review variants for ${product.name}.`, 400);
    }

    if (variant && variant.stock < cartItem.quantity) {
      throw new AppError(`${product.name} does not have enough stock.`, 400);
    }

    const priceModifier = Number(variant?.priceModifier || 0);
    const finalPrice = Number(product.basePrice || 0) + priceModifier;

    orderItems.push({
      product: product._id,
      name: product.name,
      productType: product.productType,
      image: product.images?.[0] || "",
      size: variant?.size || cartItem.selectedOptions?.size || "",
      color: variant?.color || cartItem.selectedOptions?.color || "",
      material: variant?.material || cartItem.selectedOptions?.material || "",
      printType: variant?.printType || cartItem.selectedOptions?.printType || "",
      finish: variant?.finish || cartItem.selectedOptions?.finish || "",
      shape: variant?.shape || cartItem.selectedOptions?.shape || "",
      width: variant?.width ?? cartItem.selectedOptions?.width ?? null,
      height: variant?.height ?? cartItem.selectedOptions?.height ?? null,
      unit: variant?.unit || cartItem.selectedOptions?.unit || "",
      waterproof: Boolean(variant?.waterproof ?? cartItem.selectedOptions?.waterproof),
      quantity: cartItem.quantity,
      unitPrice: Number(product.basePrice || 0),
      priceModifier,
      finalPrice,
      codAvailable: product.codAvailable !== false,
      codAdvanceAmount: Math.max(0, Number(product.codAdvanceAmount || 0)),
      customNotes: "",
      variantSku: variant?.sku || cartItem.variantSku || "",
      customDesign: cartItem.customDesign || null,
      designPreview: cartItem.designPreview || null,
      designData: cartItem.designData || null
    });

    if (variant) {
      stockUpdates.push({
        productId: product._id,
        sku: variant.sku,
        selectedOptions: {
          size: variant.size,
          color: variant.color,
          material: variant.material,
          printType: variant.printType,
          finish: variant.finish
        },
        quantity: cartItem.quantity
      });
    }
  }

  return { orderItems, stockUpdates };
};

export const reduceStock = async (stockUpdates, { session = null } = {}) => {
  for (const update of stockUpdates) {
    const product = await useSession(Product.findById(update.productId), session);
    const variant = update.sku
      ? product.variants.find((item) => item.sku && item.sku === update.sku)
      : product.variants.find((item) => matchesSelectedOptions(item, update.selectedOptions));

    if (!variant || variant.stock < update.quantity) {
      throw new AppError("Stock changed while creating order. Please review your Cart.", 409);
    }

    variant.stock -= update.quantity;
    await product.save(session ? { session } : undefined);
  }
};

const incrementProductSales = async (orderItems, { session = null } = {}) => {
  if (session) {
    for (const item of orderItems) {
      await Product.updateOne({ _id: item.product }, { $inc: { soldCount: Number(item.quantity || 0) } }, { session });
    }
    return;
  }
  await Promise.all(
    orderItems.map((item) =>
      Product.updateOne(
        { _id: item.product },
        { $inc: { soldCount: Number(item.quantity || 0) } }
      )
    )
  );
};

const findCustomerOrder = async (userId, orderId) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError("Order not found.", 404);
  }

  const order = await Order.findOne({ _id: orderId, user: userId }).populate("user", "name email phone");

  if (!order) {
    throw new AppError("Order not found.", 404);
  }

  return order;
};

const getIdempotencyKey = (req) => {
  const key = String(req.get("Idempotency-Key") || "").trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(key)) {
    throw new AppError("A valid Idempotency-Key header is required.", 400);
  }

  return key;
};

const createCheckoutFingerprint = (userId, payload) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        user: String(userId),
        cartVersion: payload.expectedCartVersion,
        shippingAddress: payload.shippingAddress,
        notes: payload.notes,
        couponCode: payload.couponCode,
        paymentMethod: payload.paymentMethod
      })
    )
    .digest("hex");

export const respondForExistingAttempt = async (res, userId, attempt, fingerprint, { OrderModel = Order, releaseReservation = releaseOnlineInventoryReservation } = {}) => {
  if (attempt.requestFingerprint !== fingerprint) {
    throw new AppError("This Idempotency-Key was already used for a different checkout request.", 409);
  }

  let order = await OrderModel.findOne({ user: userId, checkoutIdempotencyKey: attempt.key });
  if (!order && attempt.status === "Completed") {
    order = await OrderModel.findOne({ _id: attempt.order, user: userId });
  }
  if (order) {
    if (order.paymentMethod === "ONLINE" && order.paymentStatus !== "Pending" &&
        !(order.paymentStatus === "Paid" && order.inventoryStatus === "Committed")) {
      throw new AppError("Online inventory reservation is no longer payable. Start a new checkout attempt.", 409);
    }
    if (order.paymentMethod === "ONLINE" && order.paymentStatus === "Pending") {
      const expiresAt = order.inventoryReservationExpiresAt && new Date(order.inventoryReservationExpiresAt);
      const hasValidExpiry = expiresAt && Number.isFinite(expiresAt.getTime());
      if (order.inventoryStatus === "Reserved" && !hasValidExpiry) {
        throw new AppError("Online inventory reservation expiry is invalid. Start a new checkout attempt.", 409);
      }
      if (order.inventoryStatus === "Reserved" && expiresAt <= new Date()) {
        const release = await releaseReservation({ orderId: order._id });
        if (!release.released && release.order?.paymentStatus === "Paid" && release.order?.inventoryStatus === "Committed") {
          order = release.order;
        } else {
          throw new AppError("Online inventory reservation expired. Start a new checkout attempt.", 409);
        }
      }
      if (order.paymentStatus === "Pending" && order.inventoryStatus !== "Reserved") {
        throw new AppError("Online inventory reservation is no longer payable. Start a new checkout attempt.", 409);
      }
    }
    if (attempt.status !== "Completed" || String(attempt.order || "") !== String(order._id)) {
      attempt.status = "Completed";
      attempt.order = order._id;
      attempt.responsePayload = { orderId: order._id.toString() };
      attempt.completedAt = attempt.completedAt || new Date();
      try {
        await attempt.save();
      } catch {
        // The Order is authoritative once created; attempt repair is best-effort.
      }
    }

    res.status(201).json({ success: true, order: withCodDisplayValues(order) });
    return;
  }

  if (attempt.status === "Processing") {
    throw new AppError("This checkout request is already being processed.", 409);
  }

  if (attempt.status === "Failed") {
    throw new AppError("This checkout request failed. Please start a new checkout attempt.", 409);
  }

  throw new AppError("The completed checkout result is unavailable.", 500);
};

export const checkoutPreview = asyncHandler(async (req, res) => {
  const payload = validateCheckoutPreviewInput(req.body);
  const cart = await Cart.findOne({ user: req.user._id }).populate("items.product", "name slug images basePrice isActive category");
  if (!cart || !cart.items.length) throw new AppError("Your Cart is empty.", 400);
  assertCurrentCartVersion(cart, payload.expectedCartVersion);

  const { orderItems } = await buildOrderItemsAndStockUpdates(cart, { strictInventory: payload.paymentMethod !== "COD" });
  withAuthoritativeCartPrices(cart, orderItems);
  const couponCode = payload.couponCode || cart.appliedCouponCode || "";
  const pricing = await calculateCartPricing(cart, couponCode);
  const shipping = await checkShippingByPostalCode(payload.postalCode, payload.country);
  assertShippingForPaymentMethod(shipping, payload.paymentMethod);
  const walletUser = payload.paymentMethod === "WALLET" ? await User.findById(req.user._id).select("walletBalance") : null;
  if (payload.paymentMethod === "WALLET" && !walletUser) throw new AppError("Customer account not found.", 404);
  const preview = buildCheckoutPreview({ pricing, shipping, orderItems, paymentMethod: payload.paymentMethod, walletBalance: walletUser?.walletBalance });
  res.status(200).json({ success: true, preview });
});

const createTransactionalCheckout = async ({ req, res, payload, key, fingerprint, dependencies = {} }) => {
  const isWallet = payload.paymentMethod === "WALLET";
  const method = isWallet ? "WALLET" : "ONLINE";
  const {
    CartModel = Cart, CheckoutAttemptModel = CheckoutAttempt, OrderModel = Order,
    startSession = () => mongoose.startSession(),
    buildItems = buildOrderItemsAndStockUpdates, reduceInventory = reduceStock,
    calculatePricing = calculateCartPricing, checkShipping = checkShippingByPostalCode,
    incrementCoupon = incrementCouponUsage, orderNumberFactory = createOrderNumber,
    notify = createNotification, sendEmail = sendTemplateEmail,
    respondExisting = respondForExistingAttempt, debit = debitWallet, incrementSales = incrementProductSales
  } = dependencies;
  const session = await startSession();
  let order;
  let replayAttempt;
  try {
    await session.withTransaction(async () => {
      order = undefined;
      replayAttempt = undefined;
      // The Order outlives CheckoutAttempt's seven-day TTL.
      const existingOrder = await useSession(OrderModel.findOne({ user: req.user._id, checkoutIdempotencyKey: key }), session);
      if (existingOrder) {
        replayAttempt = {
          key, requestFingerprint: existingOrder.checkoutRequestFingerprint,
          status: "Completed", order: existingOrder._id
        };
        return;
      }
      const [attempt] = await CheckoutAttemptModel.create([{
        user: req.user._id,
        key,
        requestFingerprint: fingerprint,
        cartVersion: payload.expectedCartVersion
      }], { session });

      const cart = await useSession(
        CartModel.findOne({ user: req.user._id }).populate("items.product", "name slug images basePrice isActive category"),
        session
      );
      if (!cart || !cart.items.length) throw new AppError("Your Cart is empty.", 400);
      assertCurrentCartVersion(cart, payload.expectedCartVersion);

      const { orderItems: pricedOrderItems, stockUpdates } = await buildItems(cart, { session, strictInventory: true });
      withAuthoritativeCartPrices(cart, pricedOrderItems);
      const couponCode = payload.couponCode || cart.appliedCouponCode || "";
      const pricing = await calculatePricing(cart, couponCode, { session });
      const shipping = await checkShipping(
        payload.shippingAddress.postalCode,
        payload.shippingAddress.country,
        { session }
      );
      assertShippingForPaymentMethod(shipping, method);

      const subtotal = pricing.subtotal;
      const { shippingFee, totalAmount } = buildCheckoutPreview({
        pricing, shipping, orderItems: pricedOrderItems, paymentMethod: method
      });
      const discount = pricing.discountAmount;
      const orderItems = allocateRefundableMerchandise({
        orderItems: pricedOrderItems,
        merchandisePayable: pricing.totalAmount
      });
      const reservation = isWallet ? {} : getOnlineInventoryReservationWindow(new Date());
      const orderId = new mongoose.Types.ObjectId();
      const walletPosting = isWallet ? await debit({
        userId: req.user._id, amount: totalAmount, purpose: "ORDER_PAYMENT",
        orderId, idempotencyKey: `wallet-order-payment:${orderId}`, session
      }) : null;

      await reduceInventory(stockUpdates, { session });
      if (isWallet) await incrementSales(orderItems, { session });
      [order] = await OrderModel.create([{
        _id: orderId,
        ...(isWallet ? { walletPayment: walletPosting.transaction._id } : {}),
        user: req.user._id,
        orderNumber: await orderNumberFactory(session),
        checkoutIdempotencyKey: key,
        checkoutRequestFingerprint: fingerprint,
        items: orderItems,
        shippingAddress: payload.shippingAddress,
        subtotal,
        shippingFee,
        discount,
        discountAmount: discount,
        appliedCoupon: pricing.appliedCoupon || undefined,
        appliedOffers: pricing.appliedOffers,
        advanceAmount: 0,
        remainingAmount: isWallet ? 0 : totalAmount,
        totalAmount,
        onlineAdvanceRequired: 0,
        onlineAmountPaid: 0,
        remainingCodDue: 0,
        codAmountCollected: 0,
        potentialCodAmount: 0,
        onlinePayment: null,
        paymentMethod: method,
        paymentStatus: isWallet ? "Paid" : "Pending",
        orderStatus: "Pending",
        inventoryStatus: isWallet ? "Committed" : "Reserved",
        ...reservation,
        estimatedDeliveryDate: shipping.estimatedDeliveryDate,
        trackingHistory: [{
          status: "Pending",
          message: isWallet ? "Order paid using Wallet. Cantley will confirm shipping details soon." : "Online Order reserved. Complete payment before the reservation expires.",
          timestamp: new Date()
        }],
        notes: payload.notes
      }], { session });

      cart.items = [];
      cart.appliedCouponCode = "";
      cart.version += 1;
      await cart.save({ session });
      await incrementCoupon(pricing.appliedCoupon?.code, { session });

      attempt.status = "Completed";
      attempt.order = order._id;
      attempt.responsePayload = { orderId: order._id.toString() };
      attempt.completedAt = new Date();
      await attempt.save({ session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicateAttempt = await CheckoutAttemptModel.findOne({ user: req.user._id, key });
      if (duplicateAttempt) {
        await respondExisting(res, req.user._id, duplicateAttempt, fingerprint);
        return;
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }

  if (replayAttempt) {
    await respondExisting(res, req.user._id, replayAttempt, fingerprint);
    return;
  }

  await Promise.allSettled([
    notify({
      user: req.user._id,
      title: isWallet ? "Order placed" : "Order reserved",
      message: isWallet ? `Your Cantley order ${order.orderNumber} is paid using Wallet.` : `Your Cantley Online Order ${order.orderNumber} is awaiting payment.`,
      type: "ORDER",
      link: `/orders/${order._id}`
    }),
    sendEmail({
      to: payload.shippingAddress.email,
      template: isWallet ? emailTemplates.orderConfirmation(order) : emailTemplates.onlineOrderReserved(order)
    })
  ]);

  res.status(201).json({ success: true, order: withCodDisplayValues(order) });
};
export const createPendingOnlineCheckout = (input) => createTransactionalCheckout(input);
export const createPaidWalletCheckout = (input) => createTransactionalCheckout(input);

export const checkout = asyncHandler(async (req, res) => {
  const payload = validateCheckoutInput(req.body);
  const key = getIdempotencyKey(req);
  const fingerprint = createCheckoutFingerprint(req.user._id, payload);
  const existingAttempt = await CheckoutAttempt.findOne({ user: req.user._id, key });

  if (existingAttempt) {
    await respondForExistingAttempt(res, req.user._id, existingAttempt, fingerprint);
    return;
  }

  if (payload.paymentMethod === "WALLET") {
    await createPaidWalletCheckout({ req, res, payload, key, fingerprint });
    return;
  }
  if (payload.paymentMethod === "ONLINE") {
    await createPendingOnlineCheckout({ req, res, payload, key, fingerprint });
    return;
  }

  const cart = await Cart.findOne({ user: req.user._id }).populate("items.product", "name slug images basePrice isActive category");

  if (!cart || !cart.items.length) {
    throw new AppError("Your Cart is empty.", 400);
  }

  assertCurrentCartVersion(cart, payload.expectedCartVersion);

  let attempt;
  let order = null;
  try {
    attempt = await CheckoutAttempt.create({
      user: req.user._id,
      key,
      requestFingerprint: fingerprint,
      cartVersion: payload.expectedCartVersion
    });
  } catch (error) {
    if (error.code !== 11000) throw error;

    const duplicateAttempt = await CheckoutAttempt.findOne({ user: req.user._id, key });
    if (!duplicateAttempt) throw error;
    await respondForExistingAttempt(res, req.user._id, duplicateAttempt, fingerprint);
    return;
  }

  try {
    const couponCode = payload.couponCode || cart.appliedCouponCode || "";
    const pricing = await calculateCartPricing(cart, couponCode);
    const shipping = await checkShippingByPostalCode(payload.shippingAddress.postalCode, payload.shippingAddress.country);

    if (shipping.isInternational) {
      throw new AppError("Contact WhatsApp for international shipping.", 400);
    }

    if (!shipping.isCODAvailable) {
      throw new AppError("COD is not available for this postal code.", 400);
    }

    const { orderItems: pricedOrderItems, stockUpdates } = await buildOrderItemsAndStockUpdates(cart);
    const subtotal = pricing.subtotal;
    const shippingFee = Number(shipping.shippingFee || 0);
    const discount = pricing.discountAmount;
    const totalAmount = Math.max(0, pricing.totalAmount + shippingFee);
    const advanceAmount = calculateAdvance(totalAmount);
    const remainingAmount = totalAmount - advanceAmount;
    const codTerms = calculateCodTerms({ orderItems: pricedOrderItems, totalAmount });
    const orderItems = allocateRefundableMerchandise({ orderItems: pricedOrderItems, merchandisePayable: pricing.totalAmount });

    await reduceStock(stockUpdates);
    await incrementProductSales(orderItems);

    order = await Order.create({
    user: req.user._id,
    orderNumber: await createOrderNumber(),
    checkoutIdempotencyKey: key,
    items: orderItems,
    shippingAddress: payload.shippingAddress,
    subtotal,
    shippingFee,
    discount,
    discountAmount: discount,
    appliedCoupon: pricing.appliedCoupon || undefined,
    appliedOffers: pricing.appliedOffers,
    advanceAmount,
    remainingAmount,
    totalAmount,
    onlineAdvanceRequired: codTerms.onlineAdvanceRequired,
    onlineAmountPaid: codTerms.onlineAmountPaid,
    remainingCodDue: codTerms.remainingCodDue,
    codAmountCollected: codTerms.codAmountCollected,
    potentialCodAmount: codTerms.potentialCodAmount,
    paymentMethod: payload.paymentMethod,
    paymentStatus: "Pending",
    orderStatus: "Pending",
    inventoryStatus: "Committed",
    estimatedDeliveryDate: shipping.estimatedDeliveryDate,
    trackingHistory: [
      {
        status: "Pending",
        message: "Order placed. Cantley will confirm shipping details soon.",
        timestamp: new Date()
      }
    ],
    notes: payload.notes
    });

    attempt.status = "Completed";
    attempt.order = order._id;
    attempt.responsePayload = { orderId: order._id.toString() };
    attempt.completedAt = new Date();
    await attempt.save();

    cart.items = [];
    cart.appliedCouponCode = "";
    await cart.save();
    await incrementCouponUsage(pricing.appliedCoupon?.code);
    await Promise.allSettled([
      createNotification({
        user: req.user._id,
        title: "Order placed",
        message: `Your Cantley order ${order.orderNumber} has been placed.`,
        type: "ORDER",
        link: `/orders/${order._id}`
      }),
      sendTemplateEmail({
        to: payload.shippingAddress.email,
        template: emailTemplates.orderConfirmation(order)
      })
    ]);

    res.status(201).json({
      success: true,
      order: withCodDisplayValues(order)
    });
  } catch (error) {
    if (!order) {
      attempt.status = "Failed";
      await attempt.save();
    }
    throw error;
  }
});

const sendPaymentInitiated = (res, order, payment) => {
  res.status(200).json({
    success: true,
    status: "PAYMENT_INITIATED",
    keyId: env.razorpayKeyId,
    razorpayOrderId: payment.providerOrderId,
    paymentId: payment._id.toString(),
    amount: payment.amount,
    currency: payment.currency,
    cantleyOrderId: order._id.toString()
  });
};

const advanceAttemptKeyFor = (orderId) => `cod-advance:${orderId}`;

export const createCodAdvanceInitiationHandler = ({
  OrderModel = Order, PaymentModel = Payment, createClient = createRazorpayClient,
  fetchCaptured = fetchAndValidateCapturedRazorpayPayment, settle = settleCapturedCodAdvancePayment
} = {}) => asyncHandler(async (req, res) => {
  const order = await OrderModel.findOne({ _id: req.params.id, user: req.user._id });
  assertCustomerOwnsOrder(order, req.user._id);

  const capturedPayments = await PaymentModel.find({
    user: req.user._id,
    order: order._id,
    provider: "razorpay",
    purpose: "COD_ADVANCE",
    status: "Captured"
  }).select("amount");
  const requiredAmount = validateCodAdvanceEligibility(order, capturedPayments);
  const razorpay = createClient();

  const reusablePayment = await PaymentModel.findOne({
    user: req.user._id,
    order: order._id,
    provider: "razorpay",
    purpose: "COD_ADVANCE",
    status: { $in: ["Created", "Pending"] },
    providerOrderId: { $type: "string", $ne: "" },
    amount: requiredAmount,
    currency: "INR"
  }).sort({ createdAt: -1 });
  if (reusablePayment) {
    // A provider-bound attempt may already be captured even if the Order update failed.
    // Reconcile that exact payment; never reopen Checkout for it.
    if (reusablePayment.providerPaymentId) {
      await fetchCaptured({ providerPaymentId: reusablePayment.providerPaymentId, payment: reusablePayment });
      const settled = await settle({
        orderId: order._id, paymentId: reusablePayment._id, providerPaymentId: reusablePayment.providerPaymentId
      });
      sendConfirmedPayment(res, settled.order, settled.payment);
      return;
    }
    sendPaymentInitiated(res, order, reusablePayment);
    return;
  }

  const inProgressPayment = await PaymentModel.findOne({
    user: req.user._id,
    order: order._id,
    provider: "razorpay",
    purpose: "COD_ADVANCE",
    status: "Created",
    providerOrderId: null,
    amount: requiredAmount,
    currency: "INR"
  }).sort({ createdAt: -1 });
  if (inProgressPayment) {
    throw new AppError("Your advance payment is being initialized. Please retry shortly.", 409);
  }

  const advanceAttemptKey = advanceAttemptKeyFor(order._id);
  let payment;
  try {
    payment = await PaymentModel.create({
      user: req.user._id,
      order: order._id,
      provider: "razorpay",
      purpose: "COD_ADVANCE",
      amount: requiredAmount,
      currency: "INR",
      status: "Created",
      advanceAttemptKey
    });
  } catch (error) {
    if (error.code !== 11000) throw error;

    const concurrentPayment = await PaymentModel.findOne({ advanceAttemptKey });
    if (concurrentPayment?.providerOrderId) {
      sendPaymentInitiated(res, order, concurrentPayment);
      return;
    }
    throw new AppError("Your advance payment is being initialized. Please retry shortly.", 409);
  }

  try {
    const razorpayOrder = await razorpay.orders.create(buildCodAdvanceRazorpayOrder({ order, payment }));
    payment.providerOrderId = razorpayOrder.id;
    payment.status = "Pending";
    await payment.save();
  } catch (error) {
    payment.status = "Failed";
    payment.advanceAttemptKey = null;
    payment.failureReason = "Unable to initialize the payment provider order.";
    payment.failedAt = new Date();
    await payment.save();
    throw new AppError("Unable to initialize the online advance payment. Please try again.", 502);
  }

  sendPaymentInitiated(res, order, payment);
});

export const createCodAdvancePayment = createCodAdvanceInitiationHandler();

const sendConfirmedPayment = (res, order, payment) => {
  res.status(200).json({
    success: true,
    status: "PAYMENT_CONFIRMED",
    paymentId: payment._id.toString(),
    orderId: order._id.toString(),
    onlineAdvanceRequired: order.onlineAdvanceRequired,
    onlineAmountPaid: order.onlineAmountPaid,
    remainingCodDue: order.remainingCodDue,
    codAmountCollected: order.codAmountCollected
  });
};

export const createCodAdvanceVerificationHandler = ({
  OrderModel = Order, PaymentModel = Payment,
  verifySignature = verifyRazorpayPaymentSignature,
  fetchCaptured = fetchAndValidateCapturedRazorpayPayment,
  settle = settleCapturedCodAdvancePayment
} = {}) => asyncHandler(async (req, res) => {
  const identifiers = validateRazorpayIdentifiers(req.body);
  const order = await OrderModel.findOne({ _id: req.params.id, user: req.user._id });
  assertCustomerOwnsOrder(order, req.user._id);

  const payment = await PaymentModel.findOne({
    user: req.user._id,
    order: order._id,
    provider: "razorpay",
    purpose: "COD_ADVANCE",
    providerOrderId: identifiers.razorpay_order_id
  });
  if (!payment) throw new AppError("Payment attempt not found.", 404);
  if (order.paymentMethod !== "COD" || payment.currency !== "INR" || payment.amount !== order.onlineAdvanceRequired) {
    throw new AppError("Payment amount does not match this order's required advance.", 409);
  }

  if (!verifySignature({
    providerOrderId: payment.providerOrderId,
    providerPaymentId: identifiers.razorpay_payment_id,
    signature: identifiers.razorpay_signature
  })) {
    throw new AppError("Payment signature verification failed.", 400);
  }

  if (payment.status === "Captured") {
    if (payment.providerPaymentId !== identifiers.razorpay_payment_id) {
      throw new AppError("Payment details do not match this payment attempt.", 409);
    }
    const settled = await settle({
      orderId: order._id,
      paymentId: payment._id,
      providerPaymentId: identifiers.razorpay_payment_id,
      providerSignature: identifiers.razorpay_signature
    });
    sendConfirmedPayment(res, settled.order, settled.payment);
    return;
  }

  await fetchCaptured({
    providerPaymentId: identifiers.razorpay_payment_id,
    payment
  });
  const settled = await settle({
    orderId: order._id,
    paymentId: payment._id,
    providerPaymentId: identifiers.razorpay_payment_id,
    providerSignature: identifiers.razorpay_signature
  });
  sendConfirmedPayment(res, settled.order, settled.payment);
});

export const verifyCodAdvancePayment = createCodAdvanceVerificationHandler();

export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: orders.length,
    orders
  });
});

export const getMyOrderById = asyncHandler(async (req, res) => {
  const order = await findCustomerOrder(req.user._id, req.params.id);

  res.status(200).json({
    success: true,
    order: withCodDisplayValues(order)
  });
});

export const listAdminOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find().populate("user", "name email phone").sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: orders.length,
    orders
  });
});

export const getAdminOrderById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Order not found.", 404);
  }

  const order = await Order.findById(req.params.id)
    .populate("user", "name email phone")
    .populate("codCollectedBy", "name email");

  if (!order) {
    throw new AppError("Order not found.", 404);
  }

  res.status(200).json({
    success: true,
    order
  });
});

export const updateAdminOrderStatus = asyncHandler(async (req, res) => {
  const { orderStatus } = validateOrderStatus(req.body);
  const result = await transitionOrderStatus({ orderId: req.params.id, nextStatus: orderStatus, adminId: req.user._id });
  const { order } = result;

  if (result.changed && orderStatus === "Delivered") {
    const deliveredOrderCount = await Order.countDocuments({ user: order.user, orderStatus: "Delivered" });
    await User.findByIdAndUpdate(order.user, { loyaltyRank: getLoyaltyRank(deliveredOrderCount) });
  }
  if (result.changed) {
    await createNotification({
      user: order.user,
      title: "Order status updated",
      message: result.walletRefund ? `Your Cantley order is cancelled. Rs. ${result.walletRefund.amount} restored to Wallet.` : `Your Cantley order is now ${orderStatus}.`,
      type: "ORDER",
      link: `/orders/${order._id}`
    });
  }

  res.status(200).json({
    success: true,
    order,
    changed: result.changed,
    ...(result.walletRefund ? { walletRefund: result.walletRefund } : {})
  });
});

export const collectAdminCodPayment = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Order not found.", 404);
  const { amount } = validateCodCollection(req.body);
  const order = await collectRemainingCod({
    orderId: req.params.id,
    adminId: req.user._id,
    amount
  });
  await order.populate("codCollectedBy", "name email");
  res.status(200).json({
    success: true,
    message: "COD collection recorded.",
    order
  });
});
