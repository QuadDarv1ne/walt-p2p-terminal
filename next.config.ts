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
  // проверка типов при сборке включена: ошибки типов должны ломать билд,
  // а не попадать в артефакт (см. npm run build)
  reactStrictMode: false,
};

export default nextConfig;
