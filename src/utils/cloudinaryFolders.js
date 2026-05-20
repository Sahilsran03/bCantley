export const cloudinaryFolders = {
  products: "cantley/products/images",
  productImages: "cantley/products/images",
  productVideos: "cantley/products/videos",
  categories: "cantley/categories",
  rewardImages: "cantley/rewards/images",
  rewardVideos: "cantley/rewards/videos",
  reviewImages: "cantley/reviews",
  returnProofImages: "cantley/returns/proofs",
  blogImages: "cantley/blog",
  lookbookImages: "cantley/lookbook",
  designs: "cantley/designs",
  designImages: "cantley/designs/images",
  designVideos: "cantley/designs/videos",
  quoteFiles: "cantley/quotes/files"
};

export const resolveCloudinaryFolder = (folderKey = "products") =>
  cloudinaryFolders[folderKey] || cloudinaryFolders.products;
