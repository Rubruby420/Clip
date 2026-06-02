import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ffmpeg-static", "@prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "10gb" },
  },
  // Include Prisma query-engine binaries in the standalone output so the
  // packaged Electron app doesn't need the full node_modules tree.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/.prisma/client/**"],
  },
};

export default nextConfig;
