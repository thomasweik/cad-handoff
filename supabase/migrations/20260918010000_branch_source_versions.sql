-- Record the exact primary package from which each branch was created.
-- The dynamic column type keeps this migration compatible with bigint or UUID package IDs.

do $$
declare
  package_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
  into package_id_type
  from pg_attribute as attribute
  where attribute.attrelid = 'public.cad_packages'::regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  if package_id_type is null then
    raise exception 'Could not determine public.cad_packages.id type.';
  end if;

  execute format(
    'alter table public.cad_branches add column base_package_id %s',
    package_id_type
  );
end;
$$;

alter table public.cad_branches
  add constraint cad_branches_base_package_id_fkey
  foreign key (base_package_id)
  references public.cad_packages(id)
  on delete set null;

-- Best-effort backfill for branches created before exact source tracking existed.
update public.cad_branches as branch
set base_package_id = (
  select cad_package.id
  from public.cad_packages as cad_package
  where cad_package.project_id = branch.project_id
    and cad_package.promoted_at is not null
    and cad_package.promoted_at <= branch.created_at
  order by
    case
      when cad_package.file_name = branch.branched_from_file_name then 0
      else 1
    end,
    cad_package.promoted_at desc
  limit 1
)
where branch.base_package_id is null;

create index cad_branches_base_package_id_idx
  on public.cad_branches(base_package_id);
