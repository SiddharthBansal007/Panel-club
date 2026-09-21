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

## Data

Show and episode data lives in `app/shows.json` with optional guest overrides in `app/guest-overrides.json`. The catalogue is validated before every build.

- Thumbnails and videos are linked via YouTube.
- This project uses static export (`output: 'export'` in `next.config.ts`), so images are unoptimized.