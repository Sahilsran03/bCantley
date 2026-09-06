import { Router } from "express";
import { checkout, checkoutPreview, createCodAdvancePayment, getMyOrderById, getMyOrders, verifyCodAdvancePayment } from "../controllers/order.controller.js";
import { getOrderTracking } from "../controllers/shipping.controller.js";
import { createOnlinePayment, verifyOnlinePayment } from "../controllers/online-payment.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

router.post("/checkout", checkout);
router.post("/checkout-preview", checkoutPreview);
router.post("/:id/payments/cod-advance", createCodAdvancePayment);
router.post("/:id/payments/cod-advance/verify", verifyCodAdvancePayment);
router.post("/:id/payments/online", createOnlinePayment);
router.post("/:id/payments/online/verify", verifyOnlinePayment);
router.get("/my-orders", getMyOrders);
router.get("/:id/tracking", getOrderTracking);
router.get("/:id", getMyOrderById);

export default router;
