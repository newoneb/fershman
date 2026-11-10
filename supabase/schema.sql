-- =====================================================================
-- The Fershman Journal — Supabase schema
--
-- Run it in Supabase: SQL Editor → New query → paste the whole file → Run.
-- Safe to run again at any time: it adds whatever is missing, updates functions and
-- policies in place, and keeps all of your data.
--
-- Roles (stored in public.profiles.role):
--   pending  an account with no access yet: applicants, and members waiting for approval
--   member   members portal (slides, models, recordings)
--   writer   + writes drafts and submits them for review
--   editor   + edits, schedules and publishes; authors, portal files, inbox; decides applications
--   admin    + members, subscribers, site settings
-- Recruiters are editors, admins, and anyone whose linked byline is on the Marketing team.
-- They run info sessions and recruiting periods and review applications.
-- The FIRST account to sign up becomes admin automatically.
-- =====================================================================

-- ---------------------------------------------------------------- Tables

create table if not exists public.authors (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[^[:space:]/?#]+$'),
  name         text not null check (char_length(name) between 1 and 120),
  role_title   text,
  team         text default 'Contributors',
  bio          text,
  avatar_url   text,
  x_url        text,
  linkedin_url text,
  sort_order   int not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Byline fields added after the first release.
alter table public.authors add column if not exists teams         text[];
alter table public.authors add column if not exists booking_url   text;
alter table public.authors add column if not exists contact_email text;
alter table public.authors add column if not exists class_year    text;
alter table public.authors add column if not exists major         text;
update public.authors set teams = array[coalesce(team, 'Contributors')] where teams is null or cardinality(teams) = 0;

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text default '',
  role       text not null default 'pending' check (role in ('pending', 'member', 'writer', 'editor', 'admin')),
  author_id  uuid references public.authors (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[^[:space:]/?#]+$'),
  title         text not null check (char_length(title) between 1 and 300),
  dek           text,
  body          text not null default '',
  section       text not null default 'markets',
  topic         text,
  tags          text[] not null default '{}',
  author_id     uuid references public.authors (id) on delete set null,
  cover_url     text,
  cover_alt     text,
  cover_caption text,
  figures       text,
  status        text not null default 'draft' check (status in ('draft', 'review', 'published')),
  published_at  timestamptz,
  featured      boolean not null default false,
  big_read      boolean not null default false,
  view_count    bigint not null default 0,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists articles_public_idx  on public.articles (status, published_at desc);
create index if not exists articles_section_idx on public.articles (section, published_at desc);
create index if not exists articles_author_idx  on public.articles (author_id);
create index if not exists articles_fts_idx     on public.articles
  using gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(dek, '') || ' ' || coalesce(body, '')));

create table if not exists public.portal_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 300),
  description text,
  collection  text not null default 'General',
  kind        text not null check (kind in ('file', 'link')),
  url         text,
  file_path   text,
  file_name   text,
  file_size   bigint,
  mime_type   text,
  event_date  date,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((kind = 'file' and file_path is not null) or (kind = 'link' and url is not null))
);
create index if not exists portal_items_collection_idx on public.portal_items (collection, event_date desc);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('submission', 'application', 'contact')),
  name       text check (char_length(name) <= 200),
  email      text not null check (char_length(email) <= 320 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  subject    text check (char_length(subject) <= 500),
  body       text not null default '' check (char_length(body) <= 50000),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 20000),
  status     text not null default 'new' check (status in ('new', 'read', 'archived')),
  created_at timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at desc);
-- Pipeline stage for applications sent with the old single-page form.
alter table public.messages add column if not exists stage text not null default 'new'
  check (stage in ('new', 'reviewing', 'interview', 'accepted', 'declined'));

