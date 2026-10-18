-- Run this in Supabase Dashboard > SQL Editor to make existing Foundit
-- reports and their attached photos readable without login.
-- Create, update, and delete policies remain restricted to the report owner.

grant select on public.reports to anon, authenticated;
revoke insert, update, delete on public.reports from anon;

drop policy if exists "Signed-in students can view reports" on public.reports;
drop policy if exists "Anyone can view reports" on public.reports;
create policy "Anyone can view reports"
  on public.reports for select
  to anon, authenticated
  using (true);

drop policy if exists "Signed-in students can view report photos" on storage.objects;
drop policy if exists "Anyone can view report photos" on storage.objects;
create policy "Anyone can view report photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'foundit-report-photos');
grant select on storage.objects to anon, authenticated;
