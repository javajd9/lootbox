import type { MetadataRoute } from "next";
import { DOCS_NAV } from "@/lib/config/docs-nav";

const SITE = "https://www.getlootbox.fun";

// The site's own pages and every docs page, in the docs sidebar's order.
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/proof", "/claim", ...DOCS_NAV.flatMap((g) => g.pages.map((p) => p.href))];
  return [...new Set(paths)].map((path) => ({ url: `${SITE}${path === "/" ? "" : path}` }));
}
