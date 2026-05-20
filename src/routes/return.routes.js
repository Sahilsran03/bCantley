import { Router } from "express";
import {
  createReturnRequest,
  getMyReturnRequestById,
  listMyReturnRequests
} from "../controllers/return.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { handleMulterError, returnProofImagesUpload } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.post("/", returnProofImagesUpload, handleMulterError, createReturnRequest);
router.get("/my-requests", listMyReturnRequests);
router.get("/:id", getMyReturnRequestById);

export default router;
