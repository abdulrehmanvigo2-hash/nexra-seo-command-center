import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // No `X-Powered-By: Next.js` (audit A1-01).
  poweredByHeader: false,

  // Security headers on every route (fix F5, audit A1-01; src/lib/security/headers.ts).
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders(process.env.NODE_ENV === "development")] }];
  },
};

export default nextConfig;
