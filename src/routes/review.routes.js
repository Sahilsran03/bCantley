import { Router } from "express";
import { createReview, getMyReviews } from "../controllers/review.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { handleMulterError, reviewImagesUpload } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.post("/", reviewImagesUpload, handleMulterError, createReview);
router.get("/my-reviews", getMyReviews);

export default router;
