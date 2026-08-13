-- ============================================================
-- MIGRATION: Add study material / PDF resources
-- Run this in Supabase SQL Editor (safe to run once)
-- ============================================================

create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null,
  test_id uuid references tests(id) on delete cascade,  -- optional: link a PDF to a specific test, or leave null for "general"
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table resources enable row level security;

drop policy if exists "resources read" on resources;
create policy "resources read" on resources for select
  using (auth.uid() is not null);

drop policy if exists "resources admin write" on resources;
create policy "resources admin write" on resources for all
  using (is_admin()) with check (is_admin());
