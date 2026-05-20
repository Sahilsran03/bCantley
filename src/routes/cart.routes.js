import { Router } from "express";
import {
  addCartItem,
  clearCart,
  getCart,
  removeCartItem,
  updateCartItem
} from "../controllers/cart.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);

router.route("/").get(getCart).post(addCartItem).delete(clearCart);
router.route("/items/:itemId").put(updateCartItem).delete(removeCartItem);

export default router;
