-- AI-Artist Intelligence — multi-artist accounts schema
--
-- Run this once in the Supabase SQL editor when the real project is created
-- (Dashboard → SQL Editor → paste → Run). Not wired up yet — see
-- frontend/supabase-config.js and .env.example for the placeholders that need
-- real values once this runs.
--
-- Self-serve signup: Supabase Auth handles account creation directly (magic
-- link first, then Authentication → Passkeys for WebAuthn). No allowlist, no
-- approval step — anyone can sign up, matching the Chartmetric-style model
-- Moshe asked for. Compare to ENS Auto Group's allowed_emails table, which
-- this project deliberately does NOT have.

-- ── Artist profiles ─────────────────────────────────────────────────────────
-- One row per signed-up artist, auto-created on signup by the trigger below.
create table if not exists public.artist_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.artist_profiles enable row level security;

create policy "artists read own profile" on public.artist_profiles
  for select using (auth.uid() = id);
create policy "artists update own profile" on public.artist_profiles
  for update using (auth.uid() = id);

create or replace function public.handle_new_artist()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.artist_profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_artist();

-- ── Public platform links ───────────────────────────────────────────────────
-- Non-secret identifiers (Spotify artist ID, YouTube channel ID, ...) that
-- just tell the dashboard whose public catalog data to pull. Safe for the
-- artist's own browser session to read/write directly — no backend involved.
create table if not exists public.platform_links (
  artist_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('spotify', 'youtube')),
  external_id text not null,
  updated_at timestamptz not null default now(),
  primary key (artist_id, platform)
);

alter table public.platform_links enable row level security;

create policy "artists manage own platform links" on public.platform_links
  for all using (auth.uid() = artist_id) with check (auth.uid() = artist_id);

-- ── Secret-bearing platform connections ─────────────────────────────────────
-- OAuth refresh tokens (YouTube Analytics) and manual-platform portal
-- credentials (24Six/Zing/Naki). encrypted_secret is AES-256-GCM ciphertext
-- from backend/proxy.js's existing STATE_KEY primitive — never plaintext,
-- never written or read by the client directly. Only the backend's
-- service_role key touches this column; RLS has no policy allowing client
-- inserts/updates at all, so an artist can never fake a "connected" status or
-- touch another artist's row.
create table if not exists public.platform_connections (
  artist_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in (
    'youtube_analytics', '24six', 'zing', 'naki'
  )),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  encrypted_secret text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (artist_id, platform)
);

alter table public.platform_connections enable row level security;

create policy "artists read own connection status" on public.platform_connections
  for select using (auth.uid() = artist_id);
create policy "artists disconnect own connections" on public.platform_connections
  for delete using (auth.uid() = artist_id);
-- Deliberately no insert/update policy for the client — see comment above.

-- Status-only view, for any future case where selecting through the base
-- table feels too easy to accidentally over-fetch from (e.g. a generic
-- `select *`). encrypted_secret is never exposed even via the base table to
-- the client under RLS since only the artist's own row is selectable and the
-- column is only ever meaningful to the backend that wrote it, but this view
-- keeps the client-facing surface explicit.
create or replace view public.platform_connections_status as
  select artist_id, platform, status, connected_at, updated_at
  from public.platform_connections;
