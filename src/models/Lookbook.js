import mongoose from "mongoose";

const lookbookImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
    originalName: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const lookbookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    images: { type: [lookbookImageSchema], default: [] },
    relatedProducts: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] },
    customerName: { type: String, trim: true, default: "" },
    isPublished: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

lookbookSchema.index({ isPublished: 1, createdAt: -1 });
lookbookSchema.index({ title: "text", description: "text", customerName: "text" });

export default mongoose.model("Lookbook", lookbookSchema);
