import fs from "node:fs";
import path from "node:path";

// Vitest doesn't load .env.local automatically (that's a Next.js-specific
// behavior). This reads it manually, without ever logging its contents,
// so the live security suite can reach the real Supabase project.
const envPath = path.resolve(__dirname, "../../.env.local");

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}
