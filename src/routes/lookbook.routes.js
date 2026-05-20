import { Router } from "express";
import { getPublishedLookbook, listPublishedLookbooks } from "../controllers/content.controller.js";

const router = Router();

router.get("/", listPublishedLookbooks);
router.get("/:slug", getPublishedLookbook);

export default router;
