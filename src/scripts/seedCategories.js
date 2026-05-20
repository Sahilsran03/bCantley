import { connectDatabase } from "../config/db.js";
import Category from "../models/Category.js";

const categories = [
  {
    name: "T-shirts",
    slug: "t-shirts",
    description: "Everyday Cantley T-shirts ready for custom prints.",
    sortOrder: 10
  },
  {
    name: "Oversized T-shirts",
    slug: "oversized-t-shirts",
    description: "Relaxed-fit oversized T-shirts for bold streetwear looks.",
    sortOrder: 20
  },
  {
    name: "Hoodies",
    slug: "hoodies",
    description: "Comfortable hoodies for premium printed apparel.",
    sortOrder: 30
  }
];

await connectDatabase();

for (const category of categories) {
  await Category.findOneAndUpdate(
    { slug: category.slug },
    { ...category, isActive: true },
    { new: true, upsert: true, runValidators: true }
  );
}

console.log("Cantley clothing categories seeded.");
process.exit(0);
