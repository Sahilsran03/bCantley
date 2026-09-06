import crypto from "node:crypto";
import Payment from "../models/Payment.js";
import WebhookEvent from "../models/WebhookEvent.js";
import { fetchAndValidateCapturedRazorpayPayment, verifyRazorpayWebhookSignature } from "../services/razorpay.service.js";
import { settleCapturedPayment } from "../services/payment-settlement.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const getHeader = (req, name) => String(req.get(name) || "").trim();
// Two minutes comfortably exceeds Razorpay's normal delivery timeout while ensuring a crashed worker is recoverable.
export const RAZORPAY_WEBHOOK_PROCESSING_LEASE_MS = 2 * 60 * 1000;

export const parseRazorpayWebhook = (rawBody) => {
  if (!Buffer.isBuffer(rawBody)) throw new AppError("Webhook body must be raw bytes.", 400);
  try {
    const payload = JSON.parse(rawBody.toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid payload");
    return payload;
  } catch {
    throw new AppError("Malformed webhook JSON.", 400);
  }
};

export const validateRazorpayWebhookEventId = (eventId) => {
  const normalized = String(eventId || "").trim();
  if (!normalized || normalized.length > 256) throw new AppError("Razorpay webhook event ID is required.", 400);
  return normalized;
};

export const reclaimExistingWebhookEvent = async ({ webhookEvent, payloadHash, now = new Date(), model = WebhookEvent }) => {
  if (webhookEvent.payloadHash !== payloadHash) throw new AppError("Webhook event ID payload mismatch.", 409);
  if (webhookEvent.status === "Processed") return { processed: true, webhookEvent };

  const staleBefore = new Date(now.getTime() - RAZORPAY_WEBHOOK_PROCESSING_LEASE_MS);
  const claimed = await model.findOneAndUpdate(
    {
      _id: webhookEvent._id,
      $or: [
        { status: "Failed" },
        { status: "Processing", updatedAt: { $lte: staleBefore } }
      ]
    },
    { status: "Processing", failureReason: "", processedAt: null, updatedAt: now },
    { new: true }
  );
  if (!claimed) throw new AppError("Webhook event processing is already in progress. Please retry.", 409);
  return { processed: false, webhookEvent: claimed };
};

const markFailed = async (webhookEvent, error) => {
  webhookEvent.status = "Failed";
  webhookEvent.failureReason = String(error.message || "Webhook processing failed.").slice(0, 500);
  await webhookEvent.save();
};

export const createRazorpayWebhookHandler = ({
  PaymentModel = Payment, WebhookEventModel = WebhookEvent,
  fetchCaptured = fetchAndValidateCapturedRazorpayPayment,
  settle = settleCapturedPayment
} = {}) => asyncHandler(async (req, res) => {
  const signature = getHeader(req, "X-Razorpay-Signature");
  if (!signature) throw new AppError("Razorpay webhook signature is required.", 400);
  if (!verifyRazorpayWebhookSignature({ rawBody: req.body, signature })) {
    throw new AppError("Invalid Razorpay webhook signature.", 401);
  }

  const payload = parseRazorpayWebhook(req.body);
  const eventId = validateRazorpayWebhookEventId(getHeader(req, "X-Razorpay-Event-Id"));
  const event = String(payload.event || "").trim();
  if (!event || event.length > 256) throw new AppError("Razorpay webhook event type is required.", 400);
  const payloadHash = crypto.createHash("sha256").update(req.body).digest("hex");

  let webhookEvent;
  try {
    webhookEvent = await WebhookEventModel.create({ provider: "razorpay", eventId, event, payloadHash });
  } catch (error) {
    if (error.code !== 11000) throw error;
    webhookEvent = await WebhookEventModel.findOne({ provider: "razorpay", eventId });
    if (!webhookEvent) throw error;
    const reclaimed = await reclaimExistingWebhookEvent({ webhookEvent, payloadHash, model: WebhookEventModel });
    if (reclaimed.processed) {
      res.status(200).json({ success: true, duplicate: true });
      return;
    }
    webhookEvent = reclaimed.webhookEvent;
  }

  try {
    if (event === "payment.captured") {
      const providerPaymentId = String(payload.payload?.payment?.entity?.id || "").trim();
      if (!providerPaymentId) throw new AppError("Captured payment ID is missing from the webhook.", 400);
      const payment = await PaymentModel.findOne({ provider: "razorpay", providerOrderId: payload.payload?.payment?.entity?.order_id });
      if (!payment) throw new AppError("Payment attempt not found.", 404);

      await fetchCaptured({ providerPaymentId, payment });
      await settle({ payment, providerPaymentId });
    }

    webhookEvent.status = "Processed";
    webhookEvent.processedAt = new Date();
    webhookEvent.failureReason = "";
    await webhookEvent.save();
    res.status(200).json({ success: true });
  } catch (error) {
    await markFailed(webhookEvent, error);
    throw error;
  }
});

export const handleRazorpayWebhook = createRazorpayWebhookHandler();
