-- Round 5 migration: auto-create a profile row when a new auth.users entry is inserted.
--
-- IMPORTANT:
--   * This file MUST be executed manually in the Supabase SQL Editor against the project
--     where the Order Audit System tables live. The application does NOT run migrations
--     automatically.
--   * The trigger below acts as a safety net. The backend AuthService.register code path
--     already creates a matching profiles row via upsert_profile, so the system remains
--     functional even when this migration has not been applied yet. Applying it gives a
--     double guarantee that every auth.users row always has a matching profiles row, and
--     covers edge cases such as users created directly from the Supabase Dashboard.
--   * The default column values here MUST stay aligned with the defaults used inside
--     AuthService.register (backend/app/services/auth_service.py). If you change one,
--     change the other.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_profile_count bigint;
  assigned_role text;
  display_name_value text;
begin
  -- Determine role: the very first registered user becomes admin, everyone else is user.
  select count(*) into existing_profile_count from public.profiles;
  if existing_profile_count = 0 then
    assigned_role := 'admin';
  else
    assigned_role := 'user';
  end if;

  -- Pull a display name from raw_user_meta_data when the backend provided one.
  display_name_value := nullif(
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    ''
  );

  insert into public.profiles (
    id,
    display_name,
    selected_model,
    deep_think_enabled,
    company_affiliates,
    company_affiliates_roles,
    active_custom_rules,
    wizard_completed,
    disclaimer_accepted,
    role,
    created_at,
    updated_at
  ) values (
    new.id,
    display_name_value,
    'gpt-4o',
    false,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    false,
    false,
    assigned_role,
    now(),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();
