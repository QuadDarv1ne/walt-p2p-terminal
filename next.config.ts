import type { NextConfig } from "next";

/**
 * NEXT_OUTPUT=export → полностью статический экспорт в out/
 * (GitHub Pages, IPFS, любой статический хостинг — без Node-сервера).
 * По умолчанию — standalone-сервер (bun run start).
 */
const isExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  output: isExport ? "export" : "standalone",
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
