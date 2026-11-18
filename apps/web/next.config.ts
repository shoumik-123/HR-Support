import type { NextConfig } from "next";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";

const config: NextConfig = {
  reactStrictMode: true,
  // Same-origin proxy to the API so the refresh cookie works without CORS exemptions.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default config;
