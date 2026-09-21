# Panel Club

The Indian comedy directory in one place — comedy panels, game shows and roasts, with every public episode and guest/panelist searchable from a single page.

## Features

- Browse India's comedy panels, game shows, roasts and advice shows.
- Search across shows, hosts, guests and episode titles.
- Filter by category: Panel shows, Game shows, Roasts, Advice & banter.
- Per-show episode modal with guest/panelist listing and YouTube deep-links.
- Auto-rotating show spotlight with manual controls.
- Vercel Speed Insights and Analytics integrated in the root layout.

## Getting started

```bash
npm install
npm run dev
```

The dev server runs at `http://127.0.0.1:3000`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` | Validate the catalogue, then build a static export. |
| `npm run start` | Serve the built site (`next start`). |
| `npm run validate:catalogue` | Validate the local shows catalogue data. |
| `npm run validate:youtube` | Validate the catalogue online against YouTube. |
| `npm run sync:catalogue` | Fetch new episodes from YouTube and update `app/shows.json`. |
| `npm run sync:catalogue:dry` | Preview new episodes without writing changes. |

## Data

Show and episode data lives in `app/shows.json` with optional guest overrides in `app/guest-overrides.json`. The catalogue is validated before every build.

- Thumbnails and videos are linked via YouTube.
- This project uses static export (`output: 'export'` in `next.config.ts`), so images are unoptimized.

## Automation

The [`Sync episodes`](.github/workflows/sync-episodes.yml) workflow runs every Monday and can be started manually. It reads each show's YouTube channel/playlist RSS feed, appends new episodes to `app/shows.json`, validates and builds the site, then commits to `main` so Vercel deploys the update.

Per-show sync rules live in `scripts/sync-config.json`:

- `include` — title pattern required for channel sources (so unrelated channel uploads are ignored). Playlist sources are trusted as-is.
- `exclude` — global pattern that skips bonus clips, behind-the-scenes and compilations.
- `minDurationSeconds` — skips Shorts and trailers.

New episodes get guest/panelist credits from the title and description. Anything the script cannot credit falls back to the host and is listed as a warning in the workflow run summary.