import { Router } from "express";
import { getRecentlyViewed, trackRecentlyViewed } from "../controllers/recentlyViewed.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

router.get("/", getRecentlyViewed);
router.post("/:productId", trackRecentlyViewed);

export default router;
