import express, { Router } from "express";
import { handleRazorpayWebhook } from "../controllers/webhook.controller.js";

const router = Router();
export const razorpayWebhookRawBody = express.raw({ type: "application/json", limit: "1mb" });

router.post("/razorpay", handleRazorpayWebhook);

export default router;
