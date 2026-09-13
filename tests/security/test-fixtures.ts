import { randomInt } from "node:crypto";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALPHABET = LOWER + UPPER + DIGITS + SYMBOLS;
const LENGTH = 24;

/**
 * Generates a fresh, cryptographically random password for a throwaway
 * live-security-test account (see tests/security/README.md) — never
 * reused across accounts or test runs, never hardcoded. Satisfies
 * Supabase's strictest documented `password_requirements` option
 * (`lower_upper_letters_digits_symbols`) and comfortably exceeds
 * `minimum_password_length`, regardless of which of the four
 * requirement levels is actually enforced on the target project (see
 * supabase/config.toml's [auth] section) — guarantees at least one
 * character from each class, then fills and shuffles the rest with
 * `crypto.randomInt` so the guaranteed characters aren't predictably
 * placed at the front.
 */
export function generateTestPassword(): string {
  const guaranteed = [LOWER, UPPER, DIGITS, SYMBOLS].map(
    (set) => set[randomInt(set.length)],
  );
  const rest = Array.from(
    { length: LENGTH - guaranteed.length },
    () => ALPHABET[randomInt(ALPHABET.length)],
  );
  const chars = [...guaranteed, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
