export const fileToCloudinaryAsset = (file) => ({
  url: file.path,
  publicId: file.filename
});

export const getMediaUrl = (media) => {
  if (!media) return "";
  return typeof media === "string" ? media : media.url || "";
};

export const getMediaPublicId = (media) => {
  if (!media || typeof media === "string") return "";
  return media.publicId || "";
};
