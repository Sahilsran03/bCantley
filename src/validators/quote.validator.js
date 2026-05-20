import { AppError } from "../utils/appError.js";

const text = (value) => String(value || "").trim();

export const quoteStatuses = ["New", "Contacted", "Quoted", "Approved", "Rejected"];

export const validateQuoteRequest = (body) => {
  const payload = {
    fullName: text(body.fullName || body.name),
    email: text(body.email).toLowerCase(),
    phone: text(body.phone),
    businessName: text(body.businessName),
    productType: text(body.productType),
    quantity: Number(body.quantity),
    preferredMaterial: text(body.preferredMaterial || body.material),
    printType: text(body.printType),
    sizesBreakdown: text(body.sizesBreakdown),
    message: text(body.message)
  };

  const missing = ["fullName", "email", "phone", "productType"].find((field) => !payload[field]);
  if (missing) throw new AppError("Please complete all required quote fields.", 400);
  if (!Number.isFinite(payload.quantity) || payload.quantity < 1) {
    throw new AppError("Quantity must be at least 1.", 400);
  }

  return payload;
};

export const validateQuoteStatus = (body) => {
  const status = text(body.status);
  const adminNote = text(body.adminNote);

  if (!quoteStatuses.includes(status)) {
    throw new AppError("Invalid quote status.", 400);
  }

  return { status, adminNote };
};

export const validateQuoteAmount = (body) => {
  const quotedAmount = Number(body.quotedAmount);
  const adminNote = text(body.adminNote);
  const status = body.status ? text(body.status) : "Quoted";

  if (!Number.isFinite(quotedAmount) || quotedAmount < 0) {
    throw new AppError("Quoted amount must be 0 or more.", 400);
  }
  if (!quoteStatuses.includes(status)) {
    throw new AppError("Invalid quote status.", 400);
  }

  return { quotedAmount, adminNote, status };
};
