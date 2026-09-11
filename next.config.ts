import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security-headers";

const SECURITY_HEADERS = buildSecurityHeaders(process.env.NODE_ENV);

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  experimental: {
    serverActions: {
      // Default is 1MB, which would silently reject any constitution
      // PDF upload over that — this raises the limit to cover the
      // 20MB cap enforced in src/lib/validations/constitution.ts, plus
      // headroom for multipart/form-data overhead (Next's own docs
      // recommend an extra 10-20KB; 1MB of headroom here is deliberately
      // generous, not tuned to the minimum).
      bodySizeLimit: "21mb",
    },
  },
};

export default nextConfig;
