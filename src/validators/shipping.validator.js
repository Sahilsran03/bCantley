import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();
const numberValue = (value, fallback = 0) => {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) throw new AppError("Shipping numbers must be zero or greater.", 400);
  return number;
};

export const validateShippingZoneInput = (body, partial = false) => {
  const payload = {};

  ["country", "state", "city", "postalCode"].forEach((field) => {
    if (body[field] !== undefined || !partial) payload[field] = text(body[field]);
  });

  if (!partial && !payload.country) payload.country = "India";
  if (!partial && !payload.postalCode) throw new AppError("Postal code is required.", 400);

  if (body.shippingFee !== undefined || !partial) payload.shippingFee = numberValue(body.shippingFee);
  if (body.estimatedDays !== undefined || !partial) {
    payload.estimatedDays = numberValue(body.estimatedDays, 5);
    if (payload.estimatedDays < 1) throw new AppError("Estimated days must be at least 1.", 400);
  }
  if (body.isCODAvailable !== undefined) payload.isCODAvailable = body.isCODAvailable === true || body.isCODAvailable === "true";

  return payload;
};

export const validateOrderShippingInput = (body) => ({
  trackingNumber: text(body.trackingNumber),
  courierName: text(body.courierName),
  estimatedDeliveryDate: body.estimatedDeliveryDate ? new Date(body.estimatedDeliveryDate) : null,
  shippedAt: body.shippedAt ? new Date(body.shippedAt) : null,
  deliveredAt: body.deliveredAt ? new Date(body.deliveredAt) : null,
  shippingNotes: text(body.shippingNotes)
});

export const validateTrackingUpdateInput = (body) => {
  const status = text(body.status);
  if (!status) throw new AppError("Tracking status is required.", 400);
  return {
    status,
    message: text(body.message),
    timestamp: body.timestamp ? new Date(body.timestamp) : new Date()
  };
};
