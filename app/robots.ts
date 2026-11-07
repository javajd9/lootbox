import type { MetadataRoute } from "next";

// Every page may be indexed; the API routes are for the site and its scheduler, not search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: "https://www.getlootbox.fun/sitemap.xml",
  };
}
