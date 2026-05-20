import mongoose from "mongoose";

const shippingZoneSchema = new mongoose.Schema(
  {
    country: { type: String, required: true, trim: true, default: "India" },
    state: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    postalCode: { type: String, required: true, trim: true, index: true },
    shippingFee: { type: Number, required: true, min: 0, default: 0 },
    estimatedDays: { type: Number, required: true, min: 1, default: 5 },
    isCODAvailable: { type: Boolean, default: true }
  },
  {
    timestamps: true
  }
);

shippingZoneSchema.index({ country: 1, postalCode: 1 }, { unique: true });

export default mongoose.model("ShippingZone", shippingZoneSchema);
