import Page from "../models/Page.js";
import Policy from "../models/Policy.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validatePageInput, validatePolicyInput, validatePublishInput } from "../validators/cms.validator.js";

const findPage = async (id) => {
  const page = await Page.findById(id);
  if (!page) throw new AppError("Page not found.", 404);
  return page;
};

const findPolicy = async (id) => {
  const policy = await Policy.findById(id);
  if (!policy) throw new AppError("Policy not found.", 404);
  return policy;
};

export const getPublishedPage = asyncHandler(async (req, res) => {
  const page = await Page.findOne({ slug: req.params.slug, isPublished: true }).lean();
  if (!page) throw new AppError("Page not found.", 404);
  res.status(200).json({ success: true, page });
});

export const getPublishedPolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.findOne({ type: String(req.params.type || "").toUpperCase(), isPublished: true }).lean();
  if (!policy) throw new AppError("Policy not found.", 404);
  res.status(200).json({ success: true, policy });
});

export const getPublishedFaqs = asyncHandler(async (req, res) => {
  const policy = await Policy.findOne({ type: "FAQ", isPublished: true }).lean();
  if (!policy) throw new AppError("FAQ not found.", 404);
  res.status(200).json({ success: true, faq: policy });
});

export const listAdminPages = asyncHandler(async (req, res) => {
  const pages = await Page.find().sort({ updatedAt: -1 });
  res.status(200).json({ success: true, count: pages.length, pages });
});

export const getAdminPageById = asyncHandler(async (req, res) => {
  const page = await findPage(req.params.id);
  res.status(200).json({ success: true, page });
});

export const createPage = asyncHandler(async (req, res) => {
  const payload = validatePageInput(req.body);
  const page = await Page.create(payload);
  res.status(201).json({ success: true, page });
});

export const updatePage = asyncHandler(async (req, res) => {
  const payload = validatePageInput(req.body, true);
  const page = await Page.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
  if (!page) throw new AppError("Page not found.", 404);
  res.status(200).json({ success: true, page });
});

export const deletePage = asyncHandler(async (req, res) => {
  const page = await Page.findByIdAndDelete(req.params.id);
  if (!page) throw new AppError("Page not found.", 404);
  res.status(200).json({ success: true, message: "Page deleted." });
});

export const publishPage = asyncHandler(async (req, res) => {
  const payload = validatePublishInput(req.body);
  const page = await findPage(req.params.id);
  page.isPublished = payload.isPublished;
  await page.save();
  res.status(200).json({ success: true, page });
});

export const listAdminPolicies = asyncHandler(async (req, res) => {
  const policies = await Policy.find().sort({ type: 1 });
  res.status(200).json({ success: true, count: policies.length, policies });
});

export const getAdminPolicyById = asyncHandler(async (req, res) => {
  const policy = await findPolicy(req.params.id);
  res.status(200).json({ success: true, policy });
});

export const createPolicy = asyncHandler(async (req, res) => {
  const payload = validatePolicyInput(req.body);
  const policy = await Policy.create(payload);
  res.status(201).json({ success: true, policy });
});

export const updatePolicy = asyncHandler(async (req, res) => {
  const payload = validatePolicyInput(req.body, true);
  const policy = await Policy.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
  if (!policy) throw new AppError("Policy not found.", 404);
  res.status(200).json({ success: true, policy });
});

export const deletePolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.findByIdAndDelete(req.params.id);
  if (!policy) throw new AppError("Policy not found.", 404);
  res.status(200).json({ success: true, message: "Policy deleted." });
});

export const publishPolicy = asyncHandler(async (req, res) => {
  const payload = validatePublishInput(req.body);
  const policy = await findPolicy(req.params.id);
  policy.isPublished = payload.isPublished;
  await policy.save();
  res.status(200).json({ success: true, policy });
});
