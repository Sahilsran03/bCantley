import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    name: { type: String, required: true, trim: true },
    productType: { type: String, required: true, trim: true },
    image: { type: mongoose.Schema.Types.Mixed, default: "" },
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
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    priceModifier: { type: Number, default: 0 },
    finalPrice: { type: Number, required: true, min: 0 },
    refundableLineAmountPaise: { type: Number, min: 0, default: undefined },
    refundableUnitBasePaise: { type: Number, min: 0, default: undefined },
    refundableUnitRemainderPaise: { type: Number, min: 0, default: undefined },
    codAvailable: { type: Boolean, default: true },
    codAdvanceAmount: { type: Number, default: 0, min: 0 },
    customNotes: { type: String, trim: true, default: "" },
    variantSku: { type: String, trim: true, default: "" }
    ,
    customDesign: { type: mongoose.Schema.Types.ObjectId, ref: "CustomDesign", default: null },
    designPreview: { type: mongoose.Schema.Types.Mixed, default: null },
    designData: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, trim: true, default: "" },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: "India" },
    postalCode: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const trackingHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true, trim: true },
    message: { type: String, trim: true, default: "" },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const returnHistorySchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "ReturnRequest", default: null },
    type: { type: String, trim: true, default: "" },
    status: { type: String, trim: true, default: "" },
    message: { type: String, trim: true, default: "" },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    checkoutIdempotencyKey: {
      type: String,
      trim: true,
      maxlength: 120
    },
    checkoutRequestFingerprint: { type: String, maxlength: 128 },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (items) => items.length > 0,
        message: "Order must contain at least one item."
      }
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: true
    },
    subtotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    appliedCoupon: {
      code: { type: String, uppercase: true, trim: true, default: "" },
      type: { type: String, trim: true, default: "" },
      value: { type: Number, default: 0 },
      discountAmount: { type: Number, default: 0, min: 0 }
    },
    appliedOffers: {
      type: [
        {
          offer: { type: mongoose.Schema.Types.ObjectId, ref: "Offer", default: null },
          title: { type: String, trim: true, default: "" },
          type: { type: String, trim: true, default: "" },
          discountAmount: { type: Number, default: 0, min: 0 },
          freeQuantity: { type: Number, default: 0, min: 0 }
        }
      ],
      default: []
    },
    advanceAmount: { type: Number, required: true, min: 0 },
    remainingAmount: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    onlineAdvanceRequired: { type: Number, required: true, default: 0, min: 0 },
    onlineAmountPaid: { type: Number, required: true, default: 0, min: 0 },
    remainingCodDue: { type: Number, required: true, default: 0, min: 0 },
    codAmountCollected: { type: Number, required: true, default: 0, min: 0 },
    potentialCodAmount: { type: Number, required: true, default: 0, min: 0 },
    codAdvancePayment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null, index: true },
    walletPayment: { type: mongoose.Schema.Types.ObjectId, ref: "WalletTransaction", default: null, index: true },
    onlinePayment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null, index: true },
    codCollectedAt: { type: Date, default: null },
    codCollectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    paymentMethod: {
      type: String,
      enum: ["COD", "ONLINE", "WALLET"],
      default: "COD"
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "AdvancePaid", "Paid", "Failed"],
      default: "Pending"
    },
    orderStatus: {
      type: String,
      enum: [
        "Pending",
        "Design Review",
        "Approved",
        "Printing",
        "Quality Check",
        "Packing",
        "Shipped",
        "Delivered",
        "Cancelled"
      ],
      default: "Pending"
    },
    fulfillmentStatus: {
      type: String,
      enum: [
        "NotStarted",
        "DesignReview",
        "Approved",
        "Printing",
        "QualityCheck",
        "Packed",
        "Shipped",
        "Delivered",
        "Returned"
      ],
      default: "NotStarted"
    },
    inventoryStatus: {
      type: String,
      enum: ["NotReserved", "Reserved", "Committed", "Released", "Restocked"],
      default: "NotReserved"
    },
    inventoryReservedAt: { type: Date, default: null },
    inventoryReservationExpiresAt: { type: Date, default: null },
    refundStatus: {
      type: String,
      enum: ["None", "Requested", "Approved", "Processing", "PartiallyRefunded", "Refunded", "Failed"],
      default: "None"
    },
    trackingNumber: { type: String, trim: true, default: "" },
    courierName: { type: String, trim: true, default: "" },
    estimatedDeliveryDate: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    shippingNotes: { type: String, trim: true, default: "" },
    trackingHistory: { type: [trackingHistorySchema], default: [] },
    returnHistory: { type: [returnHistorySchema], default: [] },
    notes: { type: String, trim: true, default: "" }
  },
  {
    timestamps: true
  }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ paymentMethod: 1, paymentStatus: 1, inventoryStatus: 1, inventoryReservationExpiresAt: 1 });
orderSchema.index(
  { user: 1, checkoutIdempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { checkoutIdempotencyKey: { $type: "string" } }
  }
);

export default mongoose.model("Order", orderSchema);
