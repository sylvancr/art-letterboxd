import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS artworks (
  id            TEXT PRIMARY KEY,          -- "<museum>:<source id>"
  museum        TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  artist        TEXT,
  artist_bio    TEXT,
  date_display  TEXT,
  year          INTEGER,
  medium        TEXT,
  dimensions    TEXT,
  department    TEXT,
  classification TEXT,
  culture       TEXT,
  gallery       TEXT,
  description   TEXT,
  credit        TEXT,
  image_url     TEXT,
  thumb_url     TEXT,
  source_url    TEXT,
  highlight     INTEGER NOT NULL DEFAULT 0,
  rank          INTEGER NOT NULL DEFAULT 0,  -- museum's own ordering, lower is more prominent
  on_view       INTEGER NOT NULL DEFAULT 1,
  enriched      INTEGER NOT NULL DEFAULT 0,
  synced_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS artworks_museum ON artworks(museum, on_view, rank);
CREATE INDEX IF NOT EXISTS artworks_year ON artworks(year);

CREATE VIRTUAL TABLE IF NOT EXISTS artworks_fts USING fts5(
  title, artist, medium, classification, culture, department,
  content='artworks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS artworks_ai AFTER INSERT ON artworks BEGIN
  INSERT INTO artworks_fts(rowid, title, artist, medium, classification, culture, department)
  VALUES (new.rowid, new.title, new.artist, new.medium, new.classification, new.culture, new.department);
END;
CREATE TRIGGER IF NOT EXISTS artworks_ad AFTER DELETE ON artworks BEGIN
  INSERT INTO artworks_fts(artworks_fts, rowid, title, artist, medium, classification, culture, department)
  VALUES ('delete', old.rowid, old.title, old.artist, old.medium, old.classification, old.culture, old.department);
END;
CREATE TRIGGER IF NOT EXISTS artworks_au AFTER UPDATE ON artworks BEGIN
  INSERT INTO artworks_fts(artworks_fts, rowid, title, artist, medium, classification, culture, department)
  VALUES ('delete', old.rowid, old.title, old.artist, old.medium, old.classification, old.culture, old.department);
  INSERT INTO artworks_fts(rowid, title, artist, medium, classification, culture, department)
  VALUES (new.rowid, new.title, new.artist, new.medium, new.classification, new.culture, new.department);
END;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-user state for an artwork, like Letterboxd's watched / like / rating / watchlist.
CREATE TABLE IF NOT EXISTS user_artworks (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  seen       INTEGER NOT NULL DEFAULT 0,
  liked      INTEGER NOT NULL DEFAULT 0,
  want       INTEGER NOT NULL DEFAULT 0,
  rating     REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, artwork_id)
);
CREATE INDEX IF NOT EXISTS user_artworks_art ON user_artworks(artwork_id);

-- Diary entries. An entry with a body is a review.
CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  seen_on    TEXT,
  rating     REAL,
  liked      INTEGER NOT NULL DEFAULT 0,
  body       TEXT,
  revisit    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS logs_art ON logs(artwork_id, created_at);
CREATE INDEX IF NOT EXISTS logs_user ON logs(user_id, created_at);

CREATE TABLE IF NOT EXISTS review_likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_id  INTEGER NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, log_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, position)
);

CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS list_items (
  list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  PRIMARY KEY (list_id, artwork_id)
);
`;

export function openDb(file = process.env.SALON_DB || 'data/salon.db') {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const ARTWORK_COLUMNS = [
  'id', 'museum', 'source_id', 'title', 'artist', 'artist_bio', 'date_display', 'year', 'medium',
  'dimensions', 'department', 'classification', 'culture', 'gallery', 'description', 'credit',
  'image_url', 'thumb_url', 'source_url', 'highlight', 'rank', 'enriched',
];

export function upsertArtworks(db, artworks) {
  const placeholders = ARTWORK_COLUMNS.map(c => `$${c}`).join(', ');
  // Never clobber an enriched description with a thinner one from a list endpoint.
  const updates = ARTWORK_COLUMNS.filter(c => c !== 'id')
    .map(c => ['description', 'medium', 'dimensions', 'credit', 'artist_bio'].includes(c)
      ? `${c} = COALESCE(excluded.${c}, ${c})`
      : c === 'enriched' ? 'enriched = MAX(enriched, excluded.enriched)'
      : `${c} = excluded.${c}`)
    .join(', ');
  const stmt = db.prepare(`
    INSERT INTO artworks (${ARTWORK_COLUMNS.join(', ')}, on_view, synced_at)
    VALUES (${placeholders}, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET ${updates}, on_view = 1, synced_at = datetime('now')
  `);
  tx(db, () => {
    for (const a of artworks) {
      const row = {};
      for (const c of ARTWORK_COLUMNS) row[`$${c}`] = a[c] ?? (c === 'highlight' || c === 'rank' || c === 'enriched' ? 0 : null);
      stmt.run(row);
    }
  });
}
