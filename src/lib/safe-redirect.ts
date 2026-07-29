const DEFAULT_REDIRECT = "/dashboard";

/**
 * Validates a user-supplied redirect target (e.g. a `next` query param)
 * before it's used in a redirect. Only same-origin, relative paths are
 * allowed — anything else (absolute URLs, protocol-relative "//host"
 * URLs, or a path containing "://") falls back to a safe default. This is
 * the only place `next`-style parameters should be trusted from.
 */
export function getSafeRedirect(
  path: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (!path) return fallback;
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (path.includes("://")) return fallback;
  return path;
}
