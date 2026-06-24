# Setup — XCLSV Creative Dashboard

Phase 1 scaffold: content slate (seeded from the Outlier sheet), role-based access,
and the video upload/download flows. Meta tables exist in the schema but ingestion
is wired in a later phase.

## 1. Prerequisites
- Node 20+ and npm
- A Supabase project (free tier is fine) — https://supabase.com
- (optional) the Supabase CLI for local migrations — https://supabase.com/docs/guides/cli

## 2. Environment
```bash
cp .env.example .env.local
```
Fill in from **Supabase → Project Settings → API**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only — never exposed to the browser)

Leave the `META_*` values blank for now.

## 3. Database
Run the migrations in order against your project (SQL editor, or `supabase db push`):
1. `supabase/migrations/0001_init.sql` — schema, enums, RLS policies, financials split,
   new-user trigger.
2. `supabase/migrations/0002_storage.sql` — the private `creative-videos` bucket.

Then seed the slate from the sheet:
- `supabase/seed.sql` — 12 concept families (with compliance notes) + 40 creatives.

> Re-running migrations/seed is safe: the bucket insert and the seed use
> `on conflict do nothing`, and creatives are keyed on `(sheet_id, client_org)`.

To regenerate the seed if the sheet changes:
```bash
pip install openpyxl
python3 scripts/generate_seed.py /path/to/Outlier_Paid_Media_Ads.xlsx > supabase/seed.sql
```

## 4. Create users
Create users in **Supabase → Authentication → Users**. The `on_auth_user_created`
trigger copies them into `public.users`. Set role/org via the user's
`raw_user_meta_data` at creation, or update `public.users` afterward:

```sql
-- XCLSV editor (can upload videos, see cost fields)
update public.users set role = 'editor', org = 'XCLSV' where email = 'editor@xclsvmedia.com';
-- XCLSV admin
update public.users set role = 'admin',  org = 'XCLSV' where email = 'zaire@xclsvmedia.com';
-- Outlier client (view + download + comment; never sees cost)
update public.users set role = 'client_viewer', org = 'Outlier' where email = 'lead@outlier.bet';
```

## 5. Run
```bash
npm install
npm run dev
```
Open http://localhost:3000 → redirected to `/login` → sign in → `/library`.

## How the video flow works
- **Editor upload**: browser asks `/api/uploads/sign` (editor-only) for a one-time
  signed URL, then uploads the file **directly** to Supabase Storage — never through
  the Next API route (avoids Vercel's ~4.5 MB body limit). A `video_assets` row is
  registered afterward.
- **Partner download**: `/api/videos/:id/download` checks RLS (the Outlier client is
  allowed to see its own slate) and mints a short-lived signed URL that downloads the
  **original master file** with its real filename — ready to upload into Meta Ads Manager.
- **Playback**: the creative page mints inline signed streaming URLs server-side.

## Security notes
- `internal_cost` lives in a **separate `creative_financials` table** with an RLS policy
  that only XCLSV staff can read — a client query physically returns zero rows, so the
  cost is stripped at the DB, not just hidden in the UI.
- Org-scoping is enforced by RLS via `can_see_creative()` / `current_org()` — one place,
  not per-query.
- The storage bucket is private; all access is via signed URLs minted server-side.

## Not yet done (next steps)
- Migrate the 6 existing Google Drive video links into the bucket (re-host on import).
- Comments & approvals UI (tables + RLS already exist).
- Meta ingestion: CSV importer (Phase 2) → live Marketing API (Phase 3).
- Controlled vocabularies for `hook_angle` / `feature_pillar` rollups.
