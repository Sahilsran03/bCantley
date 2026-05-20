import { Router } from "express";
import {
  forgotPassword,
  getProfile,
  login,
  logout,
  refreshToken,
  register,
  resendAdminTwoFactor,
  resendOtp,
  resetPassword,
  updateProfile,
  verifyAdminTwoFactor,
  verifyOtp
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/register", register);
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);
router.post("/login", login);
router.post("/verify-admin-2fa", verifyAdminTwoFactor);
router.post("/resend-admin-2fa", resendAdminTwoFactor);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/refresh-token", refreshToken);
router.post("/logout", protect, logout);
router.get("/profile", protect, getProfile);
router.put("/profile", protect, updateProfile);

export default router;
