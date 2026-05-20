import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const createAccessToken = (user) =>
  jwt.sign({ userId: user._id.toString(), role: user.role }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn
  });

export const createRefreshToken = (user) =>
  jwt.sign({ userId: user._id.toString() }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn
  });

export const createAuthTokens = (user) => ({
  accessToken: createAccessToken(user),
  refreshToken: createRefreshToken(user)
});

export const verifyAccessToken = (token) => jwt.verify(token, env.jwtAccessSecret);

export const verifyRefreshToken = (token) => jwt.verify(token, env.jwtRefreshSecret);
