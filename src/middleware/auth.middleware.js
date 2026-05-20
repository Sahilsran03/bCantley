import User from "../models/User.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../services/token.service.js";

export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;

  if (!token) {
    throw new AppError("Authentication required.", 401);
  }

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.userId);

  if (!user || !user.isVerified) {
    throw new AppError("Authentication failed.", 401);
  }

  req.user = user;
  next();
});

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      throw new AppError("You do not have permission to access this resource.", 403);
    }

    next();
  };
};
