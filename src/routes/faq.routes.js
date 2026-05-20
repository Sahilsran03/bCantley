import { Router } from "express";
import { getPublishedFaqs } from "../controllers/cms.controller.js";

const router = Router();

router.get("/", getPublishedFaqs);

export default router;
