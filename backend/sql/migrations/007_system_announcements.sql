-- v1.1-B B1: system announcements.
--
-- IMPORTANT:
--   * Execute this file manually in the Supabase SQL Editor.
--   * The application does not run migrations automatically.
--   * Pushing this repository alone does not make this table available online.

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

create table if not exists public.system_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  category text not null default 'feature',
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_announcements_title_not_blank_check
    check (length(btrim(title)) > 0),
  constraint system_announcements_content_not_blank_check
    check (length(btrim(content)) > 0),
  constraint system_announcements_category_check
    check (category in ('platform_rule', 'feature', 'important', 'maintenance', 'other')),
  constraint system_announcements_published_at_check
    check (is_published = false or published_at is not null)
);

create index if not exists system_announcements_published_at_idx
on public.system_announcements (published_at desc);

create index if not exists system_announcements_is_published_idx
on public.system_announcements (is_published);

drop trigger if exists system_announcements_set_updated_at on public.system_announcements;
create trigger system_announcements_set_updated_at
before update on public.system_announcements
for each row execute function public.set_updated_at();

alter table public.system_announcements enable row level security;

drop policy if exists system_announcements_select_published_authenticated on public.system_announcements;
create policy system_announcements_select_published_authenticated
on public.system_announcements
for select
to authenticated
using (is_published = true);

drop policy if exists system_announcements_admin_select_all on public.system_announcements;
create policy system_announcements_admin_select_all
on public.system_announcements
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists system_announcements_admin_insert on public.system_announcements;
create policy system_announcements_admin_insert
on public.system_announcements
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists system_announcements_admin_update on public.system_announcements;
create policy system_announcements_admin_update
on public.system_announcements
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
