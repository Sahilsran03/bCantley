import Category from "../models/Category.js";
import Product from "../models/Product.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const escapeXml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const siteUrl = () => (env.clientUrl || "http://localhost:5173").replace(/\/+$/, "");

const urlEntry = ({ loc, lastmod, changefreq = "weekly", priority = "0.7" }) => `
  <url>
    <loc>${escapeXml(loc)}</loc>
    ${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ""}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;

export const getSitemap = asyncHandler(async (req, res) => {
  const baseUrl = siteUrl();
  const [products, categories] = await Promise.all([
    Product.find({ isActive: true }).select("slug updatedAt").sort({ updatedAt: -1 }).limit(5000).lean(),
    Category.find({ isActive: true }).select("slug updatedAt").sort({ sortOrder: 1 }).lean()
  ]);

  const entries = [
    urlEntry({ loc: `${baseUrl}/`, priority: "1.0", changefreq: "daily" }),
    urlEntry({ loc: `${baseUrl}/shop`, priority: "0.9", changefreq: "daily" }),
    ...categories.map((category) =>
      urlEntry({
        loc: `${baseUrl}/shop?category=${category.slug}`,
        lastmod: category.updatedAt,
        priority: "0.8"
      })
    ),
    ...products.map((product) =>
      urlEntry({
        loc: `${baseUrl}/products/${product.slug}`,
        lastmod: product.updatedAt,
        priority: "0.85"
      })
    )
  ];

  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}
</urlset>`);
});

export const getRobots = asyncHandler(async (req, res) => {
  const baseUrl = siteUrl();

  res.type("text/plain").send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /checkout
Disallow: /orders
Disallow: /profile

Sitemap: ${baseUrl}/sitemap.xml
`);
});
