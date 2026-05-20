import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { cloudinaryFolders } from "../utils/cloudinaryFolders.js";

const mapFile = (file) => ({
  secure_url: file.path,
  public_id: file.filename
});

const ensureKnownFolder = (folder) => {
  if (!cloudinaryFolders[folder]) {
    throw new AppError("Invalid upload folder.", 400);
  }
};

export const uploadSingleImage = asyncHandler(async (req, res) => {
  ensureKnownFolder(req.params.folder);

  if (!req.file) {
    throw new AppError("Image file is required.", 400);
  }

  res.status(201).json({
    success: true,
    image: mapFile(req.file)
  });
});

export const uploadMultipleImages = asyncHandler(async (req, res) => {
  ensureKnownFolder(req.params.folder);

  if (!req.files?.length) {
    throw new AppError("At least one image file is required.", 400);
  }

  res.status(201).json({
    success: true,
    images: req.files.map(mapFile)
  });
});
