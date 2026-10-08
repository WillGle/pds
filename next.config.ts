import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    "/api/scrape/facebook": ["node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
