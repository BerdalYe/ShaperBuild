-- ShaperBuild accounts: run this once in your Supabase project
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- It makes:
--   * a `projects` table: one row per cloud design (name, dates, size, a
--     small thumbnail), owned by the user who made it;
--   * a private `projects` storage bucket for the design files, one folder
--     per user;
--   * rules so every user can only see and change their own rows and files;
--   * delete_account(), so people can delete their account themselves.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  size bigint not null default 0,
  thumb text check (thumb is null or char_length(thumb) < 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_updated on public.projects (owner, updated_at desc);

alter table public.projects enable row level security;

drop policy if exists "own projects: read" on public.projects;
drop policy if exists "own projects: add" on public.projects;
drop policy if exists "own projects: change" on public.projects;
drop policy if exists "own projects: delete" on public.projects;
create policy "own projects: read" on public.projects for select to authenticated using (owner = auth.uid());
create policy "own projects: add" on public.projects for insert to authenticated with check (owner = auth.uid());
create policy "own projects: change" on public.projects for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "own projects: delete" on public.projects for delete to authenticated using (owner = auth.uid());

-- The design files: projects/<user id>/<project id>.shaperbuild, at most 50 MB.
insert into storage.buckets (id, name, public, file_size_limit)
values ('projects', 'projects', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "own design files: read" on storage.objects;
drop policy if exists "own design files: add" on storage.objects;
drop policy if exists "own design files: change" on storage.objects;
drop policy if exists "own design files: delete" on storage.objects;
create policy "own design files: read" on storage.objects for select to authenticated
  using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own design files: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own design files: change" on storage.objects for update to authenticated
  using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own design files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);

-- Delete the signed-in user's account (their rows go with it). The app
-- deletes their design files first.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
