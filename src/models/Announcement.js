import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true },
    image: { type: mongoose.Schema.Types.Mixed, default: "" },
    buttonText: { type: String, trim: true, default: "" },
    buttonLink: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    targetAudience: {
      type: String,
      enum: ["ALL", "CUSTOMERS", "ADMINS"],
      default: "ALL"
    }
  },
  { timestamps: true }
);

announcementSchema.index({ isActive: 1, targetAudience: 1, startDate: 1, expiryDate: 1 });

export default mongoose.model("Announcement", announcementSchema);
