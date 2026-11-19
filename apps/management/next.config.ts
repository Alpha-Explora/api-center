import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  async redirects() {
    return [
      { source: "/control-plane/projects", destination: "/projects", permanent: false },
      { source: "/control-plane/projects/:projectId", destination: "/projects/:projectId/test", permanent: false },
      { source: "/control-plane/people", destination: "/people", permanent: false },
      { source: "/projects/:projectId", destination: "/projects/:projectId/test", permanent: false },
    ];
  },
};

export default nextConfig;
