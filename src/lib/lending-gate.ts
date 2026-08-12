// Lending is disabled pending UK legal/regulatory review — see
// docs/legal-regulatory-review.md and
// supabase/migrations/0021_gate_lending_pending_legal_review.sql, which
// revokes EXECUTE on all 11 loan-lifecycle RPCs from public/anon/authenticated.
//
// This flag is a UX layer only. It is a hardcoded server-side constant, not
// an environment variable, feature-flag service, or anything a client can
// influence — flipping it back on is a code change and a deliberate release
// decision, not something reachable from the browser. The database revoke
// remains the real security boundary regardless of this flag's value.
export const LENDING_DISABLED = true;

export const LENDING_DISABLED_MESSAGE =
  "Lending is temporarily unavailable while we complete a UK legal and regulatory review. This is a deliberate, temporary restriction, not an error — please check back later.";

const GENERIC_LOAN_ERROR_MESSAGE = "Something went wrong. Please try again, and contact support if this continues.";

/** Postgres SQLSTATE for insufficient_privilege — what a REVOKE EXECUTE produces. */
const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * Maps an RPC error from one of the 11 gated loan-lifecycle functions to a
 * safe, user-facing message. Never returns the raw Postgres/PostgREST error
 * text. Permission-denied errors (the expected shape while `0021` is in
 * effect) map to the lending-disabled message; anything else is logged
 * server-side and mapped to a generic message, since only this file's known
 * 11 call sites use this helper, an unexpected error here is a real bug, not
 * routine denial.
 */
export function loanRpcErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return GENERIC_LOAN_ERROR_MESSAGE;
  if (error.code === INSUFFICIENT_PRIVILEGE) return LENDING_DISABLED_MESSAGE;

  console.error("[lending] unexpected loan RPC error", { code: error.code, message: error.message });
  return GENERIC_LOAN_ERROR_MESSAGE;
}
