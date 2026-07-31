import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  serverExternalPackages: [
    "@scalar/api-reference-react",
    "@scalar/api-reference",
    "@scalar/api-client",
    "@scalar/use-codemirror",
    "y-codemirror.next",
    "yjs",
  ],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;