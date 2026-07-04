import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/usamon-rpg" : "",
  assetPrefix: isProd ? "/usamon-rpg/" : "",
  images: { unoptimized: true },
};

export default nextConfig;
