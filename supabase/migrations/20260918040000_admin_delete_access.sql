-- Allow the anonymous user whose metadata username is "admin" to delete
-- any CAD project or branch. This is convenient for the current username-only
-- UI, but it is not secure authentication because any visitor can enter "admin".

create policy "Admin can delete any CAD project"
on public.cad_projects
for delete
to authenticated
using (
  lower(coalesce((select auth.jwt()) -> 'user_metadata' ->> 'username', '')) = 'admin'
);

create policy "Admin can delete any CAD branch"
on public.cad_branches
for delete
to authenticated
using (
  lower(coalesce((select auth.jwt()) -> 'user_metadata' ->> 'username', '')) = 'admin'
);

create policy "Admin can delete any CAD package file"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cad-packages'
  and lower(
    coalesce((select auth.jwt()) -> 'user_metadata' ->> 'username', '')
  ) = 'admin'
);
