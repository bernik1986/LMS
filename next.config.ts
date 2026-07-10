import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true
  },
  experimental: {
    cpus: 1,
    workerThreads: false
  },
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
