-- Track Storage usage and preserve package history after old files are exported.

alter table public.cad_packages
  add column file_size bigint,
  add column is_archived boolean not null default false,
  add column archived_at timestamptz,
  add column archive_name text;

-- Recover sizes for files uploaded before size tracking was added.
update public.cad_packages as cad_package
set file_size = (storage_object.metadata ->> 'size')::bigint
from storage.objects as storage_object
where storage_object.bucket_id = 'cad-packages'
  and storage_object.name = cad_package.storage_path
  and coalesce(storage_object.metadata ->> 'size', '') ~ '^[0-9]+$';

create index cad_packages_archive_status_created_at_idx
  on public.cad_packages(is_archived, created_at);

create or replace function public.archive_cad_packages(
  p_package_ids text[],
  p_archive_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'An authenticated session is required.';
  end if;

  if coalesce(array_length(p_package_ids, 1), 0) = 0 then
    raise exception 'Select at least one package to archive.';
  end if;

  if nullif(trim(p_archive_name), '') is null then
    raise exception 'An archive name is required.';
  end if;

  if exists (
    select 1
    from public.cad_packages as cad_package
    where cad_package.id::text = any(p_package_ids)
      and cad_package.is_primary = true
  ) then
    raise exception 'The current primary package cannot be archived.';
  end if;

  if exists (
    select 1
    from public.cad_packages as cad_package
    join public.cad_branches as branch
      on branch.id = cad_package.branch_id
    where cad_package.id::text = any(p_package_ids)
      and branch.merged_at is null
      and cad_package.version_number = (
        select max(candidate.version_number)
        from public.cad_packages as candidate
        where candidate.branch_id = cad_package.branch_id
          and candidate.is_archived = false
      )
  ) then
    raise exception 'The newest package on an active branch cannot be archived.';
  end if;

  update public.cad_packages
  set
    is_archived = true,
    archived_at = now(),
    archive_name = trim(p_archive_name)
  where id::text = any(p_package_ids)
    and is_archived = false;
end;
$$;

revoke all on function public.archive_cad_packages(text[], text) from public, anon;
grant execute on function public.archive_cad_packages(text[], text) to authenticated;

-- Once the archive RPC marks a package, any signed-in team member may remove
-- that package's underlying object. The historical database row remains.
create policy "Team members can delete exported archive files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cad-packages'
  and exists (
    select 1
    from public.cad_packages as cad_package
    where cad_package.storage_path = storage.objects.name
      and cad_package.is_archived = true
  )
);
