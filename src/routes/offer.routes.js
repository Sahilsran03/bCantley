import { Router } from "express";
import { listActiveOffers } from "../controllers/offer.controller.js";

const router = Router();

router.get("/active", listActiveOffers);

export default router;
