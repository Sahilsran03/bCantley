import { Router } from "express";
import { getPublishedPage } from "../controllers/cms.controller.js";

const router = Router();

router.get("/:slug", getPublishedPage);

export default router;
