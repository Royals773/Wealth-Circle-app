import { defineConfig } from "vitest/config";

// A separate config from vitest.config.ts on purpose: this suite makes
// real network calls to a live Supabase project and needs
// SUPABASE_SECRET_KEY, so it must never run as part of the default
// `npm run test` / build gate. See tests/security/README.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/security/**/*.test.ts"],
    setupFiles: ["./tests/security/env-setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
