-- Gates the entire loan lifecycle at the RPC layer, pending the UK
-- legal/regulatory review recorded in docs/legal-regulatory-review.md
-- and the decision in docs/phase-10-planning.md ("Decision 1 —
-- Lending stays disabled pending legal review"): lending functionality
-- would be technically disabled by a feature flag, off by default,
-- enforced at the database layer so it holds even against a direct
-- API call — not just hidden in the UI. That flag was designed but
-- never implemented before this migration; it was found to still be
-- fully live and callable during a public-launch attempt on
-- 2026-08-06, before any real UK legal opinion had been obtained.
--
-- Mechanism: revoke EXECUTE on every mutating loan-lifecycle function
-- from every role that could otherwise call it. Nothing is deleted,
-- dropped, or rewritten — every function body is untouched, so
-- re-enabling lending later is a single, reversible step: re-run the
-- matching `grant execute ... to authenticated;` statement for each
-- function once the legal review is resolved and recorded. Table RLS,
-- existing data, and audit history are all unaffected. Loan product
-- configuration (upsert_loan_product) is deliberately NOT gated here
-- — defining a product template moves no money and isn't part of the
-- reviewed scope; only the functions that actually apply for, decide,
-- disburse, or repay a real loan are gated.

revoke execute on function public.apply_for_loan(uuid, bigint, integer, text) from public, anon, authenticated;
revoke execute on function public.mark_loan_under_review(uuid) from public, anon, authenticated;
revoke execute on function public.decide_loan_application(uuid, text, bigint, integer, integer, text, text) from public, anon, authenticated;
revoke execute on function public.cancel_loan_application(uuid) from public, anon, authenticated;
revoke execute on function public.record_disbursement(uuid, date, text, text) from public, anon, authenticated;
revoke execute on function public.mark_loan_defaulted(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_repayment(uuid, bigint, date, text, text, text) from public, anon, authenticated;
revoke execute on function public.verify_repayment(uuid) from public, anon, authenticated;
revoke execute on function public.reconcile_repayment(uuid) from public, anon, authenticated;
revoke execute on function public.reject_repayment(uuid, text) from public, anon, authenticated;
revoke execute on function public.reverse_repayment(uuid, text, jsonb) from public, anon, authenticated;
