import crypto from "crypto";

export const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

export const createOtpExpiry = () => new Date(Date.now() + 15 * 60 * 1000);
