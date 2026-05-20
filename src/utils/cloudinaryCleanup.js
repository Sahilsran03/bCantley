import cloudinary from "../config/cloudinary.js";

export const deleteCloudinaryAsset = async (publicId, resourceType = "image") => {
  if (!publicId) {
    return null;
  }

  return cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType
  });
};

export const deleteCloudinaryImage = (publicId) => deleteCloudinaryAsset(publicId, "image");

export const deleteCloudinaryVideo = (publicId) => deleteCloudinaryAsset(publicId, "video");
