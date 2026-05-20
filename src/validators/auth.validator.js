import { AppError } from "../utils/appError.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9+\-\s()]{7,20}$/;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim();

export const validateRegisterInput = (body) => {
  const name = normalizeText(body.name);
  const email = normalizeEmail(body.email);
  const phone = normalizeText(body.phone);
  const password = String(body.password || "");

  if (name.length < 2 || name.length > 80) {
    throw new AppError("Name must be between 2 and 80 characters.", 400);
  }

  if (!emailPattern.test(email)) {
    throw new AppError("Please provide a valid email address.", 400);
  }

  if (!phonePattern.test(phone)) {
    throw new AppError("Please provide a valid phone number.", 400);
  }

  if (password.length < 8) {
    throw new AppError("Password must be at least 8 characters.", 400);
  }

  return { name, email, phone, password };
};

export const validateVerifyOtpInput = (body) => {
  const email = normalizeEmail(body.email);
  const otp = normalizeText(body.otp);

  if (!emailPattern.test(email)) {
    throw new AppError("Please provide a valid email address.", 400);
  }

  if (!/^\d{6}$/.test(otp)) {
    throw new AppError("OTP must be a 6-digit code.", 400);
  }

  return { email, otp };
};

export const validateAdminTwoFactorInput = (body) => {
  const payload = validateVerifyOtpInput(body);
  const requestToken = normalizeText(body.requestToken);

  if (!requestToken) {
    throw new AppError("Admin verification session is required.", 400);
  }

  return { ...payload, requestToken };
};

export const validateResendAdminTwoFactorInput = (body) => {
  const email = normalizeEmail(body.email);
  const requestToken = normalizeText(body.requestToken);

  if (!emailPattern.test(email)) {
    throw new AppError("Please provide a valid email address.", 400);
  }

  if (!requestToken) {
    throw new AppError("Admin verification session is required.", 400);
  }

  return { email, requestToken };
};

export const validateLoginInput = (body) => {
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (!emailPattern.test(email) || !password) {
    throw new AppError("Email and password are required.", 400);
  }

  return { email, password };
};

export const validateForgotPasswordInput = (body) => {
  const email = normalizeEmail(body.email);

  if (!emailPattern.test(email)) {
    throw new AppError("Please provide a valid email address.", 400);
  }

  return { email };
};

export const validateResetPasswordInput = (body) => {
  const token = normalizeText(body.token);
  const password = String(body.password || "");

  if (!token) {
    throw new AppError("Reset token is required.", 400);
  }

  if (password.length < 8) {
    throw new AppError("Password must be at least 8 characters.", 400);
  }

  return { token, password };
};

export const validateProfileInput = (body) => {
  const name = normalizeText(body.name);
  const phone = normalizeText(body.phone);

  if (name.length < 2 || name.length > 80) {
    throw new AppError("Name must be between 2 and 80 characters.", 400);
  }

  if (!phonePattern.test(phone)) {
    throw new AppError("Please provide a valid phone number.", 400);
  }

  return { name, phone };
};
