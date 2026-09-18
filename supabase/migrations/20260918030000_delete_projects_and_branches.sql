-- Allow project creators and branch owners to remove their own work.

grant delete on table public.cad_projects to authenticated;
grant delete on table public.cad_branches to authenticated;

create policy "Project creators can delete their CAD projects"
on public.cad_projects
for delete
to authenticated
using ((select auth.uid()) = created_by);

create policy "Branch owners can delete their CAD branches"
on public.cad_branches
for delete
to authenticated
using ((select auth.uid()) = owner_id);

-- A project creator can remove Storage objects belonging to that project.
-- New object paths follow: user-id/project-id/branch-id/file-name.
create policy "Project creators can delete project files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cad-packages'
  and case
    when coalesce((storage.foldername(name))[2], '') ~ '^[0-9]+$' then
      exists (
        select 1
        from public.cad_projects as project
        where project.id = ((storage.foldername(name))[2])::bigint
          and project.created_by = (select auth.uid())
      )
    else false
  end
);
