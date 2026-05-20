import { Router } from "express";
import { getPublishedBlogPost, listPublishedBlogPosts } from "../controllers/content.controller.js";

const router = Router();

router.get("/", listPublishedBlogPosts);
router.get("/:slug", getPublishedBlogPost);

export default router;
