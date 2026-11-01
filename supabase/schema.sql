-- =====================================================================
-- The Fershman Journal — Supabase schema
--
-- Run once: Supabase dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again later (it updates functions and policies in place).
--
-- Roles (stored in public.profiles.role):
--   pending  signed up, waiting for approval — sees nothing private
--   member   members portal (slides, models, recordings)
--   writer   + writes drafts and submits them for review
--   editor   + edits, schedules and publishes; authors, portal files, inbox
--   admin    + members, subscribers, site settings
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
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;   -- SQL editor / service role
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

-- ---------------------------------------------------------------- Row Level Security

alter table public.authors      enable row level security;
alter table public.profiles     enable row level security;
alter table public.articles     enable row level security;
alter table public.portal_items enable row level security;
alter table public.messages     enable row level security;
alter table public.subscribers  enable row level security;
alter table public.settings     enable row level security;

-- authors
drop policy if exists "Authors are public" on public.authors;
create policy "Authors are public" on public.authors for select using (true);
drop policy if exists "Editors add authors" on public.authors;
create policy "Editors add authors" on public.authors for insert to authenticated with check (public.is_editor());
drop policy if exists "Editors edit authors" on public.authors;
create policy "Editors edit authors" on public.authors for update to authenticated using (public.is_editor()) with check (public.is_editor());
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

-- messages (submissions, applications, contact)
drop policy if exists "Anyone can send a message" on public.messages;
create policy "Anyone can send a message" on public.messages for insert to anon, authenticated with check (status = 'new');
drop policy if exists "Editors read messages" on public.messages;
create policy "Editors read messages" on public.messages for select to authenticated using (public.is_editor());
drop policy if exists "Editors update messages" on public.messages;
create policy "Editors update messages" on public.messages for update to authenticated using (public.is_editor()) with check (public.is_editor());
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

-- ---------------------------------------------------------------- Privileges
-- RLS decides which rows; these grants decide which operations are possible at all.

grant usage on schema public to anon, authenticated;
grant select on public.authors, public.articles, public.settings to anon;
grant insert on public.messages, public.subscribers to anon;
grant select, insert, update, delete on public.authors, public.articles, public.portal_items,
  public.messages, public.subscribers, public.settings to authenticated;

-- People may edit their own name; only admins (enforced by trigger) change role or byline.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, role, author_id) on public.profiles to authenticated;

grant execute on function public.search_articles(text, int) to anon, authenticated;
grant execute on function public.record_view(text) to anon, authenticated;
grant execute on function public.current_user_role(), public.is_member(), public.is_writer(),
  public.is_editor(), public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------- Storage
-- media:  public article images (anyone can view; writers upload; editors manage)
-- portal: private member files (members view through short-lived links; editors manage)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('portal', 'portal', false, 52428800)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

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

select 'The Fershman Journal schema is installed.' as status;
