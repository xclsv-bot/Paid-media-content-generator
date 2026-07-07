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
Run the migrations in order against your project (SQL editor, or `supabase db push`).
Migrations apply in **filename order**, so every file must take the next free
4-digit prefix — never reuse a number (CI rejects duplicate prefixes). If another
PR claims your number first, renumber yours before merging. The first three:
1. `supabase/migrations/0001_init.sql` — schema, enums, RLS policies, financials split,
   new-user trigger.
2. `supabase/migrations/0002_storage.sql` — the private `creative-videos` bucket.
3. `supabase/migrations/0003_performance.sql` — CPT target, ad-link idempotency, and
   the `creative_performance` rollup view.

Then seed the slate from the sheet:
- `supabase/seed.sql` — 12 concept families (with compliance notes) + 40 creatives.

> Re-running migrations/seed is safe: the bucket insert and the seed use
> `on conflict do nothing`, and creatives are keyed on `(sheet_id, org_id)`.

To regenerate the seed if the sheet changes:
```bash
pip install openpyxl
python3 scripts/generate_seed.py /path/to/Outlier_Paid_Media_Ads.xlsx > supabase/seed.sql
```

## 4. Create users
Create users in **Supabase → Authentication → Users**. The `on_auth_user_created`
trigger copies them into `public.users` — it **requires** `org_id` in the
user's `raw_user_meta_data` and will fail the user's creation if it's missing
(no silent default; look up the id first):

```sql
select id, slug, display_name from public.organizations;
```

Set role/org_id via `raw_user_meta_data` at creation, or update `public.users`
afterward:

```sql
-- XCLSV editor (can upload videos, see cost fields)
update public.users set role = 'editor', org_id = (select id from public.organizations where slug = 'xclsv') where email = 'editor@xclsvmedia.com';
-- XCLSV admin
update public.users set role = 'admin',  org_id = (select id from public.organizations where slug = 'xclsv') where email = 'zaire@xclsvmedia.com';
-- Outlier client (view + download + comment; never sees cost)
update public.users set role = 'client_viewer', org_id = (select id from public.organizations where slug = 'outlier') where email = 'lead@outlier.bet';
```

To onboard a new client: insert a row into `public.organizations` (a
`display_name` and, optionally, a `voice_note` used to parameterize the AI
prompts), then provision that client's users against its `id` as above.

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

## Meta performance (Phase 2 — CSV import)
1. Go to **Performance → Import Meta CSV** (staff only) or `/import`.
2. Upload/paste an Ads Manager export. Auto-detected columns: Ad name, Ad ID, Day /
   Reporting starts, Amount spent, Impressions, Link clicks, CTR, Results, Cost per
   result. Override the Results column name if your trial event is custom.
3. Rows join to creatives **by ad name**. To make that work, set each creative's
   `ad_name` to its structured Meta name (PRD §6.3), e.g.
   `update public.creatives set ad_name = 'XCLSV_2025_10_17_Dont_use_L5_PP' where sheet_id = '05';`
4. Ad names that don't match are listed in the import report — pick a creative and
   **Link**, then re-import. (Reconciliation, so rows are never silently dropped.)
5. Set `META_CPT_TARGET` (dollars) to enable the **Hit?** flag; per-creative override
   lives in `creatives.cpt_target_cents`.

> CPT and CTR in rollups are **ratio-of-sums** (`sum(spend)/sum(results)`), not the
> average of per-creative ratios — the correct way to aggregate.

## Not yet done (next steps)
- Migrate the 6 existing Google Drive video links into the bucket (re-host on import).
- Comments & approvals UI (tables + RLS already exist).
- Live Meta Marketing API ingestion (Phase 3) — same tables, automated source.
- Controlled vocabularies for `hook_angle` / `feature_pillar` rollups.
