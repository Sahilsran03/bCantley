import Order from "../models/Order.js";
import ShippingZone from "../models/ShippingZone.js";
import { checkShippingByPostalCode } from "../services/shipping.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { emailTemplates, sendTemplateEmail } from "../services/email.service.js";
import { createNotification } from "../services/notification.service.js";
import {
  validateOrderShippingInput,
  validateShippingZoneInput,
  validateTrackingUpdateInput
} from "../validators/shipping.validator.js";

export const checkShipping = asyncHandler(async (req, res) => {
  const result = await checkShippingByPostalCode(req.params.postalCode, req.query.country || "India");

  res.status(200).json({
    success: true,
    shipping: result
  });
});

export const getOrderTracking = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id }).select(
    "orderNumber orderStatus paymentStatus trackingNumber courierName estimatedDeliveryDate shippedAt deliveredAt shippingNotes trackingHistory shippingAddress"
  );

  if (!order) throw new AppError("Order not found.", 404);

  res.status(200).json({ success: true, tracking: order });
});

export const updateOrderShipping = asyncHandler(async (req, res) => {
  const payload = validateOrderShippingInput(req.body);
  const order = await Order.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });

  if (!order) throw new AppError("Order not found.", 404);
  await createNotification({
    user: order.user,
    title: "Shipping details updated",
    message: `Courier details for order ${order.orderNumber} were updated.`,
    type: "SHIPPING",
    link: `/orders/${order._id}/tracking`
  });

  res.status(200).json({ success: true, order });
});

export const addTrackingUpdate = asyncHandler(async (req, res) => {
  const update = validateTrackingUpdateInput(req.body);
  const order = await Order.findById(req.params.id);

  if (!order) throw new AppError("Order not found.", 404);

  order.trackingHistory.push(update);
  if (update.status === "Shipped" && !order.shippedAt) order.shippedAt = update.timestamp;
  if (update.status === "Delivered") order.deliveredAt = update.timestamp;
  await order.save();
  await createNotification({
    user: order.user,
    title: "Tracking update",
    message: update.message || `Your Cantley order tracking status is ${update.status}.`,
    type: "SHIPPING",
    link: `/orders/${order._id}/tracking`
  });
  await sendTemplateEmail({
    to: order.shippingAddress.email,
    template: emailTemplates.shippingUpdate({ orderNumber: order.orderNumber, status: update.status })
  });

  res.status(200).json({ success: true, order });
});

export const listShippingZones = asyncHandler(async (req, res) => {
  const zones = await ShippingZone.find().sort({ country: 1, state: 1, city: 1, postalCode: 1 });
  res.status(200).json({ success: true, count: zones.length, zones });
});

export const createShippingZone = asyncHandler(async (req, res) => {
  const zone = await ShippingZone.create(validateShippingZoneInput(req.body));
  res.status(201).json({ success: true, zone });
});

export const updateShippingZone = asyncHandler(async (req, res) => {
  const zone = await ShippingZone.findByIdAndUpdate(req.params.id, validateShippingZoneInput(req.body, true), {
    new: true,
    runValidators: true
  });
  if (!zone) throw new AppError("Shipping zone not found.", 404);
  res.status(200).json({ success: true, zone });
});

export const deleteShippingZone = asyncHandler(async (req, res) => {
  const zone = await ShippingZone.findByIdAndDelete(req.params.id);
  if (!zone) throw new AppError("Shipping zone not found.", 404);
  res.status(200).json({ success: true, message: "Shipping zone deleted." });
});
