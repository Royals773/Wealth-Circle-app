import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export interface RateLimitOptions {
  key: string;
  windowSeconds: number;
  max: number;
}

/**
 * Postgres-backed rate limiter (see check_rate_limit() in
 * supabase/migrations/0017_phase9_rate_limiting.sql). Fails OPEN by
 * default on any unexpected error — availability matters more than a
 * missed check for most of this app's gated actions. Pass
 * failClosed: true for the one surface where that trade-off should
 * flip (invitation-preview token-guessing) — but even then, a
 * "function does not exist" response (PGRST202, meaning migration 0017
 * hasn't been applied to this environment yet) always fails open,
 * since that's a deployment-state gap, not a hostile signal.
 */
export async function checkRateLimit(
  { key, windowSeconds, max }: RateLimitOptions,
  options: { failClosed?: boolean } = {},
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) {
      if (error.code === "PGRST202") return true;
      logger.warn("Rate-limit check failed, falling back to configured default", { key, failOpen: !options.failClosed });
      return !options.failClosed;
    }
    return data === true;
  } catch {
    logger.warn("Rate-limit check threw, falling back to configured default", { key, failOpen: !options.failClosed });
    return !options.failClosed;
  }
}
