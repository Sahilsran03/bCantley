const allowedTags = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "div",
  "em",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "span",
  "strong",
  "ul"
]);

const sanitizeAttributes = (tag, attributes = "") => {
  if (tag !== "a") return "";

  const hrefMatch = attributes.match(/\shref\s*=\s*["']([^"']+)["']/i);
  const href = hrefMatch?.[1]?.trim() || "";

  if (!href || /^(javascript|data):/i.test(href)) return "";

  return ` href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noreferrer"`;
};

export const sanitizeHtml = (value) =>
  String(value || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, (match, rawTag, attributes) => {
      const tag = rawTag.toLowerCase();
      if (!allowedTags.has(tag)) return "";
      if (match.startsWith("</")) return `</${tag}>`;
      return `<${tag}${sanitizeAttributes(tag, attributes)}>`;
    });
