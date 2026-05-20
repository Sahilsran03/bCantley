import { Router } from "express";
import { getProductBySlug, listActiveProducts } from "../controllers/product.controller.js";
import { getProductReviews } from "../controllers/review.controller.js";

const router = Router();

router.get("/", listActiveProducts);
router.get("/:productId/reviews", getProductReviews);
router.get("/:slug", getProductBySlug);

export default router;
