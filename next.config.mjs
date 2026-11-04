import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";

// Docs pages are .mdx files under app/docs; remark-gfm adds tables.
const withMDX = createMDX({ options: { remarkPlugins: [remarkGfm] } });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ["ts", "tsx", "mdx"],
  experimental: {
    // Reclaim's zkFetch (order proofs) ships native binaries, so it's loaded from node_modules at
    // run time instead of bundled. Only the Linux x64 build runs on Vercel; the rest stays out.
    serverComponentsExternalPackages: ["@reclaimprotocol/zk-fetch", "@reclaimprotocol/attestor-core", "@reclaimprotocol/js-sdk", "koffi"],
    outputFileTracingExcludes: {
      "*": ["node_modules/@reclaimprotocol/zk-fetch/lib/darwin/**", "node_modules/@reclaimprotocol/zk-fetch/lib/linux/arm64/**"],
    },
  },
  async redirects() {
    return [{ source: "/how-it-works", destination: "/docs", permanent: true }];
  },
};

export default withMDX(nextConfig);
