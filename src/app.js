import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/error.middleware.js";
import adminRoutes from "./routes/admin.routes.js";
import announcementRoutes from "./routes/announcement.routes.js";
import authRoutes from "./routes/auth.routes.js";
import blogRoutes from "./routes/blog.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import faqRoutes from "./routes/faq.routes.js";
import healthRoutes from "./routes/health.routes.js";
import lookbookRoutes from "./routes/lookbook.routes.js";
import cartRoutes from "./routes/cart.routes.js";
import couponRoutes from "./routes/coupon.routes.js";
import designRoutes from "./routes/design.routes.js";
import offerRoutes from "./routes/offer.routes.js";
import orderRoutes from "./routes/order.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import pageRoutes from "./routes/page.routes.js";
import policyRoutes from "./routes/policy.routes.js";
import productRoutes from "./routes/product.routes.js";
import quoteRoutes from "./routes/quote.routes.js";
import recentlyViewedRoutes from "./routes/recentlyViewed.routes.js";
import returnRoutes from "./routes/return.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import rewardRoutes from "./routes/reward.routes.js";
import seoRoutes from "./routes/seo.routes.js";
import shippingRoutes from "./routes/shipping.routes.js";
import { verifyAccessToken } from "./services/token.service.js";
import uploadRoutes from "./routes/upload.routes.js";
import userRoutes from "./routes/user.routes.js";
import wishlistRoutes from "./routes/wishlist.routes.js";

const app = express();

app.set("trust proxy", 1);

const rateLimitKey = (req) => {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : null;

  if (token) {
    try {
      const payload = verifyAccessToken(token);
      if (payload?.userId) return `user:${payload.userId}`;
    } catch {
      // Fall back to IP-based limiting for missing, invalid, or expired tokens.
    }
  }

  return `ip:${req.ip}`;
};

const buildRateLimiter = ({ max, message }) =>
  rateLimit({
    windowMs: env.rateLimitWindowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    skip: (req) => req.method === "OPTIONS" || req.path === "/api/health",
    message: {
      success: false,
      message
    }
  });

const apiLimiter = buildRateLimiter({
  max: env.rateLimitMax,
  message: "Too many requests, please try again later."
});

const authLimiter = buildRateLimiter({
  max: env.authRateLimitMax,
  message: "Too many authentication attempts, please try again later."
});

app.use(helmet());
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(apiLimiter);

app.use("/api/admin", adminRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/blog", blogRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/faqs", faqRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/lookbook", lookbookRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/designs", designRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/pages", pageRoutes);
app.use("/api/policies", policyRoutes);
app.use("/api/products", productRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/recently-viewed", recentlyViewedRoutes);
app.use("/api/returns", returnRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/rewards", rewardRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/users", userRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/", seoRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
