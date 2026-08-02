/**
 * Minimal structured logging convention (Phase 9). Before this, there
 * was no error-visibility mechanism anywhere in the app — this exists
 * so a future error-reporting vendor (Sentry or similar) has something
 * meaningful to forward once one is chosen and approved; reportError()
 * below is a no-op hook until then, mirroring the exact
 * isSupabaseConfigured/isEmailConfigured graceful-degradation pattern
 * already used twice elsewhere in this codebase.
 *
 * Discipline (this app handles group financial data): never log raw
 * contribution/loan/withdrawal amounts, a full name together with
 * financial history, or any auth token/secret in the same call. Prefer
 * IDs (user id, group id, notification id) over the human-readable
 * details already visible in audit_logs — this is meant to catch
 * "something went wrong," not to duplicate the audit trail.
 */
type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  [key: string]: string | number | boolean | null | undefined;
}

function emit(level: LogLevel, message: string, context?: LogContext) {
  const line = JSON.stringify({
    level,
    message,
    ...(context ? { context } : {}),
    timestamp: new Date().toISOString(),
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => {
    emit("error", message, context);
    reportError(message, context);
  },
};

/**
 * No-op until an error-reporting vendor is chosen and its DSN/config is
 * set (a deliberate, separately-approved decision — see
 * docs/phase-9-deployment-checklist.md). Kept as a single seam so
 * wiring a real vendor later touches only this function.
 */
function reportError(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _message: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context?: LogContext,
): void {
  // Intentionally empty — see doc comment above.
}
