import { Router } from "express";
import { listActiveAnnouncements } from "../controllers/notification.controller.js";

const router = Router();

router.get("/", listActiveAnnouncements);

export default router;
