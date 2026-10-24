// Optional: fill a local catalog with a few demo members and diary entries so the
// social parts of the UI have something to show. Every demo account says so in its bio.
//   npm run seed:demo
import { openDb, tx } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const db = openDb();
const art = db.prepare(`SELECT id, title, museum FROM artworks WHERE on_view = 1 ORDER BY highlight DESC, rank LIMIT 120`).all();
if (art.length < 20) {
  console.error('Run `npm run sync` first — the catalog is nearly empty.');
  process.exit(1);
}

const PEOPLE = [
  ['mira', 'Mira K.', 'Weekend museum wanderer. Partial to anything with gold leaf.'],
  ['theo_v', 'Theo', 'Painter. I go for the brushwork and stay for the benches.'],
  ['juniper', 'Juniper Ade', 'Textile nerd. Will read every wall label.'],
  ['sam_sees', 'Sam', 'One gallery per lunch break.'],
  ['lucia', 'Lucía Romero', 'Art history student — mostly here for the Baroque.'],
];

const REVIEWS = [
  "Photographs don't prepare you for the scale. Stood in front of it for twenty minutes and kept finding new corners.",
  'The colour in person is completely different from every reproduction I have seen. Worth the trip on its own.',
  'Quietly the best thing in the room. Everyone walks past it to get to the famous one next door.',
  'Technically dazzling, emotionally a little cold. I admired it more than I loved it.',
  'Go early. The light from the gallery windows in the morning does something wonderful to the surface.',
  'I came for something else and left thinking only about this.',
  "The label undersells it. Look closely at the edges — that's where the real drama is.",
  'Smaller than I expected, which somehow makes it more intimate.',
  'Not my period at all, but the craftsmanship won me over.',
  'Third visit, still finding details. A comfort piece.',
];

const rand = (n) => Math.floor(Math.random() * n);
const pick = (xs) => xs[rand(xs.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

tx(db, () => {
  const ids = PEOPLE.map(([username, name, bio]) => {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return existing.id;
    return Number(db.prepare('INSERT INTO users (username, display_name, bio, password_hash) VALUES (?, ?, ?, ?)')
      .run(username, name, `${bio} (Demo account.)`, hashPassword(`demo-${username}`)).lastInsertRowid);
  });

  const state = db.prepare(`INSERT INTO user_artworks (user_id, artwork_id, seen, liked, want, rating) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET seen = excluded.seen, liked = excluded.liked, want = excluded.want, rating = excluded.rating`);
  const log = db.prepare(`INSERT INTO logs (user_id, artwork_id, seen_on, rating, liked, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`);

  for (const userId of ids) {
    const seen = [...art].sort(() => Math.random() - 0.5).slice(0, 18);
    seen.forEach((a, i) => {
      const rating = (5 + rand(6)) / 2; // 2.5 – 5
      const liked = rating >= 4 && Math.random() < 0.6 ? 1 : 0;
      const ago = rand(25);
      state.run(userId, a.id, 1, liked, 0, rating);
      log.run(userId, a.id, daysAgo(ago), rating, liked, i < 4 ? pick(REVIEWS) : '', `-${ago} days`);
    });
    const seenIds = new Set(seen.map(a => a.id));
    const unseen = art.filter(a => !seenIds.has(a.id)).sort(() => Math.random() - 0.5).slice(0, 6);
    for (const a of unseen) state.run(userId, a.id, 0, 0, 1, null);
  }

  // Everyone follows a couple of people, and likes a few reviews.
  const follow = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)');
  ids.forEach((id, i) => { follow.run(id, ids[(i + 1) % ids.length]); follow.run(id, ids[(i + 2) % ids.length]); });
  const reviews = db.prepare(`SELECT id, user_id FROM logs WHERE body <> '' AND user_id IN (${ids.join(',')})`).all();
  const like = db.prepare('INSERT OR IGNORE INTO review_likes (user_id, log_id) VALUES (?, ?)');
  for (const r of reviews) for (const id of ids) if (id !== r.user_id && Math.random() < 0.35) like.run(id, r.id);

  const [mira, theo] = ids;
  const list = (userId, name, description, items) => {
    const id = Number(db.prepare('INSERT INTO lists (user_id, name, description) VALUES (?, ?, ?)').run(userId, name, description).lastInsertRowid);
    items.forEach((a, i) => db.prepare('INSERT OR IGNORE INTO list_items (list_id, artwork_id, position) VALUES (?, ?, ?)').run(id, a.id, i));
  };
  if (!db.prepare('SELECT 1 FROM lists WHERE user_id = ?').get(mira)) {
    list(mira, 'If you only have an hour at the Art Institute', 'A route that hits the essentials without running.', art.filter(a => a.museum === 'aic').slice(0, 8));
    list(theo, 'Paintings that made me want to paint', '', art.filter((_, i) => i % 7 === 0).slice(0, 10));
  }
});

console.log(`Seeded ${PEOPLE.length} demo members. Sign in as any of them with password demo-<username>.`);
