import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "@prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "10gb" },
  },
};

export default nextConfig;
