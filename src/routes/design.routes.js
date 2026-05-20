import { Router } from "express";
import {
  addDesignToCart,
  createDesign,
  deleteDesign,
  getDesignById,
  listMyDesigns,
  listSavedDesigns,
  removeDesignTemplate,
  saveDraftDesign,
  saveDesignTemplate,
  updateDesign,
  uploadDesignPreview,
  uploadDesignSource
} from "../controllers/design.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { designUpload, handleMulterError } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.route("/").post(designUpload, handleMulterError, createDesign);
router.post("/save-draft", designUpload, handleMulterError, saveDraftDesign);
router.post("/upload-source", designUpload, handleMulterError, uploadDesignSource);
router.post("/upload-preview", designUpload, handleMulterError, uploadDesignPreview);
router.get("/my-designs", listMyDesigns);
router.get("/saved", listSavedDesigns);
router.post("/:id/add-to-cart", addDesignToCart);
router.put("/:id/save-template", saveDesignTemplate);
router.delete("/:id/save-template", removeDesignTemplate);
router.route("/:id").get(getDesignById).put(designUpload, handleMulterError, updateDesign).delete(deleteDesign);

export default router;
