import { Router } from "express";
import { checkout, getMyOrderById, getMyOrders } from "../controllers/order.controller.js";
import { getOrderTracking } from "../controllers/shipping.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

router.post("/checkout", checkout);
router.get("/my-orders", getMyOrders);
router.get("/:id/tracking", getOrderTracking);
router.get("/:id", getMyOrderById);

export default router;
