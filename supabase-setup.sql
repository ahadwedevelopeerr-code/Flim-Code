create extension if not exists pgcrypto;

create table if not exists public.films (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  genre text not null default 'Drama',
  year integer not null,
  rating text not null default '',
  description text not null default '',
  image_path text not null,
  image_url text not null,
  video_path text,
  video_url text,
  hot boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.film_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.film_admins enable row level security;
revoke all on table public.film_admins from public, anon, authenticated;

create or replace function public.is_film_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.film_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_film_admin() from public;
grant execute on function public.is_film_admin() to authenticated;

alter table public.films enable row level security;
grant select on public.films to anon, authenticated;
grant insert, delete on public.films to authenticated;

drop policy if exists "Anyone can view films" on public.films;
create policy "Anyone can view films"
  on public.films for select
  using (true);

drop policy if exists "Film admins can add films" on public.films;
create policy "Film admins can add films"
  on public.films for insert to authenticated
  with check (public.is_film_admin());

drop policy if exists "Film admins can delete films" on public.films;
create policy "Film admins can delete films"
  on public.films for delete to authenticated
  using (public.is_film_admin());

insert into storage.buckets (id, name, public, file_size_limit)
values ('film-assets', 'film-assets', true, null)
on conflict (id) do update set public = true, file_size_limit = null;

drop policy if exists "Anyone can view film assets" on storage.objects;
create policy "Anyone can view film assets"
  on storage.objects for select
  using (bucket_id = 'film-assets');

drop policy if exists "Film admins can upload assets" on storage.objects;
create policy "Film admins can upload assets"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'film-assets' and public.is_film_admin());

drop policy if exists "Film admins can delete assets" on storage.objects;
create policy "Film admins can delete assets"
  on storage.objects for delete to authenticated
  using (bucket_id = 'film-assets' and public.is_film_admin());
