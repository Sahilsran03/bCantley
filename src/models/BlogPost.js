import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
    originalName: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const blogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    excerpt: { type: String, required: true, trim: true, maxlength: 420 },
    content: { type: String, required: true, trim: true },
    coverImage: { type: mediaSchema, default: null },
    author: { type: String, trim: true, default: "Cantley" },
    tags: { type: [String], default: [] },
    category: { type: String, required: true, trim: true, index: true },
    metaTitle: { type: String, trim: true, default: "", maxlength: 180 },
    metaDescription: { type: String, trim: true, default: "", maxlength: 320 },
    isPublished: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date, default: null },
    views: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

blogPostSchema.index({ isPublished: 1, publishedAt: -1, createdAt: -1 });
blogPostSchema.index({ title: "text", excerpt: "text", content: "text", tags: "text", category: "text" });

export default mongoose.model("BlogPost", blogPostSchema);
