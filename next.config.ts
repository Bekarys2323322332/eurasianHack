import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker opts into a self-contained server; local demo uses `next start`.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  // Native or browser-driving packages must not be bundled by webpack.
  serverExternalPackages: [
    "better-sqlite3",
    "playwright",
    "@remotion/bundler",
    "@remotion/renderer",
  ],
};

export default nextConfig;
