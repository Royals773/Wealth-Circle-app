-- Phase 9: Postgres-backed rate limiting for the surfaces that
-- currently have no protection of their own — invitation creation
-- (spam risk), the pre-auth invitation-preview/accept flow (an
-- unauthenticated, token-guessing-adjacent surface), and CSV export
-- (scrape/DoS-by-repeated-generation). Supabase Auth's own endpoints
-- (sign-in/sign-up/password reset) already have their own rate limits —
-- opaque to this codebase, but real — and are out of scope here.
--
-- Deliberately Postgres, not Redis/Upstash/similar: right-sized for
-- MVP traffic, introduces no new paid infrastructure, and follows this
-- project's existing "narrowly-scoped SECURITY DEFINER function"
-- pattern instead of an elevated bypass key or a new external service.

create table if not exists public.rate_limit_buckets (
  key text primary key,
  window_start timestamptz not null,
  count integer not null default 0
);

comment on table public.rate_limit_buckets is
  'Fixed-window rate-limit counters. Keys are caller-defined, e.g. invite:<actor_id>:<group_id>, export:<user_id>, preview:<ip>. Only ever accessed through check_rate_limit() below — no direct client access, so no select/insert/update policies are defined even though RLS is enabled.';

alter table public.rate_limit_buckets enable row level security;

-- Fixed-window counter: on each call, reset the window (and count) if
-- the current window has expired, otherwise increment. The unique
-- primary key on `key` makes the insert-or-update atomic per key under
-- concurrent calls — no explicit locking needed.
create or replace function public.check_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_count integer;
begin
  insert into public.rate_limit_buckets (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set count = case
          when public.rate_limit_buckets.window_start <= v_now - make_interval(secs => p_window_seconds)
            then 1
          else public.rate_limit_buckets.count + 1
        end,
        window_start = case
          when public.rate_limit_buckets.window_start <= v_now - make_interval(secs => p_window_seconds)
            then v_now
          else public.rate_limit_buckets.window_start
        end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- Granted to anon as well as authenticated: the pre-auth invitation
-- preview/accept flow needs to rate-limit by IP before any session
-- exists. The function only ever touches this one narrow counter
-- table — it cannot be used to read or write anything else.
grant execute on function public.check_rate_limit(text, integer, integer) to authenticated, anon;
