import { createPublicKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/appError.js";

const keysUrl = "https://www.googleapis.com/oauth2/v3/certs";
const invalidCredential = () => new AppError("Invalid Google credential.", 401);

// The transport is injectable for offline tests; production only fetches Google's fixed key URL.
export const createGoogleVerifier = ({ fetchKeys = (...args) => fetch(...args), now = Date.now } = {}) => {
  let cachedKeys = [];
  let expiresAt = 0;
  let inFlight;
  const keys = async () => {
    if (now() < expiresAt) return cachedKeys;
    if (!inFlight) {
      inFlight = (async () => {
        try {
          const response = await fetchKeys(keysUrl, { signal: AbortSignal.timeout(5000), redirect: "error" });
          if (!response.ok) throw new Error("Key service unavailable");
          const body = await response.json();
          if (!Array.isArray(body.keys) || !body.keys.length) throw new Error("Invalid keys");
          cachedKeys = body.keys;
          const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1] || 300);
          expiresAt = now() + Math.min(maxAge, 3600) * 1000;
          return cachedKeys;
        } catch {
          throw new AppError("Google sign-in is temporarily unavailable. Please try again.", 503);
        }
      })().finally(() => { inFlight = undefined; });
    }
    return inFlight;
  };
  return async (credential, clientId = process.env.GOOGLE_CLIENT_ID?.trim()) => {
    if (!clientId) throw new AppError("Google sign-in is not configured.", 503);
    if (typeof credential !== "string" || !credential || credential.length > 16384) throw invalidCredential();
    const decoded = jwt.decode(credential, { complete: true });
    if (!decoded || decoded.header.alg !== "RS256" || typeof decoded.header.kid !== "string") throw invalidCredential();
    const available = await keys();
    const jwk = available.find((key) => key.kid === decoded.header.kid && key.kty === "RSA" && key.use === "sig" && key.alg === "RS256");
    if (!jwk) throw invalidCredential();
    try {
      const claims = jwt.verify(credential, createPublicKey({ key: jwk, format: "jwk" }), {
        algorithms: ["RS256"], audience: clientId,
        issuer: ["accounts.google.com", "https://accounts.google.com"],
        clockTimestamp: Math.floor(now() / 1000)
      });
      if (typeof claims.exp !== "number" || typeof claims.iat !== "number" || claims.iat > Math.floor(now() / 1000) + 60 ||
          typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255 ||
          claims.email_verified !== true || typeof claims.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) ||
          (claims.azp !== undefined && claims.azp !== clientId)) throw invalidCredential();
      return claims;
    } catch {
      throw invalidCredential();
    }
  };
};
export const verifyGoogleCredential = createGoogleVerifier();