create table if not exists public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (char_length(email) <= 320 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  name       text check (char_length(name) <= 200),
  source     text default 'site' check (char_length(source) <= 60),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key        text primary key check (char_length(key) <= 60),
  value      jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Recruiting tables

-- Weeks of active recruiting. The Apply page leads with the current one.
create table if not exists public.recruiting_periods (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 120),
  starts_on  date not null,
  ends_on    date not null,
  note       text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
alter table public.recruiting_periods add column if not exists decisions_on date;

create table if not exists public.info_sessions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 200),
  description  text check (char_length(description) <= 4000),
  starts_at    timestamptz not null,
  duration_min int not null default 60 check (duration_min between 5 and 600),
  location     text check (char_length(location) <= 300),
  join_url     text check (join_url is null or join_url ~* '^https://'),
  capacity     int check (capacity is null or capacity > 0),
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists info_sessions_starts_idx on public.info_sessions (starts_at);

create table if not exists public.session_registrations (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.info_sessions (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 200),
  email      text not null check (char_length(email) <= 320),
  year       text check (char_length(year) <= 60),
  note       text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  unique (session_id, email)
);
create index if not exists session_registrations_session_idx on public.session_registrations (session_id);

-- Applications written in the portal. Applicants save drafts and submit their own; recruiters
-- review them; editors and admins accept or decline. Accepting grants the chosen access.
create table if not exists public.applications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'draft'
               check (status in ('draft', 'submitted', 'reviewing', 'interview', 'accepted', 'declined')),
  full_name    text not null default '' check (char_length(full_name) <= 200),
  email        text not null default '' check (char_length(email) <= 320),
  answers      jsonb not null default '{}'::jsonb check (pg_column_size(answers) < 60000),
  file_path    text,
  file_name    text check (char_length(file_name) <= 300),
  message      text not null default '' check (char_length(message) <= 4000),
  grant_role   text not null default 'writer' check (grant_role in ('member', 'writer')),
  period_id    uuid references public.recruiting_periods (id) on delete set null,
  submitted_at timestamptz,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists applications_user_idx   on public.applications (user_id, created_at desc);
create index if not exists applications_status_idx on public.applications (status, submitted_at desc);

create table if not exists public.application_reviews (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  reviewer_id    uuid references public.profiles (id) on delete set null,
  reviewer_name  text not null default '',
  score          int check (score between 1 and 5),
  recommendation text not null check (recommendation in ('advance', 'hold', 'decline')),
  note           text not null default '' check (char_length(note) <= 4000),
  created_at     timestamptz not null default now()
);
create index if not exists application_reviews_app_idx on public.application_reviews (application_id);

-- ---------------------------------------------------------------- Role helpers
-- SECURITY DEFINER so they can read profiles even though callers can't read others' rows.

create or replace function public.current_user_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('member', 'writer', 'editor', 'admin');
$$;
create or replace function public.is_writer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('writer', 'editor', 'admin');
$$;
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('editor', 'admin');
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'admin';
$$;
-- Editors and admins, and members whose linked byline is on the Marketing team.
create or replace function public.is_recruiter() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_editor() or (
    public.is_member() and exists (
      select 1 from public.profiles p join public.authors a on a.id = p.author_id
      where p.id = auth.uid()
        and 'Marketing' = any(case when a.teams is null or cardinality(a.teams) = 0 then array[a.team] else a.teams end)
    )
  );
$$;

-- ---------------------------------------------------------------- Triggers

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Only fires when content columns change, so view counts don't bump "updated".
drop trigger if exists articles_touch on public.articles;
create trigger articles_touch
  before update of slug, title, dek, body, section, topic, tags, author_id, cover_url, cover_alt,
                   cover_caption, figures, status, published_at, featured, big_read
  on public.articles for each row execute function public.touch_updated_at();
drop trigger if exists authors_touch on public.authors;
create trigger authors_touch before update on public.authors for each row execute function public.touch_updated_at();
drop trigger if exists portal_items_touch on public.portal_items;
create trigger portal_items_touch before update on public.portal_items for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();
drop trigger if exists info_sessions_touch on public.info_sessions;
create trigger info_sessions_touch before update on public.info_sessions for each row execute function public.touch_updated_at();

