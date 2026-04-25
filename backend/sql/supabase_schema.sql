-- Supabase schema bootstrap for Order Audit System Neo-Brutalism
-- Round 3 callback: align field names and RLS rules to the original database design.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  selected_model text not null default 'gpt-4o',
  deepseek_api_key text,
  zhipu_api_key text,
  zhipu_ocr_api_key text,
  openai_api_key text,
  deep_think_enabled boolean not null default false,
  company_affiliates jsonb not null default '[]'::jsonb,
  company_affiliates_roles jsonb not null default '[]'::jsonb,
  active_custom_rules jsonb not null default '[]'::jsonb,
  wizard_completed boolean not null default false,
  disclaimer_accepted boolean not null default false,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.industry_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  is_system boolean not null default false,
  user_id uuid references auth.users(id) on delete cascade,
  rules_text text not null,
  company_affiliates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint industry_templates_scope_check check (
    (is_system = true and user_id is null) or
    (is_system = false and user_id is not null)
  )
);

create table if not exists public.audit_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_count integer not null default 0,
  red_count integer not null default 0,
  yellow_count integer not null default 0,
  blue_count integer not null default 0,
  audit_result jsonb not null default '{}'::jsonb,
  model_used text not null,
  custom_rules_snapshot jsonb not null default '[]'::jsonb,
  deep_think_used boolean not null default false,
  task_id text,
  report_paths jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_text text not null,
  prompt_text text not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists industry_templates_set_updated_at on public.industry_templates;
create trigger industry_templates_set_updated_at
before update on public.industry_templates
for each row execute function public.set_updated_at();

drop trigger if exists audit_history_set_updated_at on public.audit_history;
create trigger audit_history_set_updated_at
before update on public.audit_history
for each row execute function public.set_updated_at();

drop trigger if exists system_rules_set_updated_at on public.system_rules;
create trigger system_rules_set_updated_at
before update on public.system_rules
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.industry_templates enable row level security;
alter table public.audit_history enable row level security;
alter table public.system_rules enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists industry_templates_select_scope on public.industry_templates;
create policy industry_templates_select_scope
on public.industry_templates
for select
to authenticated
using (is_system = true or user_id = auth.uid());

drop policy if exists industry_templates_insert_own on public.industry_templates;
create policy industry_templates_insert_own
on public.industry_templates
for insert
to authenticated
with check (is_system = false and user_id = auth.uid());

drop policy if exists industry_templates_update_own on public.industry_templates;
create policy industry_templates_update_own
on public.industry_templates
for update
to authenticated
using (is_system = false and user_id = auth.uid())
with check (is_system = false and user_id = auth.uid());

drop policy if exists industry_templates_delete_own on public.industry_templates;
create policy industry_templates_delete_own
on public.industry_templates
for delete
to authenticated
using (is_system = false and user_id = auth.uid());

drop policy if exists industry_templates_admin_update_system on public.industry_templates;
create policy industry_templates_admin_update_system
on public.industry_templates
for update
to authenticated
using (
  is_system = true and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
)
with check (
  is_system = true and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists industry_templates_admin_insert_system on public.industry_templates;
create policy industry_templates_admin_insert_system
on public.industry_templates
for insert
to authenticated
with check (
  is_system = true and user_id is null and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists industry_templates_admin_delete_system on public.industry_templates;
create policy industry_templates_admin_delete_system
on public.industry_templates
for delete
to authenticated
using (
  is_system = true and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists audit_history_select_own on public.audit_history;
create policy audit_history_select_own
on public.audit_history
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists audit_history_insert_own on public.audit_history;
create policy audit_history_insert_own
on public.audit_history
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists audit_history_update_own on public.audit_history;
create policy audit_history_update_own
on public.audit_history
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists system_rules_select_authenticated on public.system_rules;
create policy system_rules_select_authenticated
on public.system_rules
for select
to authenticated
using (true);

drop policy if exists system_rules_admin_update on public.system_rules;
create policy system_rules_admin_update
on public.system_rules
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);
