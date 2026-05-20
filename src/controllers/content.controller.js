import BlogPost from "../models/BlogPost.js";
import Lookbook from "../models/Lookbook.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validateBlogInput, validateLookbookInput, validatePublishInput } from "../validators/content.validator.js";

const fileToImage = (file) => ({
  url: file.path,
  publicId: file.filename,
  originalName: file.originalname || ""
});

const paging = (query) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(24, Math.max(1, Number(query.limit) || 9));
  return { page, limit, skip: (page - 1) * limit };
};

const blogFilter = (query, publishedOnly = true) => {
  const filter = publishedOnly ? { isPublished: true } : {};
  const category = String(query.category || "").trim();
  const search = String(query.search || query.q || "").trim();
  const tag = String(query.tag || "").trim();
  if (category) filter.category = category;
  if (tag) filter.tags = tag;
  if (search) filter.$text = { $search: search };
  return filter;
};

const lookbookFilter = (query, publishedOnly = true) => {
  const filter = publishedOnly ? { isPublished: true } : {};
  const search = String(query.search || query.q || "").trim();
  if (search) filter.$text = { $search: search };
  return filter;
};

export const listPublishedBlogPosts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const filter = blogFilter(req.query);
  const [posts, total] = await Promise.all([
    BlogPost.find(filter).sort({ publishedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    BlogPost.countDocuments(filter)
  ]);
  res.status(200).json({ success: true, count: posts.length, total, page, pages: Math.ceil(total / limit), posts });
});

export const getPublishedBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findOneAndUpdate(
    { slug: req.params.slug, isPublished: true },
    { $inc: { views: 1 } },
    { new: true }
  ).lean();
  if (!post) throw new AppError("Blog post not found.", 404);
  res.status(200).json({ success: true, post });
});

export const listAdminBlogPosts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const filter = blogFilter(req.query, false);
  const [posts, total] = await Promise.all([
    BlogPost.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    BlogPost.countDocuments(filter)
  ]);
  res.status(200).json({ success: true, count: posts.length, total, page, pages: Math.ceil(total / limit), posts });
});

export const getAdminBlogPostById = asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw new AppError("Blog post not found.", 404);
  res.status(200).json({ success: true, post });
});

export const createBlogPost = asyncHandler(async (req, res) => {
  const payload = validateBlogInput(req.body);
  if (req.file) payload.coverImage = fileToImage(req.file);
  if (payload.isPublished && !payload.publishedAt) payload.publishedAt = new Date();
  const post = await BlogPost.create(payload);
  res.status(201).json({ success: true, post });
});

export const updateBlogPost = asyncHandler(async (req, res) => {
  const payload = validateBlogInput(req.body, true);
  const existing = await BlogPost.findById(req.params.id);
  if (!existing) throw new AppError("Blog post not found.", 404);
  if (req.file) payload.coverImage = fileToImage(req.file);
  if (payload.isPublished && !existing.publishedAt) payload.publishedAt = new Date();
  if (payload.isPublished === false) payload.publishedAt = null;
  const post = await BlogPost.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
  res.status(200).json({ success: true, post });
});

export const deleteBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findByIdAndDelete(req.params.id);
  if (!post) throw new AppError("Blog post not found.", 404);
  res.status(200).json({ success: true, message: "Blog post deleted." });
});

export const publishBlogPost = asyncHandler(async (req, res) => {
  const payload = validatePublishInput(req.body);
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw new AppError("Blog post not found.", 404);
  post.isPublished = payload.isPublished;
  post.publishedAt = payload.isPublished ? post.publishedAt || new Date() : null;
  await post.save();
  res.status(200).json({ success: true, post });
});

export const listPublishedLookbooks = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const filter = lookbookFilter(req.query);
  const [lookbooks, total] = await Promise.all([
    Lookbook.find(filter).populate("relatedProducts", "name slug images basePrice").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Lookbook.countDocuments(filter)
  ]);
  res.status(200).json({ success: true, count: lookbooks.length, total, page, pages: Math.ceil(total / limit), lookbooks });
});

export const getPublishedLookbook = asyncHandler(async (req, res) => {
  const lookbook = await Lookbook.findOne({ slug: req.params.slug, isPublished: true })
    .populate("relatedProducts", "name slug images basePrice ratingAverage ratingCount")
    .lean();
  if (!lookbook) throw new AppError("Lookbook entry not found.", 404);
  res.status(200).json({ success: true, lookbook });
});

export const listAdminLookbooks = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const filter = lookbookFilter(req.query, false);
  const [lookbooks, total] = await Promise.all([
    Lookbook.find(filter).populate("relatedProducts", "name slug images basePrice").sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Lookbook.countDocuments(filter)
  ]);
  res.status(200).json({ success: true, count: lookbooks.length, total, page, pages: Math.ceil(total / limit), lookbooks });
});

export const getAdminLookbookById = asyncHandler(async (req, res) => {
  const lookbook = await Lookbook.findById(req.params.id).populate("relatedProducts", "name slug images basePrice");
  if (!lookbook) throw new AppError("Lookbook entry not found.", 404);
  res.status(200).json({ success: true, lookbook });
});

export const createLookbook = asyncHandler(async (req, res) => {
  const payload = validateLookbookInput(req.body);
  payload.images = (req.files || []).map(fileToImage);
  const lookbook = await Lookbook.create(payload);
  res.status(201).json({ success: true, lookbook });
});

export const updateLookbook = asyncHandler(async (req, res) => {
  const payload = validateLookbookInput(req.body, true);
  const existing = await Lookbook.findById(req.params.id);
  if (!existing) throw new AppError("Lookbook entry not found.", 404);
  if (req.files?.length) payload.images = [...existing.images, ...req.files.map(fileToImage)].slice(0, 8);
  const lookbook = await Lookbook.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true }).populate(
    "relatedProducts",
    "name slug images basePrice"
  );
  res.status(200).json({ success: true, lookbook });
});

export const deleteLookbook = asyncHandler(async (req, res) => {
  const lookbook = await Lookbook.findByIdAndDelete(req.params.id);
  if (!lookbook) throw new AppError("Lookbook entry not found.", 404);
  res.status(200).json({ success: true, message: "Lookbook entry deleted." });
});

export const publishLookbook = asyncHandler(async (req, res) => {
  const payload = validatePublishInput(req.body);
  const lookbook = await Lookbook.findById(req.params.id);
  if (!lookbook) throw new AppError("Lookbook entry not found.", 404);
  lookbook.isPublished = payload.isPublished;
  await lookbook.save();
  res.status(200).json({ success: true, lookbook });
});
