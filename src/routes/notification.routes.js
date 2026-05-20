import { Router } from "express";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "../controllers/notification.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);
router.get("/", listMyNotifications);
router.put("/read-all", markAllNotificationsRead);
router.put("/:id/read", markNotificationRead);

export default router;
