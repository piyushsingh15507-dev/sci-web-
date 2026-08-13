-- ============================================================
-- MIGRATION: Add maintenance mode toggle
-- Run this in Supabase SQL Editor (safe to run once)
-- ============================================================

alter table app_settings add column if not exists maintenance_mode boolean not null default false;
