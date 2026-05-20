import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["ORDER", "PAYMENT", "SHIPPING", "REVIEW", "REWARD", "OFFER", "SYSTEM"],
      default: "SYSTEM"
    },
    isRead: { type: Boolean, default: false },
    link: { type: String, trim: true, default: "" }
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
