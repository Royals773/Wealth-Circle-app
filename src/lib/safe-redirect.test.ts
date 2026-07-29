import { describe, expect, it } from "vitest";
import { getSafeRedirect } from "./safe-redirect";

describe("getSafeRedirect", () => {
  it("allows a plain relative path", () => {
    expect(getSafeRedirect("/dashboard/some-group")).toBe("/dashboard/some-group");
  });

  it("falls back for null, undefined or empty input", () => {
    expect(getSafeRedirect(null)).toBe("/dashboard");
    expect(getSafeRedirect(undefined)).toBe("/dashboard");
    expect(getSafeRedirect("")).toBe("/dashboard");
  });

  it("respects a custom fallback", () => {
    expect(getSafeRedirect(null, "/onboarding")).toBe("/onboarding");
  });

  it("rejects absolute URLs", () => {
    expect(getSafeRedirect("https://evil.example.com")).toBe("/dashboard");
    expect(getSafeRedirect("http://evil.example.com/path")).toBe("/dashboard");
  });

  it("rejects protocol-relative URLs", () => {
    expect(getSafeRedirect("//evil.example.com")).toBe("/dashboard");
  });

  it("rejects a path that doesn't start with a single slash", () => {
    expect(getSafeRedirect("evil.example.com")).toBe("/dashboard");
    expect(getSafeRedirect("javascript:alert(1)")).toBe("/dashboard");
  });

  it("rejects any path containing a scheme separator, even nested in a query string", () => {
    expect(getSafeRedirect("/redirect?to=https://evil.example.com")).toBe("/dashboard");
    expect(getSafeRedirect("/../../https://evil.example.com")).toBe("/dashboard");
  });
});