-- Article rules the database enforces no matter what the browser sends.
create or replace function public.article_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('fershman.counting_view', true) = 'on' then
    return new;                                -- record_view() only bumps the counter
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;          -- ownership never changes
  end if;
  if auth.uid() is not null and not public.is_editor() then
    -- writers can't feature their own stories or set dates
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.featured := false;
      new.big_read := false;
      new.view_count := 0;
    else
      new.featured := old.featured;
      new.big_read := old.big_read;
      new.view_count := old.view_count;
    end if;
    new.published_at := null;
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists articles_rules on public.articles;
create trigger articles_rules before insert or update on public.articles
  for each row execute function public.article_rules();

-- Profiles: only admins change roles or bylines, and the last admin can't step down.
-- An accepted application is the one exception: grant_on_accept() raises the applicant's role.
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;   -- SQL editor / service role
  end if;
  if current_setting('fershman.granting', true) = 'on' then
    return new;   -- access granted by an accepted application
  end if;
  if (new.role is distinct from old.role or new.author_id is distinct from old.author_id) and not public.is_admin() then
    raise exception 'Only admins can change roles and bylines.' using errcode = '42501';
  end if;
  if old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'You are the only admin. Make someone else an admin first.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- People editing their own byline keep the address, teams and order the editors set.
create or replace function public.guard_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_editor() then
    return new;
  end if;
  new.slug := old.slug;
  new.team := old.team;
  new.teams := old.teams;
  new.sort_order := old.sort_order;
  return new;
end;
$$;
drop trigger if exists authors_guard on public.authors;
create trigger authors_guard before update on public.authors
  for each row execute function public.guard_author();

-- Every new sign-up gets a profile. The very first one becomes admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_admin boolean;
begin
  select not exists (select 1 from public.profiles where role = 'admin') into first_admin;
  insert into public.profiles (id, email, full_name, role, created_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when first_admin then 'admin' else 'pending' end,
    coalesce(new.created_at, now())
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile emails in sync when someone changes their email.
create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Accounts created before this script ran get profiles too; the oldest becomes admin if none exists.
insert into public.profiles (id, email, full_name, role, created_at)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', ''), 'pending', coalesce(u.created_at, now())
from auth.users u
on conflict (id) do nothing;
update public.profiles set role = 'admin'
where id = (select id from public.profiles order by created_at asc limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');

-- ---------------------------------------------------------------- Recruiting rules

-- The time zone recruiting dates are in (Admin → Recruiting → Apply page), Chicago by default.
create or replace function public.recruiting_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select value ->> 'timezone' from public.settings where key = 'recruiting'), ''), 'America/Chicago');
$$;

-- The recruiting period running today, if any.
create or replace function public.active_period_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.recruiting_periods
  where (now() at time zone public.recruiting_tz())::date between starts_on and ends_on
  order by ends_on, starts_on
  limit 1;
$$;

-- Whether a new application can be submitted right now. Mirrors applicationStatus() in
-- assets/js/data/shared.js: rolling = always, deadline = through the end of that day, closed = never.
create or replace function public.applications_open() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_rc jsonb := (select value from public.settings where key = 'recruiting');
  v_mode text := coalesce(v_rc ->> 'status', 'rolling');
begin
  if v_mode = 'closed' then
    return false;
  end if;
  if v_mode = 'deadline' and nullif(v_rc ->> 'deadline', '') is not null then
    return (now() at time zone public.recruiting_tz())::date <= (v_rc ->> 'deadline')::date;
  end if;
  return true;
end;
$$;

