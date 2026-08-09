# Bootstrapping the first platform administrator

`platform_admins` (added in `supabase/migrations/0024_phase10_platform_authorisation.sql`)
has Row Level Security enabled and **zero policies** — no client role
(anon, authenticated, or even an existing platform admin) can select,
insert, update, or delete this table. The only read path is
`is_platform_admin()`, which answers a single boolean about the calling
user and exposes nothing else.

This is deliberate: no UUID is ever hard-coded in a migration, and no
app code path can grant this role to anyone, including itself. Granting
it is an out-of-band, one-off action per environment, performed
directly against the database by the project owner — the same pattern
already used for `scheduler_capabilities`
(`0018_phase9_scheduler_email_capability.sql`).

## Steps

1. Apply `0024_phase10_platform_authorisation.sql` (see the migration's
   own header comment for the recommended small-pieces application
   order).
2. In the Supabase Dashboard SQL Editor for the target project, find
   the `auth.users.id` for the account that should become the first
   platform administrator:

   ```sql
   select id, email from auth.users where email = 'the-admin@example.com';
   ```

3. Insert that id directly:

   ```sql
   insert into public.platform_admins (user_id, notes)
   values ('<uuid-from-step-2>', 'Initial platform administrator, bootstrapped <date>');
   ```

4. Verify:

   ```sql
   select pa.user_id, p.email, pa.granted_at
   from public.platform_admins pa
   join public.profiles p on p.id = pa.user_id;
   ```

That account can now sign in and use `/platform-admin` to review
groups and organiser applications, and to grant further admins the
same way (steps 2–3, run by an existing admin or the project owner —
there is no in-app "invite another platform admin" flow, by design).

## Revoking access

```sql
delete from public.platform_admins where user_id = '<uuid>';
```

Takes effect immediately — `is_platform_admin()` reads the table live
on every call, no caching, no token-refresh delay.
