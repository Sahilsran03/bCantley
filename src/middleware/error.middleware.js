export const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

export const errorHandler = (error, req, res, next) => {
  const isJwtError = ["JsonWebTokenError", "TokenExpiredError"].includes(error.name);
  const isDuplicateKey = error.code === 11000;
  const isCastError = error.name === "CastError";
  const isValidationError = error.name === "ValidationError";
  const isCloudinaryConfigError =
    error.message?.includes("Must supply api_key") || error.message?.includes("Must supply cloud_name");
  const statusCode = isJwtError
    ? 401
    : isDuplicateKey
      ? 409
      : isCastError || isValidationError
        ? 400
        : isCloudinaryConfigError
          ? 500
          : error.statusCode || 500;
  const isProduction = process.env.NODE_ENV === "production";
  const message = isJwtError
    ? "Invalid or expired token."
    : isDuplicateKey
      ? "A record with this value already exists."
      : isCastError
        ? "Invalid resource identifier."
        : isValidationError
          ? "Validation failed."
          : isCloudinaryConfigError
            ? "Cloudinary is not configured."
            : error.message;

  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 && isProduction ? "Internal server error" : message,
    ...(isProduction ? {} : { stack: error.stack })
  });
};
