import { Router } from "express";
import { getPublishedFaqs, getPublishedPolicy } from "../controllers/cms.controller.js";

const router = Router();

router.get("/faqs", getPublishedFaqs);
router.get("/:type", getPublishedPolicy);

export default router;
