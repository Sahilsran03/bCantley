import bcrypt from "bcryptjs";
import { authenticateGoogle } from "../services/googleAuth.service.js";
import crypto from "node:crypto";
import PendingUser from "../models/PendingUser.js";
import User from "../models/User.js";
import { emailTemplates, sendOtpEmail, sendTemplateEmail, sendTwoFactorEmail } from "../services/email.service.js";
import { env } from "../config/env.js";
import { createAuthTokens, verifyRefreshToken } from "../services/token.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createOtpExpiry, generateOtp } from "../utils/otp.js";
import {
  validateAdminTwoFactorInput,
  validateForgotPasswordInput,
  validateLoginInput,
  validateProfileInput,
  validateRegisterInput,
  validateResendAdminTwoFactorInput,
  validateResetPasswordInput,
  validateVerifyOtpInput
} from "../validators/auth.validator.js";

const sanitizeUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  isVerified: user.isVerified,
  avatar: user.avatar || "",
  gender: user.gender || "",
  dateOfBirth: user.dateOfBirth || null,
  addresses: user.addresses || [],
  walletBalance: user.walletBalance || 0,
  loyaltyRank: user.loyaltyRank || "Member"
});

const persistRefreshToken = async (user, refreshToken) => {
  user.refreshToken = refreshToken;
  await user.save();
};

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const issueAuthResponse = async (res, user, statusCode = 200) => {
  const tokens = createAuthTokens(user);
  user.adminTwoFactorOtp = null;
  user.adminTwoFactorOtpExpiry = null;
  user.adminTwoFactorRequestToken = null;
  user.adminTwoFactorAttempts = 0;
  await persistRefreshToken(user, tokens.refreshToken);

  res.status(statusCode).json({
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: sanitizeUser(user)
  });
};

export const register = asyncHandler(async (req, res) => {
  const payload = validateRegisterInput(req.body);

  const existingUser = await User.findOne({ email: payload.email });
  if (existingUser) {
    throw new AppError("An account with this email already exists.", 409);
  }

  const existingPendingUser = await PendingUser.findOne({ email: payload.email });
  if (existingPendingUser) {
    if (existingPendingUser.otpExpiry.getTime() < Date.now()) {
      await PendingUser.deleteOne({ _id: existingPendingUser._id });
    } else {
      throw new AppError("An OTP has already been sent. Please verify it or try again later.", 409);
    }
  }

  const hashedPassword = await bcrypt.hash(payload.password, 12);
  const otp = generateOtp();

  const pendingUser = await PendingUser.create({
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    password: hashedPassword,
    otp,
    otpExpiry: createOtpExpiry()
  });

  try {
    await sendOtpEmail({
      to: payload.email,
      name: payload.name,
      otp
    });
  } catch (error) {
    console.error("OTP EMAIL ERROR:", error);
  
    await PendingUser.deleteOne({ _id: pendingUser._id });
  
    throw new AppError(
      `Unable to send OTP email: ${error.message}`,
      502
    );
  }

  res.status(201).json({
    success: true,
    message: "Registration started. Please verify the OTP sent to your email.",
    email: payload.email
  });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = validateVerifyOtpInput(req.body);
  const pendingUser = await PendingUser.findOne({ email });

  if (!pendingUser) {
    throw new AppError("No pending registration found for this email.", 404);
  }

  if (pendingUser.otpExpiry.getTime() < Date.now()) {
    await PendingUser.deleteOne({ _id: pendingUser._id });
    throw new AppError("OTP has expired. Please register again.", 410);
  }

  if (pendingUser.attempts >= 5) {
    await PendingUser.deleteOne({ _id: pendingUser._id });
    throw new AppError("Maximum OTP attempts exceeded. Please register again.", 429);
  }

  if (pendingUser.otp !== otp) {
    pendingUser.attempts += 1;

    if (pendingUser.attempts >= 5) {
      await PendingUser.deleteOne({ _id: pendingUser._id });
      throw new AppError("Maximum OTP attempts exceeded. Please register again.", 429);
    }

    await pendingUser.save();
    throw new AppError("Invalid OTP.", 400);
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    await PendingUser.deleteOne({ _id: pendingUser._id });
    throw new AppError("An account with this email already exists.", 409);
  }

  const user = await User.create({
    name: pendingUser.name,
    email: pendingUser.email,
    phone: pendingUser.phone,
    password: pendingUser.password,
    role: "customer",
    isVerified: true
  });

  await PendingUser.deleteOne({ _id: pendingUser._id });
  await issueAuthResponse(res, user, 201);
});

