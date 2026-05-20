import { Router } from "express";
import { createQuoteRequest, listMyQuotes } from "../controllers/quote.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { handleMulterError, quoteFilesUpload } from "../middleware/upload.middleware.js";

const router = Router();

router.post("/", quoteFilesUpload, handleMulterError, createQuoteRequest);
router.get("/my-quotes", protect, listMyQuotes);

export default router;
