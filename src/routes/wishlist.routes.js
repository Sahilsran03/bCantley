import { Router } from "express";
import { addWishlistProduct, getWishlist, removeWishlistProduct } from "../controllers/wishlist.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

router.get("/", getWishlist);
router.post("/:productId", addWishlistProduct);
router.delete("/:productId", removeWishlistProduct);

export default router;
