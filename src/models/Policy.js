import mongoose from "mongoose";

export const policyTypes = [
  "PRIVACY_POLICY",
  "TERMS_CONDITIONS",
  "SHIPPING_POLICY",
  "RETURN_REFUND_POLICY",
  "CANCELLATION_POLICY",
  "COD_POLICY",
  "CUSTOM_PRINTING_POLICY",
  "DESIGN_UPLOAD_GUIDELINES",
  "ABOUT_US",
  "FAQ"
];

const policySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: policyTypes,
      required: true,
      unique: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180
    },
    content: {
      type: String,
      required: true,
      trim: true
    },
    isPublished: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true
  }
);

policySchema.index({ type: 1, isPublished: 1 });

export default mongoose.model("Policy", policySchema);
