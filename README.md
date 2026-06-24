# Paid Media Content Generator

**XCLSV Creative Dashboard & Client Portal** — the content slate lives here, video
files are delivered to the client (Outlier), and Meta Ads performance joins back to
each creative so the team can see what's working and optimize the next slate.

Built with Next.js (App Router) + Supabase (Postgres, Auth, Storage), with row-level
security enforcing org-scoping and keeping XCLSV's internal cost fields off the wire.

## Status
**Phase 1** — portal + library + video delivery:
- ✅ Content slate seeded from the Outlier sheet (12 concept families, 40 creatives)
- ✅ Role-based access (admin / editor / client_viewer) via Supabase Auth + RLS
- ✅ Video upload (editor) → direct-to-storage signed uploads
- ✅ Video playback + master-file download (partner) via signed URLs
- ✅ Internal cost isolated in a separate RLS-gated table

**Phase 2** — Meta performance via CSV:
- ✅ Ads Manager CSV importer with flexible header detection
- ✅ Join to creatives by ad name + reconciliation for unmatched names
- ✅ Per-creative performance panel + Hit? flag (CPT ≤ target)
- ✅ Rollups by concept family / archetype / sport (ratio-of-sums CPT)
- ⏳ Comments/approvals UI, live Meta API (Phase 3)

## Quick start
See **[docs/SETUP.md](docs/SETUP.md)** for the full walkthrough (Supabase project,
migrations, seed, users, run).

```bash
cp .env.example .env.local   # fill in Supabase keys
npm install
npm run dev
```

## Layout
```
src/app/            routes (login, library, creative detail, API)
src/components/     VideoUploader, VideoAssetCard
src/lib/            supabase clients, auth, storage helpers
supabase/migrations 0001 schema+RLS · 0002 storage bucket
supabase/seed.sql   families + creatives (generated from the sheet)
scripts/            generate_seed.py
```
