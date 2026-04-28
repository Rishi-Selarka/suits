-- =============================================================================
-- Suits AI — Supabase schema
--
-- HOW TO USE
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this entire file and click "Run".
--   3. It is safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).
--
-- WHAT THIS CREATES
--   • profiles          — app-specific user fields, linked 1:1 to auth.users
--   • documents         — replaces data/metadata/*.json
--   • analysis_results  — replaces data/results/*.json (stored as jsonb)
--   • usage             — per-user analysis events (for quota)
--   • payments          — per-user payment records
--   • Row Level Security on all of the above
--   • Storage policies for a "documents" bucket (create the bucket in the UI)
--   • Trigger that auto-creates a profile row on signup
--
-- SECURITY MODEL
--   Every row is scoped by user_id = auth.uid(). The frontend calls Supabase
--   directly with the anon key; RLS enforces isolation. The backend uses the
--   service_role key which bypasses RLS — it must always filter by user_id
--   after verifying the JWT.
-- =============================================================================


-- ── 1. Profiles ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null default '',
  email           text,
  role            text not null default 'individual'
                  check (role in ('individual','lawyer','business','student')),
  organization    text not null default '',
  use_case        text not null default '',
  jurisdiction    text not null default 'India',
  plan            text not null default 'free'
                  check (plan in ('free','starter','pro','unlimited')),
  documents_used  integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Idempotent: existing profile tables (created before email was added)
-- pick up the new column on re-run.
alter table public.profiles add column if not exists email text;


-- ── 2. Documents ────────────────────────────────────────────────────────────
create table if not exists public.documents (
  id              text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  filename        text not null,
  sha256          text not null,
  page_count      integer not null default 0,
  clause_count    integer not null default 0,
  file_size_bytes integer not null default 0,
  content_type    text not null default '',
  status          text not null default 'uploaded'
                  check (status in ('uploaded','processing','complete','error')),
  storage_path    text not null default '',
  created_at      timestamptz not null default now()
);

create index if not exists documents_user_id_created_idx
  on public.documents (user_id, created_at desc);

-- Per-user deduplication on sha256 (same user uploading same file = same doc)
create unique index if not exists documents_user_sha256_uniq
  on public.documents (user_id, sha256);


-- ── 3. Analysis results ─────────────────────────────────────────────────────
-- Store the full AnalysisResult Pydantic model as jsonb to avoid normalising
-- a deeply nested schema. Read it back with AnalysisResult.model_validate().
create table if not exists public.analysis_results (
  document_id  text primary key references public.documents(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  result       jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists analysis_results_user_id_idx
  on public.analysis_results (user_id);


-- ── 4. Clauses (intermediate — used by RAG) ─────────────────────────────────
create table if not exists public.document_clauses (
  document_id  text primary key references public.documents(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  clauses      jsonb not null,
  created_at   timestamptz not null default now()
);


-- ── 5. Usage tracking ───────────────────────────────────────────────────────
create table if not exists public.usage (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  document_id  text not null,
  action       text not null default 'analyze',
  created_at   timestamptz not null default now()
);

create index if not exists usage_user_id_created_idx
  on public.usage (user_id, created_at desc);


-- ── 6. Payments ─────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  razorpay_order_id   text,
  razorpay_payment_id text,
  amount_paise        integer not null,
  currency            text not null default 'INR',
  plan                text not null,
  status              text not null default 'created'
                      check (status in ('created','paid','failed','refunded')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists payments_user_id_idx
  on public.payments (user_id, created_at desc);


-- ── 7. Auto-create profile on signup ────────────────────────────────────────
-- When a new auth.users row is inserted (signup), mirror a profiles row.
-- `raw_user_meta_data` is populated from the `options.data` object passed to
-- supabase.auth.signUp() on the client.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'New User'),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email
    where public.profiles.email is distinct from excluded.email;
  return new;
end;
$$;

-- Keep email in sync if the user changes it via Supabase auth later.
create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_user_email();

-- One-shot backfill of email for profiles that were created before the
-- column existed. Idempotent: only fills NULLs.
update public.profiles p
   set email = u.email
  from auth.users u
 where p.id = u.id
   and p.email is null
   and u.email is not null;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 8. Increment usage RPC (atomic) ─────────────────────────────────────────
-- Called by the backend after a successful analysis.
create or replace function public.increment_documents_used(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set documents_used = documents_used + 1,
         updated_at = now()
   where id = uid;
end;
$$;


-- ── 9. Updated_at trigger helper ────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists analysis_results_set_updated_at on public.analysis_results;
create trigger analysis_results_set_updated_at
  before update on public.analysis_results
  for each row execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();


-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.profiles          enable row level security;
alter table public.documents         enable row level security;
alter table public.analysis_results  enable row level security;
alter table public.document_clauses  enable row level security;
alter table public.usage             enable row level security;
alter table public.payments          enable row level security;


-- Profiles: user can read and update their own profile only.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- We deliberately do NOT expose INSERT/DELETE on profiles to end users —
-- the signup trigger handles inserts; deletes cascade from auth.users.


-- Documents: full CRUD on your own rows.
drop policy if exists "documents_own" on public.documents;
create policy "documents_own" on public.documents
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- Analysis results: full CRUD on your own rows.
drop policy if exists "analysis_results_own" on public.analysis_results;
create policy "analysis_results_own" on public.analysis_results
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- Document clauses: full CRUD on your own rows.
drop policy if exists "document_clauses_own" on public.document_clauses;
create policy "document_clauses_own" on public.document_clauses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- Usage: user can read their own rows; inserts happen from the backend
-- using the service_role key, so no INSERT policy is required here.
drop policy if exists "usage_select_own" on public.usage;
create policy "usage_select_own" on public.usage
  for select using (user_id = auth.uid());


-- Payments: user can read their own; writes happen from the backend.
drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
  for select using (user_id = auth.uid());


-- =============================================================================
-- Storage policies
--
-- PREREQUISITE: create a Private bucket named "documents" in the Storage UI
-- (Dashboard → Storage → New bucket → name = "documents", Public = off).
--
-- Path convention: "<user_id>/<document_id>_<filename>"
-- The first folder segment must equal the caller's auth.uid().
-- =============================================================================

drop policy if exists "documents_bucket_select_own" on storage.objects;
create policy "documents_bucket_select_own" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_bucket_insert_own" on storage.objects;
create policy "documents_bucket_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_bucket_update_own" on storage.objects;
create policy "documents_bucket_update_own" on storage.objects
  for update using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_bucket_delete_own" on storage.objects;
create policy "documents_bucket_delete_own" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- =============================================================================
-- Done. Verify in SQL Editor:
--   select schemaname, tablename, rowsecurity
--   from pg_tables where schemaname = 'public';
-- Every public.* table should show rowsecurity = true.
-- =============================================================================
