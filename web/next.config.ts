import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  env: {
    NEXT_PUBLIC_INGESTOR_URL: process.env.NEXT_PUBLIC_INGESTOR_URL ?? "",
  },
};

export default config;
