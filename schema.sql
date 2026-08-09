-- ============================================================
-- TEST PORTAL DATABASE SCHEMA  (v2 — secure)
-- Run this whole file once in Supabase SQL Editor (Run button)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE everywhere.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. PROFILES ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz default now()
);

-- ---------- 2. APP SETTINGS (changeable signup passcode) ----------
create table if not exists app_settings (
  id int primary key default 1,
  signup_passcode text not null default 'CHANGE_ME_123',
  constraint single_row check (id = 1)
);
insert into app_settings (id, signup_passcode)
  values (1, 'CHANGE_ME_123')
  on conflict (id) do nothing;

-- ---------- 3. TESTS ----------
create table if not exists tests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_ms bigint not null default 10800000,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ---------- 4. SECTIONS ----------
create table if not exists sections (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  name text not null,
  order_no int not null default 1,
  section_marks numeric not null default 0
);

-- ---------- 5. QUESTIONS ----------
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  image_url text,
  order_no int not null default 1,
  positive_marks numeric not null default 4,
  negative_marks numeric not null default 1,
  solution_image_url text
);

-- ---------- 6. OPTIONS ----------
create table if not exists options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  label text not null,
  image_url text,
  is_correct boolean not null default false,
  order_no int not null default 1
);

-- ---------- 7. RESULTS ----------
create table if not exists results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  test_id uuid not null references tests(id) on delete cascade,
  total_score numeric not null,
  total_correct int not null,
  total_incorrect int not null,
  total_unattempted int not null,
  time_taken_ms bigint not null,
  detail jsonb not null,
  submitted_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table app_settings enable row level security;
alter table tests enable row level security;
alter table sections enable row level security;
alter table questions enable row level security;
alter table options enable row level security;
alter table results enable row level security;

create or replace function is_admin() returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer;

-- profiles
drop policy if exists "own profile select" on profiles;
create policy "own profile select" on profiles for select using (id = auth.uid() or is_admin());
drop policy if exists "own profile update" on profiles;
create policy "own profile update" on profiles for update using (id = auth.uid());
drop policy if exists "own profile insert" on profiles;
create policy "own profile insert" on profiles for insert with check (id = auth.uid());

-- app_settings — readable by anyone (needed at signup screen before login)
drop policy if exists "settings read all" on app_settings;
create policy "settings read all" on app_settings for select using (true);
drop policy if exists "settings admin update" on app_settings;
create policy "settings admin update" on app_settings for update using (is_admin());

-- tests / sections — safe to expose (no answers here)
drop policy if exists "tests read" on tests;
create policy "tests read" on tests for select using (auth.uid() is not null);
drop policy if exists "tests admin write" on tests;
create policy "tests admin write" on tests for all using (is_admin()) with check (is_admin());

drop policy if exists "sections read" on sections;
create policy "sections read" on sections for select using (auth.uid() is not null);
drop policy if exists "sections admin write" on sections;
create policy "sections admin write" on sections for all using (is_admin()) with check (is_admin());

-- questions / options base tables — ADMIN ONLY (students never query these directly,
-- they use the *_for_student views below which hide is_correct / solution_image_url)
drop policy if exists "questions admin all" on questions;
create policy "questions admin all" on questions for all using (is_admin()) with check (is_admin());
drop policy if exists "options admin all" on options;
create policy "options admin all" on options for all using (is_admin()) with check (is_admin());

-- results
drop policy if exists "results own insert" on results;
create policy "results own insert" on results for insert with check (user_id = auth.uid());
drop policy if exists "results own select" on results;
create policy "results own select" on results for select using (user_id = auth.uid() or is_admin());

-- ============================================================
-- STUDENT-SAFE VIEWS (no correct-answer / no solution image)
-- ============================================================
create or replace view questions_for_student as
  select id, section_id, image_url, order_no, positive_marks, negative_marks
  from questions;

create or replace view options_for_student as
  select id, question_id, label, image_url, order_no
  from options;

revoke all on questions_for_student from public, anon;
revoke all on options_for_student from public, anon;
grant select on questions_for_student to authenticated;
grant select on options_for_student to authenticated;

