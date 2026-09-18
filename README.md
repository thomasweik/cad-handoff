# CAD Handoff

CAD Handoff is a shared workspace for organizing CAD projects into primary histories and contributor branches. Team members enter with Supabase anonymous authentication, upload private CAD packages, and merge an agreed branch version back into its project's primary path.

## Supabase setup

The app expects the Supabase URL and publishable key in a root `.env.local` file:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Enable anonymous sign-ins in Supabase Authentication. Apply the SQL files in [`supabase/migrations`](supabase/migrations) through the Supabase SQL Editor in filename order before starting this version of the app. The migrations preserve existing `cad_packages` records in a generated legacy project and add project, branch, source-version, and merge support.

## Local development

Install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a username, and create a project path. Each project can contain multiple contributor branches and version uploads. Branch owners can merge their latest version into the project's primary history.

## Verification

```bash
npm run lint
npm run build
```

## GitHub Pages deployment

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the static export on every push to `main`.

1. In GitHub, open **Settings → Secrets and variables → Actions** and add repository secrets named `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` using the values from `.env.local`.
2. Open **Settings → Pages** and select **GitHub Actions** as the source.
3. Push the repository's `main` branch. The deployed project site will be available at `https://thomasweik.github.io/cad-handoff/` after the workflow finishes.
