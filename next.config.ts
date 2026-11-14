import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker image (.next/standalone).
  output: "standalone",
  // Native or browser-driving packages must not be bundled by webpack.
  serverExternalPackages: ["better-sqlite3", "playwright"],
};

export default nextConfig;