-- ============================================================
-- SECURE SERVER-SIDE GRADING  (correct answers revealed only here,
-- only after the student submits — this is what keeps solutions hidden
-- during the test and shown only in the result)
-- ============================================================
create or replace function submit_attempt(
  p_test_id uuid,
  p_answers jsonb,        -- { "<question_id>": "<chosen_option_id>", ... }
  p_time_taken_ms bigint
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_detail jsonb := '[]'::jsonb;
  v_total_score numeric := 0;
  v_correct int := 0;
  v_incorrect int := 0;
  v_unattempted int := 0;
  q record;
  v_chosen_id text;
  v_chosen_is_correct boolean;
  v_correct_opt_id uuid;
  v_gained numeric;
  v_outcome text;
  v_result_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  for q in
    select qu.id, qu.section_id, se.name as section_name, qu.positive_marks,
           qu.negative_marks, qu.solution_image_url
    from questions qu
    join sections se on se.id = qu.section_id
    where se.test_id = p_test_id
    order by se.order_no, qu.order_no
  loop
    v_chosen_id := p_answers->>(q.id::text);

    select id into v_correct_opt_id from options
      where question_id = q.id and is_correct = true limit 1;

    if v_chosen_id is null or v_chosen_id = '' then
      v_outcome := 'unattempted';
      v_gained := 0;
      v_unattempted := v_unattempted + 1;
    else
      select is_correct into v_chosen_is_correct from options where id = v_chosen_id::uuid;
      if coalesce(v_chosen_is_correct, false) then
        v_outcome := 'correct';
        v_gained := q.positive_marks;
        v_correct := v_correct + 1;
      else
        v_outcome := 'incorrect';
        v_gained := -q.negative_marks;
        v_incorrect := v_incorrect + 1;
      end if;
    end if;

    v_total_score := v_total_score + v_gained;

    v_detail := v_detail || jsonb_build_object(
      'question_id', q.id,
      'section_name', q.section_name,
      'chosen_option_id', v_chosen_id,
      'correct_option_id', v_correct_opt_id,
      'outcome', v_outcome,
      'gained', v_gained,
      'solution_image_url', q.solution_image_url
    );
  end loop;

  insert into results (user_id, test_id, total_score, total_correct, total_incorrect,
                        total_unattempted, time_taken_ms, detail)
  values (auth.uid(), p_test_id, v_total_score, v_correct, v_incorrect,
          v_unattempted, p_time_taken_ms, v_detail)
  returning id into v_result_id;

  return jsonb_build_object(
    'result_id', v_result_id,
    'total_score', v_total_score,
    'total_correct', v_correct,
    'total_incorrect', v_incorrect,
    'total_unattempted', v_unattempted,
    'time_taken_ms', p_time_taken_ms,
    'detail', v_detail
  );
end;
$$;

grant execute on function submit_attempt(uuid, jsonb, bigint) to authenticated;

-- ============================================================
-- STORAGE BUCKET for self-hosted images (question / option / solution)
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('test-images', 'test-images', true)
  on conflict (id) do nothing;

drop policy if exists "public read test-images" on storage.objects;
create policy "public read test-images" on storage.objects
  for select using (bucket_id = 'test-images');

drop policy if exists "admin upload test-images" on storage.objects;
create policy "admin upload test-images" on storage.objects
  for insert with check (bucket_id = 'test-images' and is_admin());

drop policy if exists "admin update test-images" on storage.objects;
create policy "admin update test-images" on storage.objects
  for update using (bucket_id = 'test-images' and is_admin());

drop policy if exists "admin delete test-images" on storage.objects;
create policy "admin delete test-images" on storage.objects
  for delete using (bucket_id = 'test-images' and is_admin());

-- ============================================================
-- AFTER RUNNING THIS FILE:
-- 1. Authentication > Providers > make sure "Email" is ON.
-- 2. Authentication > Settings > you can turn OFF "Confirm email"
--    for easier testing (students won't need to click an email link).
-- 3. Sign up your first account through the app (as a normal student),
--    then come back here and run this ONE line (with your real email)
--    to promote yourself to admin:
--
--    update profiles set role = 'admin' where email = 'youradmin@email.com';
-- ============================================================
