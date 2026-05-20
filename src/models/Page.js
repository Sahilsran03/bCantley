import mongoose from "mongoose";

const pageSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160
    },
    content: {
      type: String,
      required: true,
      trim: true
    },
    metaTitle: {
      type: String,
      trim: true,
      default: "",
      maxlength: 180
    },
    metaDescription: {
      type: String,
      trim: true,
      default: "",
      maxlength: 320
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

pageSchema.index({ slug: 1, isPublished: 1 });
pageSchema.index({ title: "text", content: "text", metaDescription: "text" });

export default mongoose.model("Page", pageSchema);
