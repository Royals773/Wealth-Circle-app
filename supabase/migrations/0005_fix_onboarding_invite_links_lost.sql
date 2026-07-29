-- WealthCircle — Phase 2 fix: onboarding-time invitation links were lost.
--
-- Bug found during live Phase 2 end-to-end testing: create_group_with_setup()
-- called create_invitation() for each initial invite using `perform`,
-- which discards the function's return value — including raw_token. Since
-- only a hash of the token is ever stored (by design, see
-- docs/security-boundaries.md), throwing away the raw token meant those
-- invitations became permanently unusable: created in the database, but
-- with no way for anyone to ever construct a working link to them.
--
-- Fix: collect each invite's raw_token during the loop and return them
-- all as part of the function's result, so the caller (the onboarding
-- wizard) can show them to the group's creator before navigating away.

-- CREATE OR REPLACE cannot change a function's RETURNS TABLE row type
-- (its return type is defined by implicit OUT parameters), so the old
-- three-column-fewer version must be dropped first.
drop function if exists public.create_group_with_setup(
  text, text, text, text, text, text, text, bigint, smallint, text, jsonb
);

create or replace function public.create_group_with_setup(
  p_name text,
  p_slug text,
  p_description text,
  p_country_code text,
  p_currency_code text,
  p_contribution_frequency text,
  p_contribution_type text,
  p_fixed_amount_minor_units bigint,
  p_financial_year_start_month smallint,
  p_rules text,
  p_invites jsonb
)
returns table (group_id uuid, slug text, invite_links jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_invite jsonb;
  v_invite_result record;
  v_invite_links jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  begin
    insert into public.groups (
      name, slug, description, country_code, currency_code,
      contribution_frequency, contribution_type,
      financial_year_start_month, rules, created_by
    ) values (
      p_name, p_slug, p_description, p_country_code, p_currency_code,
      p_contribution_frequency, p_contribution_type,
      p_financial_year_start_month, p_rules, v_uid
    )
    returning id into v_group_id;
  exception
    when unique_violation then
      raise exception 'That group URL is already taken. Please choose a different one.';
  end;

  -- The groups_after_insert_create_owner_membership trigger has already
  -- fired synchronously at this point, so v_uid is now this group's
  -- owner and passes is_group_manager() for the inserts below.

  if p_contribution_type = 'fixed' and p_fixed_amount_minor_units is not null then
    insert into public.contribution_plans (
      group_id, name, amount_minor_units, currency_code,
      frequency, is_flexible, start_date, created_by
    ) values (
      v_group_id, 'Standard contribution', p_fixed_amount_minor_units, p_currency_code,
      p_contribution_frequency, false, current_date, v_uid
    );
  end if;

  if p_invites is not null then
    for v_invite in select * from jsonb_array_elements(p_invites)
    loop
      select * into v_invite_result from public.create_invitation(
        v_group_id,
        v_invite ->> 'email',
        v_invite ->> 'role'
      );
      v_invite_links := v_invite_links || jsonb_build_object(
        'email', v_invite ->> 'email',
        'role', v_invite ->> 'role',
        'rawToken', v_invite_result.raw_token
      );
    end loop;
  end if;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_group_id, v_uid, 'group_created', 'groups', v_group_id,
    jsonb_build_object('name', p_name, 'slug', p_slug)
  );

  return query select v_group_id, p_slug, v_invite_links;
end;
$$;

grant execute on function public.create_group_with_setup(
  text, text, text, text, text, text, text, bigint, smallint, text, jsonb
) to authenticated;
