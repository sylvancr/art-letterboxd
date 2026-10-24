import express from 'express';
import { fileURLToPath } from 'node:url';
import { tx } from './db.js';
import { MUSEUMS, museumInfo } from './museums/index.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, sessionMiddleware, requireUser,
} from './auth.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const PAGE_SIZE = 48;

const CARD = `a.id, a.title, a.artist, a.date_display, a.year, a.museum, a.thumb_url, a.image_url, a.gallery`;
const USER = `u.username, u.display_name`;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const isRating = r => r === null || (typeof r === 'number' && r >= 0.5 && r <= 5 && Number.isInteger(r * 2));
const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
// Latest acceptable "seen on" date: tomorrow in UTC, so viewers ahead of UTC can log today.
const latestSeenOn = () => new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
const bool = v => (v ? 1 : 0);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Turn free text into a safe FTS5 prefix query: `van gogh` -> `"van"* "gogh"*`
function ftsQuery(q) {
  const terms = String(q ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.slice(0, 8).map(t => `"${t}"*`).join(' ');
}

export function createApp(db, { museums = MUSEUMS } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(sessionMiddleware(db));

  // Mutations must be JSON; browsers can't send that cross-site without a CORS preflight.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'Expected application/json'));
    }
    next();
  });

  const q = (sql) => db.prepare(sql);
  const viewerId = req => req.user?.id ?? 0;

  // ---------- shared queries ----------

  const getArtwork = q(`SELECT * FROM artworks WHERE id = ?`);
  const ensureArtwork = id => getArtwork.get(id) ?? fail(404, 'Artwork not found');

  const reviewSelect = `
    SELECT l.id, l.artwork_id, l.seen_on, l.rating, l.liked, l.body, l.revisit, l.created_at,
           ${USER},
           (SELECT COUNT(*) FROM review_likes rl WHERE rl.log_id = l.id) AS like_count,
           EXISTS (SELECT 1 FROM review_likes rl WHERE rl.log_id = l.id AND rl.user_id = $viewer) AS liked_by_me
    FROM logs l JOIN users u ON u.id = l.user_id`;
  const withArtwork = rows => rows.map(r => ({ ...r, artwork: cardById.get(r.artwork_id) }));
  const cardById = q(`SELECT ${CARD} FROM artworks a WHERE a.id = ?`);

  function stateFor(userId, artworkId) {
    return q(`SELECT seen, liked, want, rating FROM user_artworks WHERE user_id = ? AND artwork_id = ?`)
      .get(userId, artworkId) ?? { seen: 0, liked: 0, want: 0, rating: null };
  }

  function setState(userId, artworkId, patch) {
    const cur = stateFor(userId, artworkId);
    const next = { ...cur, ...patch };
    // Rating or liking something means you've seen it; seeing it takes it off your want-to-see.
    if (patch.rating != null || patch.liked) next.seen = 1;
    if (next.seen && !('want' in patch)) next.want = 0;
    if (patch.want) next.want = 1;
    q(`INSERT INTO user_artworks (user_id, artwork_id, seen, liked, want, rating, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id, artwork_id) DO UPDATE SET
         seen = excluded.seen, liked = excluded.liked, want = excluded.want,
         rating = excluded.rating, updated_at = excluded.updated_at`)
      .run(userId, artworkId, bool(next.seen), bool(next.liked), bool(next.want), next.rating ?? null);
    return stateFor(userId, artworkId);
  }

  function artworkStats(id) {
    const s = q(`SELECT
        COALESCE(SUM(seen), 0) AS seen, COALESCE(SUM(liked), 0) AS likes, COALESCE(SUM(want), 0) AS want,
        AVG(rating) AS avg_rating, COUNT(rating) AS ratings
      FROM user_artworks WHERE artwork_id = ?`).get(id);
    const histogram = Array(10).fill(0);
    for (const r of q(`SELECT rating, COUNT(*) AS n FROM user_artworks WHERE artwork_id = ? AND rating IS NOT NULL GROUP BY rating`).all(id)) {
      histogram[Math.round(r.rating * 2) - 1] = r.n;
    }
    const { reviews } = q(`SELECT COUNT(*) AS reviews FROM logs WHERE artwork_id = ? AND body <> ''`).get(id);
    const { lists } = q(`SELECT COUNT(DISTINCT list_id) AS lists FROM list_items WHERE artwork_id = ?`).get(id);
    return { ...s, histogram, reviews, lists };
  }

  async function maybeEnrich(art) {
    if (art.enriched) return art;
    const museum = museums[art.museum];
    try {
      const extra = await Promise.race([
        museum?.enrich?.(art.source_id),
        new Promise(r => setTimeout(() => r(undefined), 6000)),
      ]);
      if (extra === undefined) return art; // timed out; try again next view
      const fields = Object.entries(extra ?? {}).filter(([, v]) => v != null);
      const sets = fields.map(([k]) => `${k} = COALESCE(${k}, ?)`).concat('enriched = 1').join(', ');
      q(`UPDATE artworks SET ${sets} WHERE id = ?`).run(...fields.map(([, v]) => v), art.id);
      return getArtwork.get(art.id);
    } catch {
      return art;
    }
  }

  // Browse query shared by /artworks, museum pages and search.
  function browse({ museum, type, century, sort = 'popular', q: search, page = 1, viewer = 0, hideSeen = false }) {
    const where = ['a.on_view = 1'];
    const params = { $viewer: viewer };
    if (museum) { where.push('a.museum = $museum'); params.$museum = museum; }
    if (type) { where.push('a.classification = $type'); params.$type = type; }
    if (century !== undefined && century !== '' && Number.isFinite(Number(century))) {
      const c = Number(century);
      where.push('a.year >= $from AND a.year < $to');
      params.$from = c * 100; params.$to = c * 100 + 100;
    }
    if (search) {
      const fts = ftsQuery(search);
      if (!fts) return { items: [], total: 0, page: 1, pages: 0 };
      where.push('a.rowid IN (SELECT rowid FROM artworks_fts WHERE artworks_fts MATCH $fts)');
      params.$fts = fts;
    }
    if (hideSeen && viewer) {
      where.push('NOT EXISTS (SELECT 1 FROM user_artworks ux WHERE ux.artwork_id = a.id AND ux.user_id = $viewer AND ux.seen = 1)');
    }
    const order = {
      popular: 'stats.seen DESC, a.highlight DESC, a.rank ASC',
      rating: 'stats.avg_rating IS NULL, stats.avg_rating DESC, stats.ratings DESC, a.rank ASC',
      reviewed: 'stats.last_log IS NULL, stats.last_log DESC, a.rank ASC',
      oldest: 'a.year IS NULL, a.year ASC',
      newest: 'a.year IS NULL, a.year DESC',
      title: 'a.title COLLATE NOCASE ASC',
      shuffle: 'random()',
    }[sort] ?? 'stats.seen DESC, a.highlight DESC, a.rank ASC';
    const from = `FROM artworks a
      LEFT JOIN (
        SELECT artwork_id, SUM(seen) AS seen, AVG(rating) AS avg_rating, COUNT(rating) AS ratings,
               (SELECT MAX(created_at) FROM logs WHERE logs.artwork_id = ua.artwork_id) AS last_log
        FROM user_artworks ua GROUP BY artwork_id
      ) stats ON stats.artwork_id = a.id
      LEFT JOIN user_artworks mine ON mine.artwork_id = a.id AND mine.user_id = $viewer
      WHERE ${where.join(' AND ')}`;
    const { total } = q(`SELECT COUNT(*) AS total ${from}`).get(params);
    const pg = Math.max(1, Number(page) || 1);
    const items = q(`SELECT ${CARD}, stats.avg_rating, COALESCE(stats.seen, 0) AS seen_count,
        mine.seen AS my_seen, mine.liked AS my_liked, mine.want AS my_want, mine.rating AS my_rating
      ${from} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${(pg - 1) * PAGE_SIZE}`).all(params);
    return { items, total, page: pg, pages: Math.ceil(total / PAGE_SIZE) };
  }

  const userByName = name => q(`SELECT id, username, display_name, bio, created_at FROM users WHERE username = ?`).get(name)
    ?? fail(404, 'Member not found');

  const route = fn => async (req, res, next) => {
    try { res.json(await fn(req, res)); } catch (err) { next(err); }
  };

  // ---------- auth ----------

  app.post('/api/auth/signup', route((req, res) => {
    const username = text(req.body.username, 40);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[a-z0-9_]{2,20}$/i.test(username)) fail(400, 'Usernames are 2–20 letters, numbers or underscores.');
    if (password.length < 8) fail(400, 'Passwords need at least 8 characters.');
    if (q(`SELECT 1 FROM users WHERE username = ?`).get(username)) fail(409, 'That username is taken.');
    const display = text(req.body.display_name, 60) || username;
    const { lastInsertRowid } = q(`INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)`)
      .run(username, display, hashPassword(password));
    createSession(db, res, Number(lastInsertRowid));
    return { user: { username, display_name: display, bio: '' } };
  }));

  app.post('/api/auth/login', route((req, res) => {
    const row = q(`SELECT * FROM users WHERE username = ?`).get(text(req.body.username, 40));
    if (!row || !verifyPassword(String(req.body.password ?? ''), row.password_hash)) {
      fail(401, 'Wrong username or password.');
    }
    createSession(db, res, row.id);
    return { user: { username: row.username, display_name: row.display_name, bio: row.bio } };
  }));

  app.post('/api/auth/logout', route((req, res) => {
    destroySession(db, req, res);
    return { ok: true };
  }));

  app.get('/api/me', route(req => ({ user: req.user && {
    username: req.user.username, display_name: req.user.display_name, bio: req.user.bio,
  } })));

  app.patch('/api/me', requireUser, route(req => {
    const { display_name, bio, favorites } = req.body;
    tx(db, () => {
      if (display_name !== undefined) {
        q(`UPDATE users SET display_name = ? WHERE id = ?`).run(text(display_name, 60) || req.user.username, req.user.id);
      }
      if (bio !== undefined) q(`UPDATE users SET bio = ? WHERE id = ?`).run(text(bio, 500), req.user.id);
      if (favorites !== undefined) {
        if (!Array.isArray(favorites) || favorites.length > 4) fail(400, 'Pick up to four favourites.');
        q(`DELETE FROM favorites WHERE user_id = ?`).run(req.user.id);
        favorites.forEach((id, i) => {
          if (id) { ensureArtwork(id); q(`INSERT INTO favorites (user_id, position, artwork_id) VALUES (?, ?, ?)`).run(req.user.id, i, id); }
        });
      }
    });
    return { ok: true };
  }));

  // ---------- catalog ----------

  app.get('/api/museums', route(() => {
    const counts = Object.fromEntries(q(`SELECT museum, COUNT(*) AS n FROM artworks WHERE on_view = 1 GROUP BY museum`).all()
      .map(r => [r.museum, r.n]));
    return Object.keys(museums).map(slug => {
      const cover = q(`SELECT ${CARD} FROM artworks a WHERE museum = ? AND on_view = 1 ORDER BY highlight DESC, rank LIMIT 4`).all(slug);
      return { ...museumInfo(slug), count: counts[slug] ?? 0, cover };
    });
  }));

  app.get('/api/museums/:slug', route(req => {
    const info = museumInfo(req.params.slug) ?? fail(404, 'Museum not found');
    const stats = q(`SELECT COUNT(DISTINCT a.id) AS works,
        (SELECT COUNT(*) FROM logs l JOIN artworks x ON x.id = l.artwork_id WHERE x.museum = $m) AS logs,
        (SELECT COUNT(*) FROM logs l JOIN artworks x ON x.id = l.artwork_id WHERE x.museum = $m AND l.body <> '') AS reviews
      FROM artworks a WHERE a.museum = $m AND a.on_view = 1`).get({ $m: info.slug });
    const reviews = withArtwork(q(`${reviewSelect} JOIN artworks a ON a.id = l.artwork_id
      WHERE a.museum = $m AND l.body <> '' ORDER BY l.created_at DESC LIMIT 6`).all({ $m: info.slug, $viewer: viewerId(req) }));
    return { ...info, stats, reviews };
  }));

  app.get('/api/facets', route(req => {
    const where = req.query.museum ? 'AND museum = $m' : '';
    const p = req.query.museum ? { $m: String(req.query.museum) } : {};
    const types = q(`SELECT classification AS value, COUNT(*) AS n FROM artworks
      WHERE on_view = 1 AND classification IS NOT NULL ${where} GROUP BY classification ORDER BY n DESC LIMIT 40`).all(p);
    const centuries = q(`SELECT CAST(year / 100 AS INTEGER) - (year < 0 AND year % 100 <> 0) AS value, COUNT(*) AS n FROM artworks
      WHERE on_view = 1 AND year IS NOT NULL ${where} GROUP BY value HAVING n > 0 ORDER BY value DESC`).all(p);
    return { museums: Object.keys(museums).map(museumInfo), types, centuries };
  }));

  app.get('/api/artworks', route(req => browse({ ...req.query, viewer: viewerId(req), hideSeen: req.query.hide_seen === '1' })));

  app.get('/api/artworks/:id', route(async req => {
    const art = await maybeEnrich(ensureArtwork(req.params.id));
    const viewer = viewerId(req);
    const popular = q(`${reviewSelect} WHERE l.artwork_id = $id AND l.body <> ''
      ORDER BY like_count DESC, l.created_at DESC LIMIT 6`).all({ $id: art.id, $viewer: viewer });
    const recent = q(`${reviewSelect} WHERE l.artwork_id = $id AND l.body <> ''
      ORDER BY l.created_at DESC LIMIT 6`).all({ $id: art.id, $viewer: viewer });
    const friends = viewer ? q(`SELECT ${USER}, ua.rating, ua.liked,
        EXISTS (SELECT 1 FROM logs l WHERE l.user_id = u.id AND l.artwork_id = ua.artwork_id AND l.body <> '') AS reviewed
      FROM follows f JOIN users u ON u.id = f.followee_id
      JOIN user_artworks ua ON ua.user_id = u.id AND ua.artwork_id = ? AND ua.seen = 1
      WHERE f.follower_id = ? ORDER BY ua.updated_at DESC LIMIT 24`).all(art.id, viewer) : [];
    const more = q(`SELECT ${CARD} FROM artworks a WHERE a.on_view = 1 AND a.id <> ? AND
        ((a.artist IS NOT NULL AND a.artist = ?) OR (a.museum = ? AND a.gallery IS NOT NULL AND a.gallery = ?))
      ORDER BY (a.artist = ?) DESC, a.highlight DESC, a.rank LIMIT 12`).all(art.id, art.artist, art.museum, art.gallery, art.artist);
    const myLogs = viewer ? q(`SELECT id, seen_on, rating, liked, body, revisit, created_at FROM logs
      WHERE user_id = ? AND artwork_id = ? ORDER BY COALESCE(seen_on, created_at) DESC`).all(viewer, art.id) : [];
    const myLists = viewer ? q(`SELECT l.id, l.name, EXISTS (SELECT 1 FROM list_items li WHERE li.list_id = l.id AND li.artwork_id = ?) AS has
      FROM lists l WHERE l.user_id = ? ORDER BY l.updated_at DESC`).all(art.id, viewer) : [];
    return {
      artwork: { ...art, museum_info: museumInfo(art.museum) },
      stats: artworkStats(art.id),
      me: viewer ? { ...stateFor(viewer, art.id), logs: myLogs, lists: myLists } : null,
      reviews: { popular, recent },
      friends,
      more,
    };
  }));

  app.get('/api/artworks/:id/reviews', route(req => {
    ensureArtwork(req.params.id);
    const order = req.query.sort === 'popular' ? 'like_count DESC, l.created_at DESC' : 'l.created_at DESC';
    return q(`${reviewSelect} WHERE l.artwork_id = $id AND l.body <> '' ORDER BY ${order} LIMIT 100`)
      .all({ $id: req.params.id, $viewer: viewerId(req) });
  }));

  app.put('/api/artworks/:id/state', requireUser, route(req => {
    ensureArtwork(req.params.id);
    const patch = {};
    for (const k of ['seen', 'liked', 'want']) if (k in req.body) patch[k] = bool(req.body[k]);
    if ('rating' in req.body) {
      if (!isRating(req.body.rating)) fail(400, 'Ratings go from half a star to five stars.');
      patch.rating = req.body.rating;
    }
    if (patch.seen === 0) Object.assign(patch, { liked: 0, rating: null });
    return setState(req.user.id, req.params.id, patch);
  }));

  // ---------- diary & reviews ----------

  function readLogBody(body) {
    const rating = body.rating ?? null;
    if (!isRating(rating)) fail(400, 'Ratings go from half a star to five stars.');
    const seenOn = body.seen_on ?? null;
    if (seenOn !== null && !isDate(seenOn)) fail(400, 'Invalid date.');
    if (seenOn && seenOn > latestSeenOn()) fail(400, "You can't have seen it in the future.");
    return { rating, seen_on: seenOn, liked: bool(body.liked), body: text(body.body, 8000), revisit: bool(body.revisit) };
  }

  app.post('/api/artworks/:id/logs', requireUser, route(req => {
    ensureArtwork(req.params.id);
    const log = readLogBody(req.body);
    return tx(db, () => {
      const { lastInsertRowid } = q(`INSERT INTO logs (user_id, artwork_id, seen_on, rating, liked, body, revisit)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, req.params.id, log.seen_on, log.rating, log.liked, log.body, log.revisit);
      const patch = { seen: 1 };
      if (log.rating != null) patch.rating = log.rating;
      if (log.liked) patch.liked = 1;
      const state = setState(req.user.id, req.params.id, patch);
      return { id: Number(lastInsertRowid), state };
    });
  }));

  const ownLog = (req) => {
    const log = q(`SELECT * FROM logs WHERE id = ?`).get(Number(req.params.id)) ?? fail(404, 'Entry not found');
    if (log.user_id !== req.user.id) fail(403, "That's not your entry.");
    return log;
  };

  app.get('/api/logs/:id', route(req => {
    const log = q(`${reviewSelect} WHERE l.id = $id`).get({ $id: Number(req.params.id), $viewer: viewerId(req) })
      ?? fail(404, 'Entry not found');
    const likers = q(`SELECT ${USER} FROM review_likes rl JOIN users u ON u.id = rl.user_id WHERE rl.log_id = ? LIMIT 20`).all(log.id);
    return { ...log, artwork: cardById.get(log.artwork_id), likers };
  }));

  app.patch('/api/logs/:id', requireUser, route(req => {
    const existing = ownLog(req);
    const log = readLogBody({ ...existing, ...req.body });
    q(`UPDATE logs SET seen_on = ?, rating = ?, liked = ?, body = ?, revisit = ? WHERE id = ?`)
      .run(log.seen_on, log.rating, log.liked, log.body, log.revisit, existing.id);
    if ('rating' in req.body && log.rating != null) setState(req.user.id, existing.artwork_id, { rating: log.rating });
    return { ok: true };
  }));

  app.delete('/api/logs/:id', requireUser, route(req => {
    ownLog(req);
    q(`DELETE FROM logs WHERE id = ?`).run(Number(req.params.id));
    return { ok: true };
  }));

  app.post('/api/logs/:id/like', requireUser, route(req => {
    q(`SELECT 1 FROM logs WHERE id = ?`).get(Number(req.params.id)) ?? fail(404, 'Entry not found');
    q(`INSERT OR IGNORE INTO review_likes (user_id, log_id) VALUES (?, ?)`).run(req.user.id, Number(req.params.id));
    return { ok: true };
  }));

  app.delete('/api/logs/:id/like', requireUser, route(req => {
    q(`DELETE FROM review_likes WHERE user_id = ? AND log_id = ?`).run(req.user.id, Number(req.params.id));
    return { ok: true };
  }));

  // ---------- home & activity ----------

  app.get('/api/home', route(req => {
    const viewer = viewerId(req);
    const trending = q(`SELECT ${CARD}, COUNT(act.artwork_id) AS activity FROM artworks a
      LEFT JOIN (
        SELECT artwork_id FROM user_artworks WHERE updated_at > datetime('now', '-7 days') AND seen = 1
        UNION ALL SELECT artwork_id FROM logs WHERE created_at > datetime('now', '-7 days')
      ) act ON act.artwork_id = a.id
      WHERE a.on_view = 1 GROUP BY a.id ORDER BY activity DESC, a.highlight DESC, a.rank ASC LIMIT 12`).all();
    const reviews = withArtwork(q(`${reviewSelect} WHERE l.body <> '' ORDER BY l.created_at DESC LIMIT 8`).all({ $viewer: viewer }));
    const popularReviews = withArtwork(q(`${reviewSelect} WHERE l.body <> '' AND l.created_at > datetime('now', '-30 days')
      ORDER BY like_count DESC, l.created_at DESC LIMIT 6`).all({ $viewer: viewer }));
    const friends = viewer ? withArtwork(q(`${reviewSelect} JOIN follows f ON f.followee_id = l.user_id AND f.follower_id = $viewer
      ORDER BY l.created_at DESC LIMIT 12`).all({ $viewer: viewer })) : [];
    const backdrop = q(`SELECT ${CARD} FROM artworks a WHERE on_view = 1 AND highlight = 1 AND museum IN ('aic', 'met', 'cleveland')
      ORDER BY random() LIMIT 1`).get() ?? null;
    const perMuseum = Object.keys(museums).map(slug => ({
      museum: museumInfo(slug),
      items: q(`SELECT ${CARD} FROM artworks a WHERE museum = ? AND on_view = 1 ORDER BY highlight DESC, random() LIMIT 6`).all(slug),
    })).filter(m => m.items.length);
    const lists = recentLists(4);
    const totals = q(`SELECT (SELECT COUNT(*) FROM artworks WHERE on_view = 1) AS artworks,
      (SELECT COUNT(*) FROM users) AS members, (SELECT COUNT(*) FROM logs) AS logs`).get();
    return { trending, reviews, popularReviews, friends, backdrop, perMuseum, lists, totals };
  }));

  app.get('/api/activity', route(req => {
    const viewer = viewerId(req);
    const following = req.query.scope === 'following' && viewer;
    const join = following ? 'JOIN follows f ON f.followee_id = l.user_id AND f.follower_id = $viewer' : '';
    const before = req.query.before ? 'WHERE l.id < $before' : '';
    const params = { $viewer: viewer, ...(req.query.before ? { $before: Number(req.query.before) } : {}) };
    return withArtwork(q(`${reviewSelect} ${join} ${before} ORDER BY l.id DESC LIMIT 40`).all(params));
  }));

  // ---------- members ----------

  app.get('/api/users', route(req => {
    return q(`SELECT ${USER}, u.bio,
        (SELECT COUNT(*) FROM user_artworks WHERE user_id = u.id AND seen = 1) AS seen,
        (SELECT COUNT(*) FROM logs WHERE user_id = u.id AND body <> '') AS reviews,
        (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) AS followers,
        EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = u.id) AS following
      FROM users u ORDER BY reviews DESC, seen DESC, u.created_at DESC LIMIT 60`).all(viewerId(req));
  }));

  app.get('/api/users/:username', route(req => {
    const user = userByName(req.params.username);
    const viewer = viewerId(req);
    const stats = q(`SELECT
        (SELECT COUNT(*) FROM user_artworks WHERE user_id = $u AND seen = 1) AS seen,
        (SELECT COUNT(DISTINCT artwork_id) FROM logs WHERE user_id = $u AND strftime('%Y', COALESCE(seen_on, created_at)) = strftime('%Y', 'now')) AS this_year,
        (SELECT COUNT(*) FROM logs WHERE user_id = $u AND body <> '') AS reviews,
        (SELECT COUNT(*) FROM lists WHERE user_id = $u) AS lists,
        (SELECT COUNT(*) FROM follows WHERE follower_id = $u) AS following,
        (SELECT COUNT(*) FROM follows WHERE followee_id = $u) AS followers,
        (SELECT COUNT(*) FROM user_artworks WHERE user_id = $u AND want = 1) AS want,
        (SELECT COUNT(*) FROM user_artworks WHERE user_id = $u AND liked = 1) AS likes`).get({ $u: user.id });
    const histogram = Array(10).fill(0);
    for (const r of q(`SELECT rating, COUNT(*) AS n FROM user_artworks WHERE user_id = ? AND rating IS NOT NULL GROUP BY rating`).all(user.id)) {
      histogram[Math.round(r.rating * 2) - 1] = r.n;
    }
    const favorites = q(`SELECT f.position, ${CARD} FROM favorites f JOIN artworks a ON a.id = f.artwork_id
      WHERE f.user_id = ? ORDER BY f.position`).all(user.id);
    const recent = q(`SELECT ${CARD}, l.rating, l.liked, l.body <> '' AS reviewed, l.id AS log_id FROM logs l
      JOIN artworks a ON a.id = l.artwork_id WHERE l.user_id = ? ORDER BY COALESCE(l.seen_on, l.created_at) DESC, l.id DESC LIMIT 8`).all(user.id);
    const reviews = withArtwork(q(`${reviewSelect} WHERE l.user_id = $u AND l.body <> '' ORDER BY l.created_at DESC LIMIT 4`)
      .all({ $u: user.id, $viewer: viewer }));
    const museumsSeen = q(`SELECT a.museum, COUNT(*) AS n FROM user_artworks ua JOIN artworks a ON a.id = ua.artwork_id
      WHERE ua.user_id = ? AND ua.seen = 1 GROUP BY a.museum ORDER BY n DESC`).all(user.id)
      .map(r => ({ ...museumInfo(r.museum), n: r.n }));
    const isFollowing = viewer ? !!q(`SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`).get(viewer, user.id) : false;
    return { user, stats, histogram, favorites, recent, reviews, museumsSeen, isFollowing, isMe: viewer === user.id };
  }));

  app.get('/api/users/:username/:tab', route(req => {
    const user = userByName(req.params.username);
    const viewer = viewerId(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = `LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
    switch (req.params.tab) {
      case 'diary':
        return q(`SELECT l.id, l.seen_on, l.created_at, l.rating, l.liked, l.revisit, l.body <> '' AS reviewed, ${CARD}
          FROM logs l JOIN artworks a ON a.id = l.artwork_id WHERE l.user_id = ?
          ORDER BY COALESCE(l.seen_on, date(l.created_at)) DESC, l.id DESC ${limit}`).all(user.id);
      case 'reviews':
        return withArtwork(q(`${reviewSelect} WHERE l.user_id = $u AND l.body <> '' ORDER BY l.created_at DESC ${limit}`)
          .all({ $u: user.id, $viewer: viewer }));
      case 'seen':
      case 'want':
      case 'likes': {
        const col = { seen: 'seen', want: 'want', likes: 'liked' }[req.params.tab];
        return q(`SELECT ${CARD}, ua.rating, ua.liked FROM user_artworks ua JOIN artworks a ON a.id = ua.artwork_id
          WHERE ua.user_id = ? AND ua.${col} = 1 ORDER BY ua.updated_at DESC ${limit}`).all(user.id);
      }
      case 'lists':
        return listSummaries(`WHERE l.user_id = ?`, [user.id], `ORDER BY l.updated_at DESC ${limit}`);
      case 'following':
      case 'followers': {
        const [me, them] = req.params.tab === 'following' ? ['follower_id', 'followee_id'] : ['followee_id', 'follower_id'];
        return q(`SELECT ${USER}, u.bio,
            (SELECT COUNT(*) FROM user_artworks WHERE user_id = u.id AND seen = 1) AS seen,
            (SELECT COUNT(*) FROM logs WHERE user_id = u.id AND body <> '') AS reviews,
            EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = ? AND x.followee_id = u.id) AS following
          FROM follows f JOIN users u ON u.id = f.${them} WHERE f.${me} = ? ORDER BY f.created_at DESC ${limit}`).all(viewer, user.id);
      }
      default:
        fail(404, 'Unknown tab');
    }
  }));

  app.post('/api/users/:username/follow', requireUser, route(req => {
    const user = userByName(req.params.username);
    if (user.id === req.user.id) fail(400, "You can't follow yourself.");
    q(`INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)`).run(req.user.id, user.id);
    return { following: true };
  }));

  app.delete('/api/users/:username/follow', requireUser, route(req => {
    const user = userByName(req.params.username);
    q(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`).run(req.user.id, user.id);
    return { following: false };
  }));

  // ---------- lists ----------

  function listSummaries(where, params, tail) {
    return q(`SELECT l.id, l.name, l.description, l.updated_at, ${USER},
        (SELECT COUNT(*) FROM list_items WHERE list_id = l.id) AS count
      FROM lists l JOIN users u ON u.id = l.user_id ${where} ${tail}`).all(...params)
      .map(l => ({ ...l, preview: q(`SELECT ${CARD} FROM list_items li JOIN artworks a ON a.id = li.artwork_id
          WHERE li.list_id = ? ORDER BY li.position LIMIT 5`).all(l.id) }));
  }
  const recentLists = n => listSummaries(`WHERE EXISTS (SELECT 1 FROM list_items WHERE list_id = l.id)`, [], `ORDER BY l.updated_at DESC LIMIT ${n}`);

  const ownList = req => {
    const list = q(`SELECT * FROM lists WHERE id = ?`).get(Number(req.params.id)) ?? fail(404, 'List not found');
    if (list.user_id !== req.user.id) fail(403, "That's not your list.");
    return list;
  };
  const touchList = id => q(`UPDATE lists SET updated_at = datetime('now') WHERE id = ?`).run(id);
  const addToList = (listId, artworkId) => {
    ensureArtwork(artworkId);
    q(`INSERT OR IGNORE INTO list_items (list_id, artwork_id, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM list_items WHERE list_id = ?))`).run(listId, artworkId, listId);
  };

  app.get('/api/lists', route(() => recentLists(48)));

  app.post('/api/lists', requireUser, route(req => {
    const name = text(req.body.name, 120) || fail(400, 'Give your list a name.');
    return tx(db, () => {
      const { lastInsertRowid } = q(`INSERT INTO lists (user_id, name, description) VALUES (?, ?, ?)`)
        .run(req.user.id, name, text(req.body.description, 2000));
      const id = Number(lastInsertRowid);
      for (const artworkId of Array.isArray(req.body.artwork_ids) ? req.body.artwork_ids.slice(0, 500) : []) addToList(id, artworkId);
      return { id };
    });
  }));

  app.get('/api/lists/:id', route(req => {
    const list = q(`SELECT l.*, ${USER} FROM lists l JOIN users u ON u.id = l.user_id WHERE l.id = ?`).get(Number(req.params.id))
      ?? fail(404, 'List not found');
    const items = q(`SELECT ${CARD}, li.position FROM list_items li JOIN artworks a ON a.id = li.artwork_id
      WHERE li.list_id = ? ORDER BY li.position`).all(list.id);
    const { user_id, ...rest } = list;
    return { ...rest, items, isMine: user_id === viewerId(req) };
  }));

  app.patch('/api/lists/:id', requireUser, route(req => {
    const list = ownList(req);
    const name = req.body.name !== undefined ? text(req.body.name, 120) || fail(400, 'Give your list a name.') : list.name;
    const description = req.body.description !== undefined ? text(req.body.description, 2000) : list.description;
    q(`UPDATE lists SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`).run(name, description, list.id);
    return { ok: true };
  }));

  app.delete('/api/lists/:id', requireUser, route(req => {
    q(`DELETE FROM lists WHERE id = ?`).run(ownList(req).id);
    return { ok: true };
  }));

  app.post('/api/lists/:id/items', requireUser, route(req => {
    const list = ownList(req);
    addToList(list.id, String(req.body.artwork_id ?? ''));
    touchList(list.id);
    return { ok: true };
  }));

  app.delete('/api/lists/:id/items/:artworkId', requireUser, route(req => {
    const list = ownList(req);
    q(`DELETE FROM list_items WHERE list_id = ? AND artwork_id = ?`).run(list.id, req.params.artworkId);
    touchList(list.id);
    return { ok: true };
  }));

  // ---------- search ----------

  app.get('/api/search', route(req => {
    const term = String(req.query.q ?? '').trim();
    if (!term) return { artworks: [], artists: [], members: [], lists: [] };
    const artworks = browse({ q: term, viewer: viewerId(req), sort: 'popular' });
    const fts = ftsQuery(term);
    const artists = fts ? q(`SELECT a.artist AS name, COUNT(*) AS n FROM artworks a
      WHERE a.on_view = 1 AND a.artist IS NOT NULL AND a.rowid IN (SELECT rowid FROM artworks_fts WHERE artworks_fts MATCH $fts)
      GROUP BY a.artist ORDER BY n DESC LIMIT 8`).all({ $fts: `artist : (${fts})` }) : [];
    const like = `%${term.replace(/[%_\\]/g, m => `\\${m}`)}%`;
    const members = q(`SELECT ${USER} FROM users u WHERE u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' LIMIT 8`).all(like, like);
    const lists = listSummaries(`WHERE l.name LIKE ? ESCAPE '\\'`, [like], 'ORDER BY l.updated_at DESC LIMIT 6');
    return { artworks, artists, members, lists };
  }));

  app.get('/api/artists/:name', route(req => {
    const items = q(`SELECT ${CARD}, a.artist_bio FROM artworks a WHERE a.artist = ? AND a.on_view = 1
      ORDER BY a.year IS NULL, a.year`).all(req.params.name);
    if (!items.length) fail(404, 'No works on view by that artist');
    return { name: req.params.name, bio: items.find(i => i.artist_bio)?.artist_bio ?? null, items };
  }));

  // ---------- static & errors ----------

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile('index.html', { root: PUBLIC_DIR }));

  app.use((err, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : err.message });
  });

  return app;
}
