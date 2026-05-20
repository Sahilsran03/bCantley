import mongoose from "mongoose";
import { AppError } from "../utils/appError.js";
import { sanitizeHtml } from "../utils/sanitizeHtml.js";
import { slugify } from "../utils/slugify.js";

const text = (value) => String(value || "").trim();
const bool = (value) => value === true || value === "true";

const listFromInput = (value) => {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(",")
    .map(text)
    .filter(Boolean);
};

export const validateBlogInput = (body, partial = false) => {
  const payload = {
    title: text(body.title),
    slug: slugify(body.slug || body.title),
    excerpt: text(body.excerpt),
    content: sanitizeHtml(text(body.content)),
    author: text(body.author) || "Cantley",
    tags: listFromInput(body.tags),
    category: text(body.category),
    metaTitle: text(body.metaTitle),
    metaDescription: text(body.metaDescription),
    isPublished: bool(body.isPublished)
  };

  if (!partial && (!payload.title || !payload.slug || !payload.excerpt || !payload.content || !payload.category)) {
    throw new AppError("Title, slug, excerpt, content, and category are required.", 400);
  }
  if (partial) {
    Object.keys(payload).forEach((key) => {
      if (["title", "slug", "excerpt", "content", "author", "category", "metaTitle", "metaDescription"].includes(key) && payload[key] === "") {
        delete payload[key];
      }
    });
    if (body.tags === undefined) delete payload.tags;
    if (body.isPublished === undefined) delete payload.isPublished;
  }
  if (payload.slug && payload.slug.length < 2) throw new AppError("Slug must be at least 2 characters.", 400);

  return payload;
};

export const validateLookbookInput = (body, partial = false) => {
  const payload = {
    title: text(body.title),
    slug: slugify(body.slug || body.title),
    description: text(body.description),
    relatedProducts: listFromInput(body.relatedProducts),
    customerName: text(body.customerName),
    isPublished: bool(body.isPublished)
  };

  if (!partial && (!payload.title || !payload.slug || !payload.description)) {
    throw new AppError("Title, slug, and description are required.", 400);
  }
  const invalidProduct = payload.relatedProducts.find((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidProduct) throw new AppError("Related products must be valid product ids.", 400);

  if (partial) {
    Object.keys(payload).forEach((key) => {
      if (["title", "slug", "description", "customerName"].includes(key) && payload[key] === "") {
        delete payload[key];
      }
    });
    if (body.relatedProducts === undefined) delete payload.relatedProducts;
    if (body.isPublished === undefined) delete payload.isPublished;
  }
  if (payload.slug && payload.slug.length < 2) throw new AppError("Slug must be at least 2 characters.", 400);

  return payload;
};

export const validatePublishInput = (body) => ({ isPublished: bool(body.isPublished) });
