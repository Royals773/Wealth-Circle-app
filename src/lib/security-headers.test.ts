import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers";

function findHeader(headers: ReturnType<typeof buildSecurityHeaders>, key: string) {
  return headers.find((header) => header.key === key);
}

describe("buildSecurityHeaders", () => {
  describe("development", () => {
    const headers = buildSecurityHeaders("development");

    it("excludes upgrade-insecure-requests from the CSP", () => {
      const csp = findHeader(headers, "Content-Security-Policy");
      expect(csp?.value).not.toContain("upgrade-insecure-requests");
    });

    it("excludes the Strict-Transport-Security header", () => {
      expect(findHeader(headers, "Strict-Transport-Security")).toBeUndefined();
    });
  });

  describe("production", () => {
    const headers = buildSecurityHeaders("production");

    it("includes upgrade-insecure-requests in the CSP", () => {
      const csp = findHeader(headers, "Content-Security-Policy");
      expect(csp?.value).toContain("upgrade-insecure-requests");
    });

    it("includes the Strict-Transport-Security header", () => {
      expect(findHeader(headers, "Strict-Transport-Security")?.value).toBe(
        "max-age=63072000; includeSubDomains; preload",
      );
    });
  });

  describe.each([["development"], ["production"], [undefined]])("shared headers (env=%s)", (env) => {
    const headers = buildSecurityHeaders(env);

    it("keeps script-src and style-src 'unsafe-inline' in the CSP", () => {
      const csp = findHeader(headers, "Content-Security-Policy");
      expect(csp?.value).toContain("script-src 'self' 'unsafe-inline'");
      expect(csp?.value).toContain("style-src 'self' 'unsafe-inline'");
    });

    it("keeps the other baseline CSP directives", () => {
      const csp = findHeader(headers, "Content-Security-Policy");
      expect(csp?.value).toContain("default-src 'self'");
      expect(csp?.value).toContain("img-src 'self' data:");
      expect(csp?.value).toContain("font-src 'self'");
      expect(csp?.value).toContain("object-src 'none'");
      expect(csp?.value).toContain("base-uri 'self'");
      expect(csp?.value).toContain("form-action 'self'");
      expect(csp?.value).toContain("frame-ancestors 'none'");
    });

    it("keeps the non-HTTPS-enforcement security headers", () => {
      expect(findHeader(headers, "X-Content-Type-Options")?.value).toBe("nosniff");
      expect(findHeader(headers, "X-Frame-Options")?.value).toBe("DENY");
      expect(findHeader(headers, "Referrer-Policy")?.value).toBe("strict-origin-when-cross-origin");
      expect(findHeader(headers, "Permissions-Policy")?.value).toBe(
        "camera=(), microphone=(), geolocation=(), payment=()",
      );
    });
  });
});
