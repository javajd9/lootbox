import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";

// Docs pages are .mdx files under app/docs; remark-gfm adds tables.
const withMDX = createMDX({ options: { remarkPlugins: [remarkGfm] } });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ["ts", "tsx", "mdx"],
  async redirects() {
    return [{ source: "/how-it-works", destination: "/docs", permanent: true }];
  },
};

export default withMDX(nextConfig);
