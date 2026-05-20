import { Router } from "express";
import { getRobots, getSitemap } from "../controllers/seo.controller.js";

const router = Router();

router.get("/sitemap.xml", getSitemap);
router.get("/robots.txt", getRobots);

export default router;
