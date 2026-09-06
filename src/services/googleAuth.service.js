import User from "../models/User.js";
import { AppError } from "../utils/appError.js";
import { verifyGoogleCredential } from "./googleToken.service.js";

const requireCustomer = (user) => {
  if (user.role !== "customer" || !user.isVerified) throw new AppError("Google sign-in is not available for this account.", 403);
  return user;
};

export const createGoogleAuthentication = ({ users = User, verify = verifyGoogleCredential } = {}) => async (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.credential !== "string") {
    throw new AppError("Provide only a Google credential.", 400);
  }
  const claims = await verify(body.credential);
  const linked = await users.findOne({ googleId: claims.sub });
  if (linked) return { user: requireCustomer(linked), created: false };
  const email = claims.email.trim().toLowerCase();
  const existing = await users.findOne({ email });
  // Email alone never links an existing local account (including third-party Google emails).
  if (existing) throw new AppError("An account with this email already exists. Sign in using its existing method.", 409);
  const name = typeof claims.name === "string" ? claims.name.trim().slice(0, 80) : "";
  try {
    const user = await users.create({
      googleId: claims.sub, email, name: name.length >= 2 ? name : "Google customer",
      role: "customer", isVerified: true
    });
    return { user, created: true };
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Unique email and provider indexes arbitrate concurrent first sign-ins.
    const winner = await users.findOne({ googleId: claims.sub });
    if (winner) return { user: requireCustomer(winner), created: false };
    throw new AppError("An account with this email already exists. Sign in using its existing method.", 409);
  }
};
export const authenticateGoogle = createGoogleAuthentication();
