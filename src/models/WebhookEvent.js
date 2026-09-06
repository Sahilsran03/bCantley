import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["razorpay"], required: true },
    eventId: { type: String, required: true, trim: true, index: true },
    event: { type: String, required: true, trim: true },
    payloadHash: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["Processing", "Processed", "Failed"],
      default: "Processing"
    },
    processedAt: { type: Date, default: null },
    failureReason: { type: String, trim: true, default: "" }
  },
  { timestamps: true }
);

// Future webhook handlers must verify the Razorpay webhook signature before creating these records.
// Webhook payloads are retained only as hashes and must never be exposed to customers.
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export default mongoose.model("WebhookEvent", webhookEventSchema);
