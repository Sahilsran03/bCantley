import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import { AppError } from "../utils/appError.js";
import { resolveCloudinaryFolder } from "../utils/cloudinaryFolders.js";

const allowedFormats = ["jpg", "jpeg", "png", "webp"];
const productImageTypes = ["image/jpeg", "image/png", "image/webp"];
const productVideoTypes = ["video/mp4", "video/quicktime", "video/webm"];
const designImageTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "application/pdf"];
const designVideoTypes = ["video/mp4"];
const quoteFileTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm"
];
const maxFileSize = 40 * 1024 * 1024;

const createStorage = (folderKey) =>
  new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      if (file.fieldname === "sourceVideo") {
        return {
          folder: resolveCloudinaryFolder("designVideos"),
          resource_type: "video",
          allowed_formats: ["mp4"]
        };
      }

      if (["artwork", "sourceFiles", "previewImage"].includes(file.fieldname)) {
        return {
          folder: resolveCloudinaryFolder("designImages"),
          resource_type: file.mimetype === "application/pdf" ? "raw" : "image",
          allowed_formats: ["jpg", "jpeg", "png", "webp", "svg", "pdf"]
        };
      }

      if (file.fieldname === "designFiles") {
        return {
          folder: resolveCloudinaryFolder("quoteFiles"),
          resource_type: file.mimetype === "application/pdf" ? "raw" : file.mimetype?.startsWith("video/") ? "video" : "image",
          allowed_formats: ["jpg", "jpeg", "png", "webp", "svg", "pdf", "mp4", "mov", "webm"]
        };
      }

      if (file.fieldname === "video" || file.fieldname === "proofVideo") {
        return {
          folder: resolveCloudinaryFolder(file.fieldname === "proofVideo" ? "rewardVideos" : "productVideos"),
          resource_type: "video",
          allowed_formats: ["mp4", "mov", "webm"]
        };
      }

      return {
        folder: resolveCloudinaryFolder(folderKey),
        resource_type: "image",
        allowed_formats: allowedFormats
      };
    }
  });

const imageFileFilter = (req, file, cb) => {
  if (!productImageTypes.includes(file.mimetype)) {
    cb(new AppError("Only jpg, jpeg, png, and webp image files are allowed.", 400));
    return;
  }

  cb(null, true);
};

export const createUploadMiddleware = (folderKey) =>
  multer({
    storage: createStorage(folderKey),
    fileFilter: imageFileFilter,
    limits: {
      fileSize: maxFileSize
    }
  });

const productFileFilter = (req, file, cb) => {
  if (file.fieldname === "images" && productImageTypes.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  if (file.fieldname === "video" && productVideoTypes.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new AppError("Product uploads support jpg, jpeg, png, webp images and mp4, mov, webm videos only.", 400));
};

export const productUpload = multer({
  storage: createStorage("productImages"),
  fileFilter: productFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 6
  }
}).fields([
  { name: "images", maxCount: 5 },
  { name: "video", maxCount: 1 }
]);

export const categoryImageUpload = multer({
  storage: createStorage("categories"),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 1
  }
}).single("image");

export const rewardProofUpload = multer({
  storage: createStorage("rewardImages"),
  fileFilter: productFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 2
  }
}).fields([
  { name: "proofImage", maxCount: 1 },
  { name: "proofVideo", maxCount: 1 }
]);

export const reviewImagesUpload = multer({
  storage: createStorage("reviewImages"),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 5
  }
}).array("images", 5);

export const returnProofImagesUpload = multer({
  storage: createStorage("returnProofImages"),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 5
  }
}).array("proofImages", 5);

export const blogCoverUpload = multer({
  storage: createStorage("blogImages"),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 1
  }
}).single("coverImage");

export const lookbookImagesUpload = multer({
  storage: createStorage("lookbookImages"),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 8
  }
}).array("images", 8);

const designFileFilter = (req, file, cb) => {
  if (["artwork", "sourceFiles", "previewImage"].includes(file.fieldname) && designImageTypes.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  if (file.fieldname === "sourceVideo" && designVideoTypes.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new AppError("Design uploads support jpg, jpeg, png, webp, svg, pdf, and mp4 files only.", 400));
};

export const designUpload = multer({
  storage: createStorage("designImages"),
  fileFilter: designFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 8
  }
}).fields([
  { name: "artwork", maxCount: 5 },
  { name: "sourceFiles", maxCount: 5 },
  { name: "previewImage", maxCount: 1 },
  { name: "sourceVideo", maxCount: 1 }
]); 

const quoteFileFilter = (req, file, cb) => {
  if (quoteFileTypes.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new AppError("Quote uploads support jpg, jpeg, png, webp, svg, pdf, mp4, mov, and webm files only.", 400));
};

export const quoteFilesUpload = multer({
  storage: createStorage("quoteFiles"),
  fileFilter: quoteFileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 5
  }
}).array("designFiles", 5);

export const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    next(new AppError("File size must not exceed 40MB.", 400));
    return;
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_UNEXPECTED_FILE") {
    next(new AppError("Too many files or unexpected upload field.", 400));
    return;
  }

  next(error);
};
