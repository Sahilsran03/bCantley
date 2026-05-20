import { Router } from "express";
import { checkShipping } from "../controllers/shipping.controller.js";

const router = Router();

router.get("/check/:postalCode", checkShipping);

export default router;
