import mongoose from "mongoose";
import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getLoyaltyRank } from "../utils/loyalty.js";
import { calculateCartPricing, incrementCouponUsage } from "../services/pricing.service.js";
import { checkShippingByPostalCode } from "../services/shipping.service.js";
import { createNotification } from "../services/notification.service.js";
import { emailTemplates, sendTemplateEmail } from "../services/email.service.js";
import { validateCheckoutInput, validateOrderStatus, validatePaymentStatus } from "../validators/order.validator.js";

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

const createOrderNumber = async () => {
  for (let index = 0; index < 5; index += 1) {
    const orderNumber = generateOrderNumber();
    const exists = await Order.exists({ orderNumber });

    if (!exists) {
      return orderNumber;
    }
  }

  throw new AppError("Unable to generate order number.", 500);
};

const calculateAdvance = (totalAmount) => {
  return Math.min(totalAmount, Math.max(100, Math.ceil(totalAmount * 0.2)));
};

const buildOrderItemsAndStockUpdates = async (cart) => {
  const orderItems = [];
  const stockUpdates = [];

  for (const cartItem of cart.items) {
    const product = await Product.findById(cartItem.product?._id || cartItem.product);

    if (!product || !product.isActive) {
      throw new AppError("One or more Cart products are no longer available.", 400);
    }

    const variant = product.variants.length ? findVariant(product, cartItem) : null;

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
      quantity: cartItem.quantity,
      unitPrice: Number(product.basePrice || 0),
      priceModifier,
      finalPrice,
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

const reduceStock = async (stockUpdates) => {
  for (const update of stockUpdates) {
    const product = await Product.findById(update.productId);
    const variant = update.sku
      ? product.variants.find((item) => item.sku && item.sku === update.sku)
      : product.variants.find((item) => matchesSelectedOptions(item, update.selectedOptions));

    if (!variant || variant.stock < update.quantity) {
      throw new AppError("Stock changed while creating order. Please review your Cart.", 409);
    }

    variant.stock -= update.quantity;
    await product.save();
  }
};

const incrementProductSales = async (orderItems) => {
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

export const checkout = asyncHandler(async (req, res) => {
  const payload = validateCheckoutInput(req.body);
  const cart = await Cart.findOne({ user: req.user._id }).populate("items.product", "name slug images basePrice isActive category");

  if (!cart || !cart.items.length) {
    throw new AppError("Your Cart is empty.", 400);
  }

  const couponCode = payload.couponCode || cart.appliedCouponCode || "";
  const pricing = await calculateCartPricing(cart, couponCode);
  const shipping = await checkShippingByPostalCode(payload.shippingAddress.postalCode, payload.shippingAddress.country);

  if (shipping.isInternational) {
    throw new AppError("Contact WhatsApp for international shipping.", 400);
  }

  if (!shipping.isCODAvailable) {
    throw new AppError("COD is not available for this postal code.", 400);
  }

  const { orderItems, stockUpdates } = await buildOrderItemsAndStockUpdates(cart);
  const subtotal = pricing.subtotal;
  const shippingFee = Number(shipping.shippingFee || 0);
  const discount = pricing.discountAmount;
  const totalAmount = Math.max(0, pricing.totalAmount + shippingFee);
  const advanceAmount = calculateAdvance(totalAmount);
  const remainingAmount = totalAmount - advanceAmount;

  await reduceStock(stockUpdates);
  await incrementProductSales(orderItems);

  const order = await Order.create({
    user: req.user._id,
    orderNumber: await createOrderNumber(),
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
    paymentMethod: payload.paymentMethod,
    paymentStatus: "Pending",
    orderStatus: "Pending",
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

  cart.items = [];
  cart.appliedCouponCode = "";
  await cart.save();
  await incrementCouponUsage(pricing.appliedCoupon?.code);
  await createNotification({
    user: req.user._id,
    title: "Order placed",
    message: `Your Cantley order ${order.orderNumber} has been placed.`,
    type: "ORDER",
    link: `/orders/${order._id}`
  });
  await sendTemplateEmail({
    to: payload.shippingAddress.email,
    template: emailTemplates.orderConfirmation({ orderNumber: order.orderNumber })
  });

  res.status(201).json({
    success: true,
    order
  });
});

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
    order
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

  const order = await Order.findById(req.params.id).populate("user", "name email phone");

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
  const order = await Order.findByIdAndUpdate(req.params.id, { orderStatus }, { new: true, runValidators: true });

  if (!order) {
    throw new AppError("Order not found.", 404);
  }

  if (orderStatus === "Delivered") {
    const deliveredOrderCount = await Order.countDocuments({ user: order.user, orderStatus: "Delivered" });
    await User.findByIdAndUpdate(order.user, { loyaltyRank: getLoyaltyRank(deliveredOrderCount) });
  }
  await createNotification({
    user: order.user,
    title: "Order status updated",
    message: `Your Cantley order is now ${orderStatus}.`,
    type: "ORDER",
    link: `/orders/${order._id}`
  });

  res.status(200).json({
    success: true,
    order
  });
});

export const updateAdminPaymentStatus = asyncHandler(async (req, res) => {
  const { paymentStatus } = validatePaymentStatus(req.body);
  const order = await Order.findByIdAndUpdate(req.params.id, { paymentStatus }, { new: true, runValidators: true });

  if (!order) {
    throw new AppError("Order not found.", 404);
  }

  res.status(200).json({
    success: true,
    order
  });
});
