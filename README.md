# FlimCode — Bootstrap film website

## What's included
- `index.html`: responsive homepage, navbar, Bootstrap carousel, hot films, searchable/filterable film grid, mini memory game, footer and social icons.
- `admin.html`: Supabase admin login, shared film management, poster and optional video upload.
- `css/style.css`: custom responsive styling and animation.
- `js/app.js`, `js/admin.js`: public catalogue and Supabase-backed admin/upload logic.
- `img/`: original SVG sample poster artwork, stored locally in the website folder.
- `downloads/`: place authorized downloadable film files here if you prefer static file links.

## Run locally
1. Extract the ZIP.
2. Open `index.html` in a modern browser. For best results use VS Code Live Server.
3. Open Admin from the navbar.
4. Configure Supabase by following [Shared uploads with Supabase](#shared-uploads-with-supabase), then sign in with the admin account you created there.

## Important security and publishing notes
This is a static front end backed by Supabase, not a complete commercial streaming platform.
- Keep Row Level Security enabled and only add trusted users to `film_admins`; never expose a Supabase `service_role` or secret key in browser code.
- New shared film records and uploads are stored in Supabase. Older demo records saved in a browser's `localStorage` are not shared with other visitors.
- The app does not set an image or video file-size limit. Files over 6 MB use resumable uploads. Supabase project/plan limits still apply; large files may require a higher project limit and storage plan.
- The sample posters are original decorative SVG placeholders. No commercial/copyrighted movie files are bundled. Only upload and distribute films for which you own the rights or have explicit permission, or works that are public domain under the laws that apply to you.
- Bootstrap 5.3.3 and Bootstrap Icons load from CDNs, so an internet connection is required for those library assets. The website's own poster SVGs are local in `img/`.

## Customize
- Replace `#` social profile URLs in `js/app.js` (`SOCIAL_LINKS`) with your Instagram, Facebook and LinkedIn links.
- Update sample film records in `js/app.js`.
- Put your own licensed poster artwork in `img/`.
- For a static deployment, store film files in `downloads/` and update the film `download` paths to e.g. `downloads/my-film.mp4`. Do not hotlink or redistribute third-party copyrighted content without permission.


## Owner-supplied poster images
The nine poster/image files supplied with the project have been copied into `img/` and are listed in the initial catalogue in `js/app.js`. Movie video files were not supplied, so these entries show posters only until you add authorized video files through the Supabase Admin panel.

## Shared uploads with Supabase
The Admin page can upload film details, posters, and optional videos to Supabase so every visitor sees the same catalogue. This replaces the browser-only upload flow for new films. Public visitors can read the catalogue and watch files; only Supabase users added to `film_admins` can upload or delete films.

1. Create a Supabase project. In **Project Settings → API**, copy the Project URL and the publishable (or legacy `anon`) key into `js/supabase-config.js`. Never put a `service_role` or secret key in this website.
2. In the Supabase SQL Editor, run the following setup:

   ```sql
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
   ```
3. In **Authentication → Users**, create the admin's email/password account. Copy that user's UUID and register it in the SQL Editor:

   ```sql
   insert into public.film_admins (user_id)
   values ('PASTE-ADMIN-USER-UUID-HERE');
   ```

4. The setup SQL leaves the bucket-specific file-size limit unset. Supabase's project-wide limit and your plan's maximum still apply; adjust them in Supabase project settings if available. The website cannot make uploads unlimited beyond those provider limits.
5. Run the site over HTTPS (or localhost during development), sign in at `admin.html`, and add a film. Use an MP4 encoded with H.264 video and AAC audio for the widest browser playback support.

The storage bucket is public so anyone with a film file URL can watch it. Supabase's Row Level Security still restricts uploads and deletes to the registered admin. The Supabase URL and publishable/anon key are intended for browser use; keep all secret/service-role keys on a server and out of this project.