export const resendOtp = asyncHandler(async (req, res) => {
  const { email } = validateForgotPasswordInput(req.body);
  const pendingUser = await PendingUser.findOne({ email });

  if (!pendingUser) {
    throw new AppError("No pending registration found for this email.", 404);
  }

  if (pendingUser.otpExpiry.getTime() < Date.now()) {
    await PendingUser.deleteOne({ _id: pendingUser._id });
    throw new AppError("OTP has expired. Please register again.", 410);
  }

  const otp = generateOtp();
  pendingUser.otp = otp;
  pendingUser.otpExpiry = createOtpExpiry();
  pendingUser.attempts = 0;
  await pendingUser.save();

  await sendOtpEmail({
    to: pendingUser.email,
    name: pendingUser.name,
    otp
  });

  res.status(200).json({
    success: true,
    message: "A new OTP has been sent to your email."
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = validateLoginInput(req.body);
  const user = await User.findOne({ email }).select("+password +refreshToken");

  if (!user || !(await user.comparePassword(password))) {
    throw new AppError("Invalid password.", 401);
  }

  if (!user.isVerified) {
    throw new AppError("Please verify your account before logging in.", 403);
  }

  if (user.role === "admin") {
    const otp = generateOtp();
    const requestToken = crypto.randomBytes(32).toString("hex");
    user.adminTwoFactorOtp = otp;
    user.adminTwoFactorOtpExpiry = createOtpExpiry();
    user.adminTwoFactorRequestToken = hashToken(requestToken);
    user.adminTwoFactorAttempts = 0;
    await user.save();

    await sendTwoFactorEmail({
      to: user.email,
      name: user.name,
      otp
    });

    res.status(200).json({
      success: true,
      requiresTwoFactor: true,
      message: "Admin verification code sent to your email.",
      email: user.email,
      requestToken
    });
    return;
  }

  await issueAuthResponse(res, user);
});

export const verifyAdminTwoFactor = asyncHandler(async (req, res) => {
  const { email, otp, requestToken } = validateAdminTwoFactorInput(req.body);
  const user = await User.findOne({ email, role: "admin" }).select(
    "+adminTwoFactorOtp +adminTwoFactorOtpExpiry +adminTwoFactorRequestToken +adminTwoFactorAttempts +refreshToken"
  );

  if (!user || !user.adminTwoFactorOtp || !user.adminTwoFactorOtpExpiry || !user.adminTwoFactorRequestToken) {
    throw new AppError("No admin verification is pending for this account.", 404);
  }

  if (user.adminTwoFactorRequestToken !== hashToken(requestToken)) {
    throw new AppError("Admin verification session is invalid.", 401);
  }

  if (user.adminTwoFactorOtpExpiry.getTime() < Date.now()) {
    user.adminTwoFactorOtp = null;
    user.adminTwoFactorOtpExpiry = null;
    user.adminTwoFactorRequestToken = null;
    user.adminTwoFactorAttempts = 0;
    await user.save();
    throw new AppError("Admin verification code has expired. Please login again.", 410);
  }

  if (user.adminTwoFactorAttempts >= 5) {
    user.adminTwoFactorOtp = null;
    user.adminTwoFactorOtpExpiry = null;
    user.adminTwoFactorRequestToken = null;
    user.adminTwoFactorAttempts = 0;
    await user.save();
    throw new AppError("Maximum admin verification attempts exceeded. Please login again.", 429);
  }

  if (user.adminTwoFactorOtp !== otp) {
    user.adminTwoFactorAttempts += 1;
    await user.save();
    throw new AppError("Invalid admin verification code.", 400);
  }

  await issueAuthResponse(res, user);
});

export const resendAdminTwoFactor = asyncHandler(async (req, res) => {
  const { email, requestToken } = validateResendAdminTwoFactorInput(req.body);
  const user = await User.findOne({ email, role: "admin" }).select(
    "+adminTwoFactorOtp +adminTwoFactorOtpExpiry +adminTwoFactorRequestToken +adminTwoFactorAttempts"
  );

  if (!user || !user.adminTwoFactorRequestToken || user.adminTwoFactorRequestToken !== hashToken(requestToken)) {
    throw new AppError("Admin verification session is invalid or expired. Please login again.", 401);
  }

  const otp = generateOtp();
  user.adminTwoFactorOtp = otp;
  user.adminTwoFactorOtpExpiry = createOtpExpiry();
  user.adminTwoFactorAttempts = 0;
  await user.save();

  await sendTwoFactorEmail({
    to: user.email,
    name: user.name,
    otp
  });

  res.status(200).json({
    success: true,
    message: "A new admin verification code has been sent."
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = validateForgotPasswordInput(req.body);
  const user = await User.findOne({ email }).select("+passwordResetToken +passwordResetExpiry");

  if (user) {
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = hashToken(resetToken);
    user.passwordResetExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const resetLink = `${env.clientUrl.replace(/\/$/, "")}/reset-password/${resetToken}`;
    await sendTemplateEmail({
      to: user.email,
      template: emailTemplates.passwordReset({ resetLink })
    });
  }

  res.status(200).json({
    success: true,
    message: "If an account exists with this email, a password reset link has been sent."
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = validateResetPasswordInput(req.body);
  const hashedToken = hashToken(token);
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpiry: { $gt: new Date() }
  }).select("+password +refreshToken +passwordResetToken +passwordResetExpiry");

  if (!user) {
    throw new AppError("Password reset link is invalid or expired.", 400);
  }

  user.password = await bcrypt.hash(password, 12);
  user.refreshToken = null;
  user.passwordResetToken = null;
  user.passwordResetExpiry = null;
  await user.save();

  res.status(200).json({
    success: true,
    message: "Password reset successfully. Please login with your new password."
  });
});

export const refreshToken = asyncHandler(async (req, res) => {
  const token = req.body.refreshToken;

  if (!token) {
    throw new AppError("Refresh token is required.", 400);
  }

  const payload = verifyRefreshToken(token);
  const user = await User.findById(payload.userId).select("+refreshToken");

  if (!user || user.refreshToken !== token || !user.isVerified) {
    throw new AppError("Invalid refresh token.", 401);
  }

  await issueAuthResponse(res, user);
});

export const logout = asyncHandler(async (req, res) => {
  req.user.refreshToken = null;
  await req.user.save();

  res.status(200).json({
    success: true,
    message: "Logged out successfully."
  });
});

export const getProfile = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    user: sanitizeUser(req.user)
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const payload = validateProfileInput(req.body);

  req.user.name = payload.name;
  req.user.phone = payload.phone;
  await req.user.save();

  res.status(200).json({
    success: true,
    user: sanitizeUser(req.user)
  });
});

export const googleLogin = asyncHandler(async (req, res) => {
  const { user, created } = await authenticateGoogle(req.body);
  await issueAuthResponse(res, user, created ? 201 : 200);
});
