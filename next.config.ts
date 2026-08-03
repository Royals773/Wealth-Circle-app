import type { NextConfig } from "next";

/**
 * Phase 9: baseline production security headers. A static, no-nonce CSP
 * was chosen over the nonce-based approach — nonces require setting them
 * per-request in src/proxy.ts and force full dynamic rendering on every
 * matched page, which would cost the (marketing) route group its static
 * optimization for no real benefit, since the app loads no third-party
 * scripts.
 *
 * script-src MUST include 'unsafe-inline', not just style-src — this
 * was a real bug in an earlier version of this file, found via a full
 * click-through of the deployed staging site: Next.js's own framework
 * bootstrap (RSC payload streaming, hydration data) injects inline
 * <script> tags on every page load, regardless of app code. Without
 * 'unsafe-inline' here, the browser blocked those scripts outright,
 * breaking React hydration app-wide — every client component
 * (including basic Radix UI form controls) silently stopped responding
 * to any interaction, with no build-time signal that anything was
 * wrong. This is Next.js's own documented default for apps not using
 * nonces (see node_modules/next/dist/docs/.../content-security-policy.md,
 * "Without Nonces" section) — nonce-based or experimental SRI-based CSP
 * remain available as stricter future upgrades if ever wanted, at the
 * cost of forcing dynamic rendering (nonces) or App-Router-only,
 * experimental status (SRI).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
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
