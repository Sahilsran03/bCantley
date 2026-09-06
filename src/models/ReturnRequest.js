import mongoose from "mongoose";

const proofImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
    originalName: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const selectedItemSnapshotSchema = new mongoose.Schema(
  {
    orderItemIndex: { type: Number, min: 0 },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: { type: String, trim: true, default: "" },
    productType: { type: String, trim: true, default: "" },
    variantSku: { type: String, trim: true, default: "" },
    size: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "" },
    material: { type: String, trim: true, default: "" },
    printType: { type: String, trim: true, default: "" },
    finish: { type: String, trim: true, default: "" },
    shape: { type: String, trim: true, default: "" },
    width: { type: Number, default: null, min: 0 },
    height: { type: Number, default: null, min: 0 },
    unit: { type: String, trim: true, default: "" },
    waterproof: { type: Boolean, default: false },
    finalPrice: { type: Number, min: 0 },
    originalQuantity: { type: Number, min: 1 },
    refundableLineAmountPaise: { type: Number, min: 0, default: undefined },
    refundableUnitBasePaise: { type: Number, min: 0, default: undefined },
    refundableUnitRemainderPaise: { type: Number, min: 0, default: undefined },
    quantityEntitlementStart: { type: Number, min: 0, default: 0 }
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
    reasonCategory: {
      type: String,
      enum: ["DAMAGED", "WRONG_ITEM", "DEFECTIVE", "SIZE_ISSUE", "OTHER"],
      default: undefined
    },
    selectedItemSnapshot: { type: selectedItemSnapshotSchema, default: undefined },
    requestedQuantity: { type: Number, min: 1, default: undefined },
    approvedQuantity: { type: Number, min: 0, default: undefined },
    receivedQuantity: { type: Number, min: 0, default: undefined },
    approvedRefundAmount: { type: Number, min: 0, default: undefined },
    approvedRefundAmountPaise: { type: Number, min: 0, default: undefined },
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
      enum: ["Pending", "Approved", "Received", "Rejected", "Completed"],
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
    },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    inspectionStatus: {
      type: String,
      enum: ["PENDING", "SELLABLE", "DAMAGED", "OTHER"],
      default: undefined
    },
    inspectionNote: { type: String, trim: true, maxlength: 1200, default: "" },
    restockDecision: {
      type: String,
      enum: ["PENDING", "RESTOCK", "DO_NOT_RESTOCK"],
      default: undefined
    },
    restockedQuantity: { type: Number, min: 0, default: 0 },
    restockedAt: { type: Date, default: null },
    restockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    completedAt: { type: Date, default: null }
  },
  {
    timestamps: { createdAt: true, updatedAt: true }
  }
);

returnRequestSchema.index({ user: 1, createdAt: -1 });
returnRequestSchema.index({ order: 1, type: 1, status: 1 });
returnRequestSchema.index({ status: 1, createdAt: -1 });
returnRequestSchema.index({ order: 1, "selectedItemSnapshot.orderItemIndex": 1, status: 1 });

export default mongoose.model("ReturnRequest", returnRequestSchema);
