-- Foundit: public report/photo reads, student-owned write access, and realtime.
-- Run this script once in Supabase Dashboard > SQL Editor.

create table if not exists public.reports (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('lost', 'found')),
  item_name text not null check (char_length(item_name) between 1 and 70),
  category text not null,
  description text not null check (char_length(description) between 1 and 400),
  location text not null check (char_length(location) between 1 and 100),
  date date not null,
  contact text not null default '',
  photo_path text,
  status text not null default 'open' check (status in ('open', 'reunited')),
  created_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx
  on public.reports (created_at desc);

alter table public.reports enable row level security;
grant select, insert, update, delete on public.reports to authenticated;
grant select on public.reports to anon;
revoke insert, update, delete on public.reports from anon;

drop policy if exists "Signed-in students can view reports" on public.reports;
drop policy if exists "Anyone can view reports" on public.reports;
create policy "Anyone can view reports"
  on public.reports for select
  to anon, authenticated
  using (true);

drop policy if exists "Students can create their own reports" on public.reports;
create policy "Students can create their own reports"
  on public.reports for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "Students can update their own reports" on public.reports;
create policy "Students can update their own reports"
  on public.reports for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Students can delete their own reports" on public.reports;
create policy "Students can delete their own reports"
  on public.reports for delete
  to authenticated
  using (auth.uid() = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('foundit-report-photos', 'foundit-report-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg'];

drop policy if exists "Signed-in students can view report photos" on storage.objects;
drop policy if exists "Anyone can view report photos" on storage.objects;
create policy "Anyone can view report photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'foundit-report-photos');
grant select on storage.objects to anon, authenticated;

drop policy if exists "Students can upload their own report photos" on storage.objects;
create policy "Students can upload their own report photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'foundit-report-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Students can update their own report photos" on storage.objects;
create policy "Students can update their own report photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'foundit-report-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'foundit-report-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Students can delete their own report photos" on storage.objects;
create policy "Students can delete their own report photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'foundit-report-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reports'
  ) then
    alter publication supabase_realtime add table public.reports;
  end if;
end
$$;
