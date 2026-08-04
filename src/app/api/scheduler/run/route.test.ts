/**
 * Pure unit test for the scheduler endpoint's bearer-token gate — no
 * live database involved, so this runs as part of the default `npm run
 * test` gate, not tests/security. Only exercises the early-return
 * branches (before any Supabase call is made): isSupabaseConfigured,
 * scheduler-vars-configured, and the SCHEDULER_SECRET comparison
 * itself. The success path (sign-in + RPC calls) is covered by the live
 * walkthrough in docs/phase-9-smoke-test.md instead, since it needs a
 * real Supabase project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORIGINAL_ENV = { ...process.env };

async function freshRoute() {
  vi.resetModules();
  const mod = await import("./route");
  return mod.POST;
}

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/scheduler/run", {
    method: "POST",
    headers,
  });
}

describe("POST /api/scheduler/run — bearer token gate", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "dummy-publishable-key";
    process.env.SCHEDULER_SECRET = "test-only-scheduler-secret-value";
    process.env.SCHEDULER_SUPABASE_EMAIL = "scheduler@example.com";
    process.env.SCHEDULER_SUPABASE_PASSWORD = "dummy-password";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects a request with no Authorization header", async () => {
    const POST = await freshRoute();
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects a request with the wrong bearer token", async () => {
    const POST = await freshRoute();
    const res = await POST(request({ Authorization: "Bearer not-the-real-secret" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects a non-Bearer Authorization scheme even if the value matches", async () => {
    const POST = await freshRoute();
    const res = await POST(request({ Authorization: "test-only-scheduler-secret-value" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when scheduler vars are unset, before ever checking the token", async () => {
    process.env.SCHEDULER_SECRET = "";
    const POST = await freshRoute();
    const res = await POST(request({ Authorization: "Bearer anything" }));
    expect(res.status).toBe(503);
  });

  it("returns 404 when Supabase itself is not configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "";
    const POST = await freshRoute();
    const res = await POST(request({ Authorization: "Bearer test-only-scheduler-secret-value" }));
    expect(res.status).toBe(404);
  });
});
