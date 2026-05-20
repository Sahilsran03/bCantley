import { Router } from "express";
import {
  createBlogPost,
  createLookbook,
  deleteBlogPost,
  deleteLookbook,
  getAdminBlogPostById,
  getAdminLookbookById,
  listAdminBlogPosts,
  listAdminLookbooks,
  publishBlogPost,
  publishLookbook,
  updateBlogPost,
  updateLookbook
} from "../controllers/content.controller.js";
import {
  createPage,
  createPolicy,
  deletePage,
  deletePolicy,
  getAdminPageById,
  getAdminPolicyById,
  listAdminPages,
  listAdminPolicies,
  publishPage,
  publishPolicy,
  updatePage,
  updatePolicy
} from "../controllers/cms.controller.js";
import {
  getCustomerAnalytics,
  getDashboardAnalytics,
  getProductAnalytics,
  getRewardAnalytics,
  getSalesAnalytics
} from "../controllers/analytics.controller.js";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAdminAnnouncements,
  listAdminNotifications,
  sendManualAnnouncement,
  updateAnnouncement
} from "../controllers/notification.controller.js";
import {
  createCategory,
  deleteCategory,
  listAdminCategories,
  updateCategory
} from "../controllers/category.controller.js";
import {
  createCoupon,
  deleteCoupon,
  listAdminCoupons,
  toggleCouponActive,
  updateCoupon
} from "../controllers/coupon.controller.js";
import { getAdminDesignById, listAdminDesigns, updateDesignStatus } from "../controllers/design.controller.js";
import {
  createOffer,
  deleteOffer,
  listAdminOffers,
  toggleOfferActive,
  updateOffer
} from "../controllers/offer.controller.js";
import {
  getAdminOrderById,
  listAdminOrders,
  updateAdminOrderStatus,
  updateAdminPaymentStatus
} from "../controllers/order.controller.js";
import {
  createProduct,
  deleteProduct,
  listAdminProducts,
  toggleProductActive,
  updateProduct
} from "../controllers/product.controller.js";
import {
  getAdminQuoteById,
  listAdminQuotes,
  updateQuoteAmount,
  updateQuoteStatus
} from "../controllers/quote.controller.js";
import { listAdminReviews } from "../controllers/review.controller.js";
import { listAdminRewards, updateRewardStatus } from "../controllers/reward.controller.js";
import {
  getAdminReturnRequestById,
  listAdminReturnRequests,
  updateReturnRefundStatus,
  updateReturnRequestStatus
} from "../controllers/return.controller.js";
import {
  addTrackingUpdate,
  createShippingZone,
  deleteShippingZone,
  listShippingZones,
  updateOrderShipping,
  updateShippingZone
} from "../controllers/shipping.controller.js";
import { authorizeRoles, protect } from "../middleware/auth.middleware.js";
import {
  blogCoverUpload,
  categoryImageUpload,
  handleMulterError,
  lookbookImagesUpload,
  productUpload
} from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect, authorizeRoles("admin"));

router.get("/analytics/dashboard", getDashboardAnalytics);
router.get("/analytics/sales", getSalesAnalytics);
router.get("/analytics/products", getProductAnalytics);
router.get("/analytics/customers", getCustomerAnalytics);
router.get("/analytics/rewards", getRewardAnalytics);

router.get("/notifications", listAdminNotifications);
router.route("/announcements").get(listAdminAnnouncements).post(createAnnouncement);
router.post("/announcements/send", sendManualAnnouncement);
router.route("/announcements/:id").put(updateAnnouncement).delete(deleteAnnouncement);

router.route("/categories").get(listAdminCategories).post(categoryImageUpload, handleMulterError, createCategory);
router.route("/categories/:id").put(categoryImageUpload, handleMulterError, updateCategory).delete(deleteCategory);

router.route("/coupons").get(listAdminCoupons).post(createCoupon);
router.route("/coupons/:id").put(updateCoupon).delete(deleteCoupon);
router.patch("/coupons/:id/toggle-active", toggleCouponActive);

router.route("/offers").get(listAdminOffers).post(createOffer);
router.route("/offers/:id").put(updateOffer).delete(deleteOffer);
router.patch("/offers/:id/toggle-active", toggleOfferActive);

router.route("/pages").get(listAdminPages).post(createPage);
router.route("/pages/:id").get(getAdminPageById).put(updatePage).delete(deletePage);
router.put("/pages/:id/publish", publishPage);

router.route("/policies").get(listAdminPolicies).post(createPolicy);
router.route("/policies/:id").get(getAdminPolicyById).put(updatePolicy).delete(deletePolicy);
router.put("/policies/:id/publish", publishPolicy);

router.route("/blog").get(listAdminBlogPosts).post(blogCoverUpload, handleMulterError, createBlogPost);
router.route("/blog/:id").get(getAdminBlogPostById).put(blogCoverUpload, handleMulterError, updateBlogPost).delete(deleteBlogPost);
router.put("/blog/:id/publish", publishBlogPost);

router.route("/lookbook").get(listAdminLookbooks).post(lookbookImagesUpload, handleMulterError, createLookbook);
router
  .route("/lookbook/:id")
  .get(getAdminLookbookById)
  .put(lookbookImagesUpload, handleMulterError, updateLookbook)
  .delete(deleteLookbook);
router.put("/lookbook/:id/publish", publishLookbook);

router.route("/products").get(listAdminProducts).post(productUpload, handleMulterError, createProduct);
router.route("/products/:id").put(productUpload, handleMulterError, updateProduct).delete(deleteProduct);
router.patch("/products/:id/toggle-active", toggleProductActive);

router.get("/orders", listAdminOrders);
router.get("/orders/:id", getAdminOrderById);
router.put("/orders/:id/status", updateAdminOrderStatus);
router.put("/orders/:id/payment-status", updateAdminPaymentStatus);
router.put("/orders/:id/shipping", updateOrderShipping);
router.put("/orders/:id/tracking-update", addTrackingUpdate);

router.route("/shipping-zones").get(listShippingZones).post(createShippingZone);
router.route("/shipping-zones/:id").put(updateShippingZone).delete(deleteShippingZone);

router.get("/reviews", listAdminReviews);
router.get("/returns", listAdminReturnRequests);
router.get("/returns/:id", getAdminReturnRequestById);
router.put("/returns/:id/status", updateReturnRequestStatus);
router.put("/returns/:id/refund-status", updateReturnRefundStatus);
router.get("/rewards", listAdminRewards);
router.put("/rewards/:id/status", updateRewardStatus);
router.get("/designs", listAdminDesigns);
router.get("/designs/:id", getAdminDesignById);
router.put("/designs/:id/status", updateDesignStatus);
router.get("/quotes", listAdminQuotes);
router.get("/quotes/:id", getAdminQuoteById);
router.put("/quotes/:id/status", updateQuoteStatus);
router.put("/quotes/:id/quote", updateQuoteAmount);

export default router;
