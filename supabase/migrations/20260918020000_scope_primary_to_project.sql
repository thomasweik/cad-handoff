-- The original app allowed only one primary package globally.
-- Project workspaces require one primary package per project instead.

alter table public.cad_packages
  drop constraint if exists only_one_primary_package;

-- Covers projects where the old rule was created directly as a unique index.
drop index if exists public.only_one_primary_package;

-- Keep the replacement rule explicit and safe to rerun.
create unique index if not exists cad_packages_one_primary_per_project_idx
  on public.cad_packages(project_id)
  where is_primary = true;
