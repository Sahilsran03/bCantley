import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();
const dateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError("Please provide valid announcement dates.", 400);
  return date;
};

export const validateAnnouncementInput = (body, partial = false) => {
  const payload = {};

  if (!partial || body.title !== undefined) {
    payload.title = text(body.title);
    if (!payload.title) throw new AppError("Announcement title is required.", 400);
  }

  if (!partial || body.message !== undefined) {
    payload.message = text(body.message);
    if (!payload.message) throw new AppError("Announcement message is required.", 400);
  }

  ["image", "buttonText", "buttonLink"].forEach((field) => {
    if (body[field] !== undefined) payload[field] = text(body[field]);
  });

  if (body.isActive !== undefined) payload.isActive = body.isActive === true || body.isActive === "true";
  if (body.startDate !== undefined || !partial) payload.startDate = dateOrNull(body.startDate);
  if (body.expiryDate !== undefined || !partial) payload.expiryDate = dateOrNull(body.expiryDate);

  if (!partial || body.targetAudience !== undefined) {
    payload.targetAudience = text(body.targetAudience).toUpperCase() || "ALL";
    if (!["ALL", "CUSTOMERS", "ADMINS"].includes(payload.targetAudience)) {
      throw new AppError("Target audience is invalid.", 400);
    }
  }

  return payload;
};