-- Applicants write and submit their own application. Recruiters move it through review and
-- leave notes; only editors and admins accept or decline.
create or replace function public.guard_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if me is null then
    return new;   -- SQL editor / service role
  end if;

  if tg_op = 'INSERT' then
    new.user_id := me;
    new.email := coalesce((select email from public.profiles where id = me), '');
    new.status := 'draft';
    new.message := '';
    new.grant_role := 'writer';
    new.period_id := null;
    new.submitted_at := null;
    new.decided_at := null;
    new.created_at := now();
    if exists (select 1 from public.applications where user_id = me and status not in ('accepted', 'declined')) then
      raise exception 'You already have an application in progress. Open it from the portal.';
    end if;
    return new;
  end if;

  -- Reviewers: the status, a note to the applicant and the access to grant. The answers stay the applicant's.
  if old.user_id <> me and public.is_recruiter() then
    new.email := old.email;
    new.full_name := old.full_name;
    new.answers := old.answers;
    new.file_path := old.file_path;
    new.file_name := old.file_name;
    new.submitted_at := old.submitted_at;
    new.period_id := old.period_id;
    if new.status is distinct from old.status then
      if old.status = 'draft' then
        raise exception 'This application is still a draft. You can review it once the applicant submits it.';
      end if;
      if (new.status in ('accepted', 'declined') or old.status in ('accepted', 'declined')) and not public.is_editor() then
        raise exception 'Only editors and admins can accept or decline applications.';
      end if;
      new.decided_at := case when new.status in ('accepted', 'declined') then now() else null end;
    else
      new.decided_at := old.decided_at;
    end if;
    return new;
  end if;

  -- The applicant: their own draft, and submitting it.
  if old.user_id <> me then
    raise exception 'You can only change your own application.';
  end if;
  new.email := old.email;
  new.message := old.message;
  new.grant_role := old.grant_role;
  new.period_id := old.period_id;
  new.submitted_at := old.submitted_at;
  new.decided_at := old.decided_at;
  if old.status <> 'draft' then
    raise exception 'This application has been submitted, so it can no longer be changed.';
  end if;
  if new.status is distinct from old.status then
    if new.status <> 'submitted' then
      raise exception 'Only the editors can change the status of an application.';
    end if;
    -- A first submission needs applications to be open. One returned for edits can go back at any time.
    if old.submitted_at is null and not public.applications_open() then
      raise exception 'Applications are closed right now. Your draft is saved, and you can submit it once they reopen.';
    end if;
    if char_length(trim(new.full_name)) = 0 then
      raise exception 'Add your full name before you submit.';
    end if;
    new.period_id := coalesce(old.period_id, public.active_period_id());
    new.submitted_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists applications_guard on public.applications;
create trigger applications_guard before insert or update on public.applications
  for each row execute function public.guard_application();

-- Accepting an application grants the chosen access (never lowers anyone's role).
create or replace function public.grant_on_accept() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ranks text[] := array['pending', 'member', 'writer', 'editor', 'admin'];
  had text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    select role into had from public.profiles where id = new.user_id;
    if coalesce(array_position(ranks, new.grant_role), 0) > coalesce(array_position(ranks, had), 1) then
      perform set_config('fershman.granting', 'on', true);
      update public.profiles
        set role = new.grant_role,
            full_name = case when coalesce(full_name, '') = '' then new.full_name else full_name end
        where id = new.user_id;
      perform set_config('fershman.granting', 'off', true);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists applications_grant on public.applications;
create trigger applications_grant after update of status on public.applications
  for each row execute function public.grant_on_accept();

-- Reviews carry the reviewer's name from their profile.
create or replace function public.stamp_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.reviewer_id := auth.uid();
    new.reviewer_name := coalesce(
      (select nullif(full_name, '') from public.profiles where id = auth.uid()),
      (select email from public.profiles where id = auth.uid()), '');
  end if;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists application_reviews_stamp on public.application_reviews;
create trigger application_reviews_stamp before insert on public.application_reviews
  for each row execute function public.stamp_review();

-- ---------------------------------------------------------------- Functions for the site

-- Full-text search over published articles (runs with the caller's permissions).
create or replace function public.search_articles(q text, max_results int default 30)
returns table (
  id uuid, slug text, title text, dek text, section text, topic text, tags text[],
  cover_url text, cover_alt text, published_at timestamptz, author_id uuid, featured boolean, rank real
)
language sql stable set search_path = public as $$
  select a.id, a.slug, a.title, a.dek, a.section, a.topic, a.tags, a.cover_url, a.cover_alt,
         a.published_at, a.author_id, a.featured,
         ts_rank(to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.dek, '') || ' ' || coalesce(a.body, '')),
                 websearch_to_tsquery('english', q)) as rank
  from public.articles a
  where a.status = 'published'
    and a.published_at <= now()
    and (
      to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.dek, '') || ' ' || coalesce(a.body, ''))
        @@ websearch_to_tsquery('english', q)
      or a.title ilike '%' || q || '%'
      or a.dek ilike '%' || q || '%'
      or a.topic ilike '%' || q || '%'
    )
  order by rank desc, a.published_at desc
  limit least(greatest(coalesce(max_results, 30), 1), 50);
