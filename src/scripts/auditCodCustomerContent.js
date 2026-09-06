import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import Page from "../models/Page.js";
import Policy from "../models/Policy.js";

mongoose.set("autoIndex", false);
await connectDatabase();

const stalePattern = /(20\s*%|₹\s*100|Rs\.?\s*100|manual\s+advance|advance\s+confirmation|team\s+will\s+contact)/i;

try {
  const [policies, pages] = await Promise.all([
    Policy.find({ type: { $in: ["COD_POLICY", "FAQ"] } }).select("type title content isPublished").lean(),
    Page.find().select("slug title content metaDescription isPublished").lean()
  ]);
  const matches = [];

  for (const record of [...policies.map((value) => ({ collection: "policies", value })), ...pages.map((value) => ({ collection: "pages", value }))]) {
    const searchable = [record.value.title, record.value.content, record.value.metaDescription].filter(Boolean).join("\n");
    const match = searchable.match(stalePattern);
    if (match) {
      matches.push({
        collection: record.collection,
        id: record.value._id,
        typeOrSlug: record.value.type || record.value.slug,
        title: record.value.title,
        isPublished: record.value.isPublished,
        matchedText: match[0],
        suggestedManualAction: "Review and update this customer-facing content in Admin."
      });
    }
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, count: matches.length, matches }, null, 2));
} finally {
  await mongoose.disconnect();
}
