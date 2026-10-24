# Salon

**Try the prototype: https://sylvancr.github.io/art-letterboxd/**

Letterboxd for art. Log, rate and review the artworks **currently on display** at major museums, keep a diary of
what you've seen, build a want-to-see list for your next visit, make lists, and follow friends.

## Museums

The catalog comes from open-access APIs that need no key. Each importer asks only for works the museum lists as on view.

| Museum | API | "On view" filter |
| --- | --- | --- |
| The Metropolitan Museum of Art | `collectionapi.metmuseum.org` (v1.1 search + objects) | `isOnView=true` |
| Art Institute of Chicago | `api.artic.edu` | `is_on_view: true` |
| Cleveland Museum of Art | `openaccess-api.clevelandart.org` | `currently_on_view=1` |
| Victoria and Albert Museum | `api.vam.ac.uk/v2` | `on_display_at=southken` |

Each museum's highlights are imported first. To add another museum, write an adapter in
`server/museums/` that exports `fetchOnView({ limit })` and `enrich(sourceId)`, then register it in
`server/museums/index.js`.

## Running it

Requires Node 22.5+, which provides the built-in `node:sqlite` module. Express is the only dependency.

```sh
npm install
npm run sync              # pulls 400 on-view works per museum into data/salon.db
npm run seed:demo         # optional: 5 demo members with diary entries and reviews
npm start                 # http://localhost:3000
```

`npm run sync -- --limit 1000 met aic` syncs specific museums with a larger cap. Add `--prune` to mark works that
are no longer returned as off view. Run sync on a schedule (for example, nightly cron) to follow gallery rotations.

`npm test` runs the API tests against an in-memory database.

## The link-only prototype (GitHub Pages)

GitHub Pages can't run a server, so the prototype runs the same API (`server/app.js`) inside the browser on
SQLite WebAssembly. Each deploy ships a snapshot of the catalog, plus the demo members, so the site
works from a plain link. Accounts, ratings and reviews are saved in the visitor's own browser (IndexedDB), so they
aren't shared between people and are reset when a new version is deployed. For a shared, multi-user site, run the
Node server.

Every push to `main` deploys the prototype through `.github/workflows/pages.yml`. To build it locally:

```sh
npm run sync && npm run seed:demo
npm run build:static -- --base /art-letterboxd/   # writes dist/
```

The browser shims for Express, `node:sqlite` and `node:crypto` are in `static/`.

## Features

- **Artwork pages**: large image, gallery location, museum details, Seen / Like / Want to see toggles, half-star ratings,
  ratings histogram, popular and recent reviews, activity from friends, and more works by the same artist.
- **Diary and reviews**: log a visit with a date, a rating, a like, an "I've seen this before" flag and an optional review.
- **Profiles**: four favourite artworks, recent activity, diary, reviews, seen, want to see, likes, lists, followers.
- **Social**: follow members, like reviews, and view the activity feed for everyone or only people you follow.
- **Lists**: ordered collections of artworks, such as a route through one museum.
- **Browse and search**: filter by museum, type and century; sort by popularity, rating, recent reviews or date;
  full-text search across titles, artists, media and cultures.

## Layout

```
server/        Express API, SQLite schema, session auth (scrypt + HttpOnly cookie)
server/museums Museum importers
scripts/       sync.js, seed-demo.js
public/        No-build frontend: plain ES modules and CSS
static/        Browser shims and entry point for the GitHub Pages prototype
test/          node:test API tests
```

## Licence

[MIT](LICENSE)
