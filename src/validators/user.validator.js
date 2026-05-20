import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();

export const validateUserProfile = (body) => {
  const payload = {};

  if (Object.hasOwn(body, "name")) {
    payload.name = text(body.name);
    if (payload.name.length < 2) throw new AppError("Name must be at least 2 characters.", 400);
  }
  if (Object.hasOwn(body, "phone")) {
    payload.phone = text(body.phone);
    if (!payload.phone) throw new AppError("Phone is required.", 400);
  }
  if (Object.hasOwn(body, "avatar")) payload.avatar = body.avatar || "";
  if (Object.hasOwn(body, "gender")) payload.gender = text(body.gender);
  if (Object.hasOwn(body, "dateOfBirth")) payload.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;

  return payload;
};

export const validateAddress = (body) => {
  const payload = {
    fullName: text(body.fullName),
    phone: text(body.phone),
    addressLine1: text(body.addressLine1),
    addressLine2: text(body.addressLine2),
    city: text(body.city),
    state: text(body.state),
    country: text(body.country) || "India",
    postalCode: text(body.postalCode),
    isDefault: body.isDefault === true || body.isDefault === "true"
  };
  const missing = ["fullName", "phone", "addressLine1", "city", "state", "country", "postalCode"].find((field) => !payload[field]);
  if (missing) throw new AppError("Please complete all required address fields.", 400);
  return payload;
};
