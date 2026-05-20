import { Router } from "express";
import {
  addAddress,
  deleteAddress,
  getUserProfile,
  setDefaultAddress,
  updateAddress,
  updateUserProfile
} from "../controllers/user.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

router.get("/profile", getUserProfile);
router.put("/profile", updateUserProfile);
router.post("/addresses", addAddress);
router.put("/addresses/:addressId", updateAddress);
router.delete("/addresses/:addressId", deleteAddress);
router.put("/addresses/:addressId/default", setDefaultAddress);

export default router;
