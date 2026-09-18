-- Store the CAD application used by each project and working branch, and allow
-- owners (plus the current metadata-based admin) to rename their records.

alter table public.cad_projects
  add column cad_software text
  check (cad_software is null or char_length(trim(cad_software)) between 1 and 80);

alter table public.cad_branches
  add column cad_software text
  check (cad_software is null or char_length(trim(cad_software)) between 1 and 80);

grant update on table public.cad_projects to authenticated;

create policy "Project creators can update their CAD projects"
on public.cad_projects
for update
to authenticated
using ((select auth.uid()) = created_by)
with check ((select auth.uid()) = created_by);

create policy "Admin can update any CAD project"
on public.cad_projects
for update
to authenticated
using (
  lower(coalesce((select auth.jwt()) -> 'user_metadata' ->> 'username', '')) = 'admin'
)
with check (
  lower(coalesce((select auth.jwt()) -> 'user_metadata' ->> 'username', '')) = 'admin'
);

create policy "Admin can update any CAD branch"
on public.cad_branches
for update
to authenticated
using (
  lower(coalesce((select auth.jwt()) -> 'user_metadata' ->> 'username', '')) = 'admin'
)
with check (
  lower(coalesce((select auth.jwt()) -> 'user_metadata' ->> 'username', '')) = 'admin'
);
