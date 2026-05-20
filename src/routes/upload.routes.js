import { Router } from "express";
import { uploadMultipleImages, uploadSingleImage } from "../controllers/upload.controller.js";
import { authorizeRoles, protect } from "../middleware/auth.middleware.js";
import { createUploadMiddleware, handleMulterError } from "../middleware/upload.middleware.js";

const router = Router();

const uploadForFolder = (req, res, next) => {
  req.upload = createUploadMiddleware(req.params.folder);
  next();
};

const requireAdminForCatalogFolders = (req, res, next) => {
  if (["products", "categories"].includes(req.params.folder)) {
    return authorizeRoles("admin")(req, res, next);
  }

  next();
};

router.use(protect);

router.post(
  "/:folder/single",
  requireAdminForCatalogFolders,
  uploadForFolder,
  (req, res, next) => req.upload.single("image")(req, res, next),
  handleMulterError,
  uploadSingleImage
);

router.post(
  "/:folder/multiple",
  authorizeRoles("admin"),
  uploadForFolder,
  (req, res, next) => req.upload.array("images", 10)(req, res, next),
  handleMulterError,
  uploadMultipleImages
);

export default router;
