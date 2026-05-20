import { policyTypes } from "../models/Policy.js";
import { AppError } from "../utils/appError.js";
import { sanitizeHtml } from "../utils/sanitizeHtml.js";
import { slugify } from "../utils/slugify.js";

const text = (value) => String(value || "").trim();

export const validatePageInput = (body, partial = false) => {
  const payload = {
    title: text(body.title),
    slug: slugify(body.slug || body.title),
    content: sanitizeHtml(text(body.content)),
    metaTitle: text(body.metaTitle),
    metaDescription: text(body.metaDescription),
    isPublished: body.isPublished === true || body.isPublished === "true"
  };

  if (!partial && (!payload.title || !payload.slug || !payload.content)) {
    throw new AppError("Title, slug, and content are required.", 400);
  }
  if (partial) {
    Object.keys(payload).forEach((key) => {
      if (["title", "slug", "content", "metaTitle", "metaDescription"].includes(key) && payload[key] === "") {
        delete payload[key];
      }
    });
    if (body.isPublished === undefined) delete payload.isPublished;
  }
  if (payload.slug && payload.slug.length < 2) {
    throw new AppError("Page slug must be at least 2 characters.", 400);
  }

  return payload;
};

export const validatePolicyInput = (body, partial = false) => {
  const payload = {
    type: text(body.type).toUpperCase(),
    title: text(body.title),
    content: sanitizeHtml(text(body.content)),
    isPublished: body.isPublished === true || body.isPublished === "true"
  };

  if (!partial && (!payload.type || !payload.title || !payload.content)) {
    throw new AppError("Policy type, title, and content are required.", 400);
  }
  if (payload.type && !policyTypes.includes(payload.type)) {
    throw new AppError("Invalid policy type.", 400);
  }
  if (partial) {
    Object.keys(payload).forEach((key) => {
      if (["type", "title", "content"].includes(key) && payload[key] === "") {
        delete payload[key];
      }
    });
    if (body.isPublished === undefined) delete payload.isPublished;
  }

  return payload;
};

export const validatePublishInput = (body) => ({
  isPublished: body.isPublished === true || body.isPublished === "true"
});
