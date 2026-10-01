-- ============================================================
-- Documents module
-- Creates the documents table + public storage bucket used by
-- the Documents page (admin-documents.js) and the admin sidebar.
--
-- Run this ONCE in the Supabase SQL Editor.
-- Requires storage schema (present on every Supabase project).
-- ============================================================

create extension if not exists "uuid-ossp";

create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  category text not null default 'Other',
  file_name text not null,
  file_type text not null default '',
  file_size bigint not null default 0,
  storage_path text not null,
  learner_id uuid references learners(id) on delete set null,
  uploaded_by uuid,
  uploaded_by_name text not null default '',
  created_at timestamptz not null default now()
);

alter table documents enable row level security;

create policy "Documents are readable by all authenticated users"
  on documents for select
  to authenticated
  using (true);

create policy "Documents can be inserted by authenticated users"
  on documents for insert
  to authenticated
  with check (true);

create policy "Documents can be deleted by authenticated users"
  on documents for delete
  to authenticated
  using (true);

-- Public read-only bucket for file download links (getPublicUrl).
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do update set public = true;