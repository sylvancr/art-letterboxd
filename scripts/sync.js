// Pull artworks currently on view from each museum into the local catalog.
//   npm run sync                      # 400 per museum
//   npm run sync -- --limit 1000 met aic
//   npm run sync -- --prune           # mark works missing from this pull as off view
import { parseArgs } from 'node:util';
import { openDb, upsertArtworks } from '../server/db.js';
import { MUSEUMS } from '../server/museums/index.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { limit: { type: 'string', default: '400' }, prune: { type: 'boolean', default: false } },
});

const db = openDb();
const slugs = positionals.length ? positionals : Object.keys(MUSEUMS);
const limit = Number(values.limit);
let failed = false;

for (const slug of slugs) {
  const museum = MUSEUMS[slug];
  if (!museum) { console.error(`unknown museum "${slug}" (have: ${Object.keys(MUSEUMS).join(', ')})`); failed = true; continue; }
  const started = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    const artworks = await museum.fetchOnView({ limit, log: msg => process.stdout.write(`\r${msg}        `) });
    upsertArtworks(db, artworks);
    let pruned = 0;
    if (values.prune) {
      pruned = Number(db.prepare(`UPDATE artworks SET on_view = 0 WHERE museum = ? AND synced_at < ?`).run(slug, started).changes);
    }
    console.log(`\r${museum.name}: ${artworks.length} works on view${values.prune ? `, ${pruned} marked off view` : ''}        `);
  } catch (err) {
    failed = true;
    console.error(`\r${museum.name}: sync failed: ${err.message}`);
  }
}

const { n } = db.prepare('SELECT COUNT(*) AS n FROM artworks WHERE on_view = 1').get();
console.log(`catalog: ${n} artworks on view`);
process.exitCode = failed ? 1 : 0;
