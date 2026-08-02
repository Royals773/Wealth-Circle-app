import type { NextConfig } from "next";

/**
 * Phase 9: baseline production security headers. A static, no-nonce CSP
 * was chosen over the nonce-based approach — nonces require setting them
 * per-request in src/proxy.ts and force full dynamic rendering on every
 * matched page, which would cost the (marketing) route group its static
 * optimization for no real benefit, since the app loads no third-party
 * scripts. 'unsafe-inline' on style-src is needed for Tailwind/Next's
 * inline critical CSS; there is no script-src equivalent need since the
 * app ships no inline <script> tags.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
