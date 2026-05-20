import QuoteRequest from "../models/QuoteRequest.js";
import User from "../models/User.js";
import { verifyAccessToken } from "../services/token.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  validateQuoteAmount,
  validateQuoteRequest,
  validateQuoteStatus
} from "../validators/quote.validator.js";

const fileToQuoteAsset = (file) => ({
  url: file.path,
  publicId: file.filename,
  resourceType: file.resource_type || (file.mimetype === "application/pdf" ? "raw" : file.mimetype?.startsWith("video/") ? "video" : "image"),
  originalName: file.originalname || ""
});

const attachOptionalUser = async (req) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;
  if (!token) return null;

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.userId);
    return user?.isVerified ? user : null;
  } catch {
    return null;
  }
};

const findQuote = async (id) => {
  const quote = await QuoteRequest.findById(id).populate("user", "name email phone");
  if (!quote) throw new AppError("Quote request not found.", 404);
  return quote;
};

export const createQuoteRequest = asyncHandler(async (req, res) => {
  const payload = validateQuoteRequest(req.body);
  const user = await attachOptionalUser(req);
  const designFiles = (req.files || []).map(fileToQuoteAsset);

  const quote = await QuoteRequest.create({
    ...payload,
    user: user?._id || null,
    designFiles
  });

  res.status(201).json({
    success: true,
    message: "Quote request submitted.",
    quote
  });
});

export const listMyQuotes = asyncHandler(async (req, res) => {
  const quotes = await QuoteRequest.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: quotes.length, quotes });
});

export const listAdminQuotes = asyncHandler(async (req, res) => {
  const status = String(req.query.status || "").trim();
  const filter = status ? { status } : {};
  const quotes = await QuoteRequest.find(filter).populate("user", "name email phone").sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: quotes.length, quotes });
});

export const getAdminQuoteById = asyncHandler(async (req, res) => {
  const quote = await findQuote(req.params.id);
  res.status(200).json({ success: true, quote });
});

export const updateQuoteStatus = asyncHandler(async (req, res) => {
  const payload = validateQuoteStatus(req.body);
  const quote = await findQuote(req.params.id);
  quote.status = payload.status;
  quote.adminNote = payload.adminNote;
  await quote.save();
  res.status(200).json({ success: true, quote });
});

export const updateQuoteAmount = asyncHandler(async (req, res) => {
  const payload = validateQuoteAmount(req.body);
  const quote = await findQuote(req.params.id);
  quote.quotedAmount = payload.quotedAmount;
  quote.adminNote = payload.adminNote;
  quote.status = payload.status;
  await quote.save();
  res.status(200).json({ success: true, quote });
});
