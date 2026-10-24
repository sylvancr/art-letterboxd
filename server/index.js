import { openDb } from './db.js';
import { createApp } from './app.js';

const db = openDb();
const port = Number(process.env.PORT) || 3000;
const { n } = db.prepare('SELECT COUNT(*) AS n FROM artworks').get();
if (!n) console.warn('The catalog is empty. Run `npm run sync` to pull artworks from the museums.');

createApp(db).listen(port, () => console.log(`Salon running at http://localhost:${port}`));
