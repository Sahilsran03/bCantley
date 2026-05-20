import { Router } from "express";
import { getCategoryBySlug, listActiveCategories } from "../controllers/category.controller.js";

const router = Router();

router.get("/", listActiveCategories);
router.get("/:slug", getCategoryBySlug);

export default router;