$$;

-- Anonymous "most read" counter. Only touches view_count of published stories.
create or replace function public.record_view(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('fershman.counting_view', 'on', true);
  update public.articles
  set view_count = view_count + 1
  where slug = p_slug and status = 'published' and published_at <= now();
  perform set_config('fershman.counting_view', 'off', true);
end;
$$;

-- Upcoming published info sessions for the Apply page, without their meeting links.
drop function if exists public.info_sessions_public();
create function public.info_sessions_public()
returns table (
  id uuid, title text, description text, starts_at timestamptz, duration_min int,
  location text, capacity int, is_online boolean, registered int
)
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.description, s.starts_at, s.duration_min, s.location, s.capacity,
         coalesce(s.join_url, '') <> '' as is_online,
         (select count(*)::int from public.session_registrations r where r.session_id = s.id) as registered
  from public.info_sessions s
  where s.is_published and s.starts_at + make_interval(mins => s.duration_min) > now()
  order by s.starts_at;
$$;

-- A visitor registers for an info session. Returns the session (with its meeting link) and a status:
-- registered | already | full | closed | invalid.
drop function if exists public.register_for_session(uuid, text, text, text, text);
create function public.register_for_session(p_session uuid, p_name text, p_email text, p_year text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.info_sessions%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  taken int;
  details jsonb;
begin
  if v_name = '' or char_length(v_name) > 200 or char_length(v_email) > 320
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into s from public.info_sessions where id = p_session for update;
  if not found or not s.is_published or s.starts_at + make_interval(mins => s.duration_min) <= now() then
    return jsonb_build_object('status', 'closed');
  end if;
  details := jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description, 'starts_at', s.starts_at,
    'duration_min', s.duration_min, 'location', s.location, 'join_url', s.join_url);
  if exists (select 1 from public.session_registrations where session_id = s.id and email = v_email) then
    return details || jsonb_build_object('status', 'already');
  end if;
  select count(*) into taken from public.session_registrations where session_id = s.id;
  if s.capacity is not null and taken >= s.capacity then
    return jsonb_build_object('status', 'full');
  end if;
  insert into public.session_registrations (session_id, name, email, year, note)
  values (s.id, v_name, v_email, nullif(left(trim(coalesce(p_year, '')), 60), ''), nullif(left(trim(coalesce(p_note, '')), 1000), ''));
  return details || jsonb_build_object('status', 'registered');
end;
$$;

-- ---------------------------------------------------------------- Row Level Security

alter table public.authors               enable row level security;
alter table public.profiles              enable row level security;
alter table public.articles              enable row level security;
alter table public.portal_items          enable row level security;
alter table public.messages              enable row level security;
alter table public.subscribers           enable row level security;
alter table public.settings              enable row level security;
alter table public.recruiting_periods    enable row level security;
alter table public.info_sessions         enable row level security;
alter table public.session_registrations enable row level security;
alter table public.applications          enable row level security;
alter table public.application_reviews   enable row level security;

-- authors
drop policy if exists "Authors are public" on public.authors;
create policy "Authors are public" on public.authors for select using (true);
drop policy if exists "Editors add authors" on public.authors;
create policy "Editors add authors" on public.authors for insert to authenticated with check (public.is_editor());
drop policy if exists "Editors edit authors" on public.authors;
create policy "Editors edit authors" on public.authors for update to authenticated using (public.is_editor()) with check (public.is_editor());
drop policy if exists "People edit their own byline" on public.authors;
create policy "People edit their own byline" on public.authors for update to authenticated
  using (id = (select author_id from public.profiles where id = auth.uid()))
  with check (id = (select author_id from public.profiles where id = auth.uid()));
drop policy if exists "Admins delete authors" on public.authors;
create policy "Admins delete authors" on public.authors for delete to authenticated using (public.is_admin());

-- profiles
drop policy if exists "See own profile" on public.profiles;
create policy "See own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "Admins see all profiles" on public.profiles;
create policy "Admins see all profiles" on public.profiles for select to authenticated using (public.is_admin());
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- articles
drop policy if exists "Readers see published articles" on public.articles;
create policy "Readers see published articles" on public.articles for select
  using (status = 'published' and published_at <= now());
drop policy if exists "Editors see all articles" on public.articles;
create policy "Editors see all articles" on public.articles for select to authenticated using (public.is_editor());
drop policy if exists "Writers see their own articles" on public.articles;
create policy "Writers see their own articles" on public.articles for select to authenticated
  using (created_by = auth.uid() and public.is_writer());
drop policy if exists "Editors create articles" on public.articles;
create policy "Editors create articles" on public.articles for insert to authenticated with check (public.is_editor());
drop policy if exists "Writers create drafts" on public.articles;
create policy "Writers create drafts" on public.articles for insert to authenticated
  with check (public.is_writer() and created_by = auth.uid() and status in ('draft', 'review'));
drop policy if exists "Editors edit articles" on public.articles;
create policy "Editors edit articles" on public.articles for update to authenticated
  using (public.is_editor()) with check (public.is_editor());
drop policy if exists "Writers edit their unpublished articles" on public.articles;
create policy "Writers edit their unpublished articles" on public.articles for update to authenticated
  using (public.is_writer() and created_by = auth.uid() and status in ('draft', 'review'))
  with check (created_by = auth.uid() and status in ('draft', 'review'));
drop policy if exists "Editors delete articles" on public.articles;
create policy "Editors delete articles" on public.articles for delete to authenticated using (public.is_editor());
drop policy if exists "Writers delete their drafts" on public.articles;
create policy "Writers delete their drafts" on public.articles for delete to authenticated
  using (public.is_writer() and created_by = auth.uid() and status = 'draft');

-- portal_items
drop policy if exists "Members see portal items" on public.portal_items;
create policy "Members see portal items" on public.portal_items for select to authenticated using (public.is_member());
drop policy if exists "Editors add portal items" on public.portal_items;
create policy "Editors add portal items" on public.portal_items for insert to authenticated with check (public.is_editor());
drop policy if exists "Editors edit portal items" on public.portal_items;
create policy "Editors edit portal items" on public.portal_items for update to authenticated using (public.is_editor()) with check (public.is_editor());
drop policy if exists "Editors delete portal items" on public.portal_items;
create policy "Editors delete portal items" on public.portal_items for delete to authenticated using (public.is_editor());

-- messages (submissions, applications from the old form, contact)
drop policy if exists "Anyone can send a message" on public.messages;
create policy "Anyone can send a message" on public.messages for insert to anon, authenticated with check (status = 'new');
drop policy if exists "Editors read messages" on public.messages;
create policy "Editors read messages" on public.messages for select to authenticated using (public.is_editor());
drop policy if exists "Recruiters read applications" on public.messages;
create policy "Recruiters read applications" on public.messages for select to authenticated
  using (kind = 'application' and public.is_recruiter());
drop policy if exists "Editors update messages" on public.messages;
create policy "Editors update messages" on public.messages for update to authenticated using (public.is_editor()) with check (public.is_editor());
drop policy if exists "Recruiters update applications" on public.messages;
create policy "Recruiters update applications" on public.messages for update to authenticated
  using (kind = 'application' and public.is_recruiter()) with check (kind = 'application' and public.is_recruiter());
drop policy if exists "Editors delete messages" on public.messages;
create policy "Editors delete messages" on public.messages for delete to authenticated using (public.is_editor());

-- subscribers
drop policy if exists "Anyone can subscribe" on public.subscribers;
create policy "Anyone can subscribe" on public.subscribers for insert to anon, authenticated with check (true);
drop policy if exists "Admins see subscribers" on public.subscribers;
create policy "Admins see subscribers" on public.subscribers for select to authenticated using (public.is_admin());
drop policy if exists "Admins remove subscribers" on public.subscribers;
create policy "Admins remove subscribers" on public.subscribers for delete to authenticated using (public.is_admin());

-- settings
drop policy if exists "Settings are public" on public.settings;
create policy "Settings are public" on public.settings for select using (true);
drop policy if exists "Admins add settings" on public.settings;
create policy "Admins add settings" on public.settings for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins change settings" on public.settings;
create policy "Admins change settings" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- Editors manage the list of sections (Admin → Sections, and "New section" in the editor).
drop policy if exists "Editors add sections" on public.settings;
create policy "Editors add sections" on public.settings for insert to authenticated with check (key = 'sections' and public.is_editor());
drop policy if exists "Editors change sections" on public.settings;
create policy "Editors change sections" on public.settings for update to authenticated
  using (key = 'sections' and public.is_editor()) with check (key = 'sections' and public.is_editor());

-- recruiting periods: public dates (the internal note is hidden from visitors by column grants below)
drop policy if exists "Recruiting periods are public" on public.recruiting_periods;
create policy "Recruiting periods are public" on public.recruiting_periods for select using (true);
drop policy if exists "Recruiters manage periods" on public.recruiting_periods;
create policy "Recruiters manage periods" on public.recruiting_periods for all to authenticated
  using (public.is_recruiter()) with check (public.is_recruiter());

-- info sessions: the public reads them through info_sessions_public(), which hides meeting links
drop policy if exists "Recruiters manage info sessions" on public.info_sessions;
create policy "Recruiters manage info sessions" on public.info_sessions for all to authenticated
  using (public.is_recruiter()) with check (public.is_recruiter());

-- registrations: added through register_for_session()
drop policy if exists "Recruiters see registrations" on public.session_registrations;
create policy "Recruiters see registrations" on public.session_registrations for select to authenticated using (public.is_recruiter());
drop policy if exists "Recruiters remove registrations" on public.session_registrations;
create policy "Recruiters remove registrations" on public.session_registrations for delete to authenticated using (public.is_recruiter());

-- applications (the trigger guard_application() decides which columns each person may change)
drop policy if exists "Applicants and recruiters see applications" on public.applications;
create policy "Applicants and recruiters see applications" on public.applications for select to authenticated
  using (user_id = auth.uid() or public.is_recruiter());
drop policy if exists "Applicants start their own application" on public.applications;
create policy "Applicants start their own application" on public.applications for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "Applicants edit their own draft" on public.applications;
create policy "Applicants edit their own draft" on public.applications for update to authenticated
  using (user_id = auth.uid() and status = 'draft') with check (user_id = auth.uid());
drop policy if exists "Recruiters update applications" on public.applications;
create policy "Recruiters update applications" on public.applications for update to authenticated
  using (public.is_recruiter()) with check (public.is_recruiter());
drop policy if exists "Admins delete applications" on public.applications;
create policy "Admins delete applications" on public.applications for delete to authenticated using (public.is_admin());

-- reviews: recruiters only, never the applicant
drop policy if exists "Recruiters read reviews" on public.application_reviews;
create policy "Recruiters read reviews" on public.application_reviews for select to authenticated using (public.is_recruiter());
drop policy if exists "Recruiters add reviews" on public.application_reviews;
create policy "Recruiters add reviews" on public.application_reviews for insert to authenticated with check (public.is_recruiter());
drop policy if exists "Reviewers remove their reviews" on public.application_reviews;
create policy "Reviewers remove their reviews" on public.application_reviews for delete to authenticated
  using (reviewer_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- Privileges
-- RLS decides which rows; these grants decide which operations are possible at all.

grant usage on schema public to anon, authenticated;
grant select on public.authors, public.articles, public.settings to anon;
grant insert on public.messages, public.subscribers to anon;
revoke all on public.recruiting_periods, public.info_sessions, public.session_registrations,
  public.applications, public.application_reviews from anon;
grant select (id, title, starts_on, ends_on, decisions_on) on public.recruiting_periods to anon;
grant select, insert, update, delete on public.authors, public.articles, public.portal_items,
  public.messages, public.subscribers, public.settings, public.recruiting_periods, public.info_sessions,
  public.session_registrations, public.applications, public.application_reviews to authenticated;

-- People may edit their own name; only admins (enforced by trigger) change role or byline.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, role, author_id) on public.profiles to authenticated;

grant execute on function public.search_articles(text, int) to anon, authenticated;
grant execute on function public.record_view(text) to anon, authenticated;
grant execute on function public.info_sessions_public() to anon, authenticated;
grant execute on function public.register_for_session(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.applications_open(), public.active_period_id(), public.recruiting_tz() to anon, authenticated;
grant execute on function public.current_user_role(), public.is_member(), public.is_writer(),
  public.is_editor(), public.is_admin(), public.is_recruiter() to anon, authenticated;

-- ---------------------------------------------------------------- Storage
-- media:        public article images (anyone can view; writers upload; editors manage)
-- portal:       private member files (members view through short-lived links; editors manage)
-- applications: private application files, in a folder per account (the applicant and recruiters)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('portal', 'portal', false, 52428800)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('applications', 'applications', false, 10485760, array['application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fj media read" on storage.objects;
create policy "fj media read" on storage.objects for select using (bucket_id = 'media');
drop policy if exists "fj media upload" on storage.objects;
create policy "fj media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_writer());
drop policy if exists "fj media update" on storage.objects;
create policy "fj media update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_editor());
drop policy if exists "fj media delete" on storage.objects;
create policy "fj media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_editor());

drop policy if exists "fj portal read" on storage.objects;
create policy "fj portal read" on storage.objects for select to authenticated
  using (bucket_id = 'portal' and public.is_member());
drop policy if exists "fj portal upload" on storage.objects;
create policy "fj portal upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'portal' and public.is_editor());
drop policy if exists "fj portal update" on storage.objects;
create policy "fj portal update" on storage.objects for update to authenticated
  using (bucket_id = 'portal' and public.is_editor());
drop policy if exists "fj portal delete" on storage.objects;
create policy "fj portal delete" on storage.objects for delete to authenticated
  using (bucket_id = 'portal' and public.is_editor());

drop policy if exists "fj applications upload" on storage.objects;
create policy "fj applications upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'applications' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "fj applications read" on storage.objects;
create policy "fj applications read" on storage.objects for select to authenticated
  using (bucket_id = 'applications' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_recruiter()));
drop policy if exists "fj applications delete" on storage.objects;
create policy "fj applications delete" on storage.objects for delete to authenticated
  using (bucket_id = 'applications' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

select 'The Fershman Journal schema is installed.' as status;
