import mongoose from "mongoose";

const proofImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
    originalName: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const returnRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true
    },
    orderItem: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    type: {
      type: String,
      enum: ["CANCEL", "RETURN", "REFUND"],
      required: true
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1200
    },
    proofImages: {
      type: [proofImageSchema],
      default: [],
      validate: {
        validator: (images) => images.length <= 5,
        message: "A request can include a maximum of 5 proof images."
      }
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Completed"],
      default: "Pending",
      index: true
    },
    adminNote: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1200
    },
    refundAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    refundStatus: {
      type: String,
      enum: ["NotRequired", "Pending", "Processed", "Failed"],
      default: "NotRequired"
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: true }
  }
);

returnRequestSchema.index({ user: 1, createdAt: -1 });
returnRequestSchema.index({ order: 1, type: 1, status: 1 });
returnRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("ReturnRequest", returnRequestSchema);
