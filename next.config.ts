import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure tribe JSON + catalog are included in Vercel serverless bundles (dynamic fs reads).
  outputFileTracingIncludes: {
    "/api/catalog": ["./src/data/**/*"],
    "/api/tribe/[id]": ["./src/data/**/*"],
    "/api/run": ["./src/data/**/*"],
    "/api/benchmark": ["./src/data/**/*"],
    "/api/analyze": ["./src/data/**/*"],
    "/api/prompt-context": ["./src/data/**/*"],
    "/api/history-context": ["./src/data/**/*"],
  },
};

export default nextConfig;
