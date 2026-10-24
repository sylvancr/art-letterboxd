// Build the no-server prototype for GitHub Pages into dist/.
// The API from server/app.js is bundled to run in the browser on SQLite WebAssembly,
// seeded from a snapshot of the local catalog (run `npm run sync` and optionally `npm run seed:demo` first).
//   npm run build:static -- --base /art-letterboxd/
import { parseArgs } from 'node:util';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = p => `${root}${p}`;
const { values } = parseArgs({ options: { base: { type: 'string', default: '/' }, db: { type: 'string', default: 'data/salon.db' } } });
const base = values.base.endsWith('/') ? values.base : `${values.base}/`;
if (!existsSync(values.db)) throw new Error(`No catalog at ${values.db}. Run \`npm run sync\` first.`);

rmSync(at('dist'), { recursive: true, force: true });
cpSync(at('public'), at('dist'), { recursive: true });

// ---------- API bundle ----------

const SHIMS = {
  'node:sqlite': 'static/sqlite-shim.js',
  'node:crypto': 'static/crypto-shim.js',
  'node:url': 'static/node-shims.js',
  'node:fs': 'static/node-shims.js',
  'node:path': 'static/node-shims.js',
  express: 'static/express-shim.js',
};
await build({
  entryPoints: [at('static/backend.js')],
  outfile: at('dist/js/backend.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  inject: [at('static/buffer-shim.js')],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.SALON_DB': 'undefined' },
  logLevel: 'warning',
  plugins: [{
    name: 'browser-shims',
    setup(b) {
      b.onResolve({ filter: /^(node:(sqlite|crypto|url|fs|path)|express)$/ }, args => ({ path: at(SHIMS[args.path]) }));
    },
  }],
});
cpSync(at('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'), at('dist/js/sqlite3.wasm'));

// ---------- database snapshot ----------

mkdirSync(at('dist/data'), { recursive: true });
const snapshot = at('dist/data/salon.db');
const src = new DatabaseSync(values.db);
src.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
src.close();
const snap = new DatabaseSync(snapshot);
snap.exec(`PRAGMA journal_mode = DELETE; DELETE FROM sessions; VACUUM;`);
const { n } = snap.prepare('SELECT COUNT(*) AS n FROM artworks WHERE on_view = 1').get();
snap.close();
const version = createHash('sha256').update(readFileSync(snapshot)).digest('hex').slice(0, 12);
writeFileSync(at('dist/data/version.txt'), version);

// ---------- pages ----------

const banner = `<div class="proto-banner">Prototype · Your account, ratings and reviews are saved in this browser only.
  <a href="https://github.com/sylvancr/art-letterboxd" target="_blank" rel="noopener">Source on GitHub</a></div>`;
const index = readFileSync(at('public/index.html'), 'utf8')
  .replace('<base href="/">', `<base href="${base}">`)
  .replace('<!--prototype-banner-->', banner)
  .replace('<script type="module" src="js/main.js"></script>',
    '<script type="module" src="js/backend.js"></script>\n  <script type="module" src="js/main.js"></script>');
writeFileSync(at('dist/index.html'), index);
writeFileSync(at('dist/404.html'), index); // GitHub Pages serves this for deep links like /art/met:123
writeFileSync(at('dist/.nojekyll'), '');

console.log(`dist/ built for ${base}: ${n} artworks, snapshot ${version}`);
