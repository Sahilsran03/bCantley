import { AppError } from "../utils/appError.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9+\-\s()]{7,20}$/;
const orderStatuses = [
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
const paymentStatuses = ["Pending", "AdvancePaid", "Paid", "Failed"];

const text = (value) => String(value || "").trim();

export const validateCheckoutInput = (body) => {
  const shippingAddress = body.shippingAddress || {};
  const payload = {
    shippingAddress: {
      fullName: text(shippingAddress.fullName),
      phone: text(shippingAddress.phone),
      email: text(shippingAddress.email).toLowerCase(),
      addressLine1: text(shippingAddress.addressLine1),
      addressLine2: text(shippingAddress.addressLine2),
      city: text(shippingAddress.city),
      state: text(shippingAddress.state),
      country: text(shippingAddress.country) || "India",
      postalCode: text(shippingAddress.postalCode)
    },
    paymentMethod: "COD",
    couponCode: text(body.couponCode).toUpperCase(),
    notes: text(body.notes)
  };

  const requiredFields = ["fullName", "phone", "email", "addressLine1", "city", "state", "country", "postalCode"];
  const missingField = requiredFields.find((field) => !payload.shippingAddress[field]);

  if (missingField) {
    throw new AppError("Please complete all required shipping fields.", 400);
  }

  if (!emailPattern.test(payload.shippingAddress.email)) {
    throw new AppError("Please provide a valid email address.", 400);
  }

  if (!phonePattern.test(payload.shippingAddress.phone)) {
    throw new AppError("Please provide a valid phone number.", 400);
  }

  return payload;
};

export const validateOrderStatus = (body) => {
  const orderStatus = text(body.orderStatus);

  if (!orderStatuses.includes(orderStatus)) {
    throw new AppError("Invalid order status.", 400);
  }

  return { orderStatus };
};

export const validatePaymentStatus = (body) => {
  const paymentStatus = text(body.paymentStatus);

  if (!paymentStatuses.includes(paymentStatus)) {
    throw new AppError("Invalid payment status.", 400);
  }

  return { paymentStatus };
};
