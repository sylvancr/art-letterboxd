import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertArtworks } from '../server/db.js';
import { createApp } from '../server/app.js';
import { normalize as normalizeAic } from '../server/museums/aic.js';
import { flipName } from '../server/museums/vam.js';
import { toYear } from '../server/museums/http.js';

const art = (id, extra = {}) => ({
  id: `met:${id}`, museum: 'met', source_id: String(id), title: `Work ${id}`, artist: 'Vincent van Gogh',
  year: 1889, classification: 'Painting', thumb_url: 'x', image_url: 'x', highlight: 0, rank: id, enriched: 1, ...extra,
});

let server, base;
before(async () => {
  const db = openDb(':memory:');
  upsertArtworks(db, [art(1, { title: 'Wheat Field with Cypresses' }), art(2, { artist: 'Claude Monet', title: 'Bridge over a Pond of Water Lilies' }), art(3)]);
  server = createApp(db).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie && { cookie }), ...(method !== 'GET' && { 'content-type': 'application/json' }) },
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

test('signup, log a review with a rating, and see it on the artwork', async () => {
  const ana = client();
  assert.equal((await ana('/auth/signup', { method: 'POST', body: { username: 'ana', password: 'longenough' } })).status, 200);
  assert.equal((await ana('/me')).data.user.username, 'ana');

  await ana('/artworks/met:1/state', { method: 'PUT', body: { want: true } });
  const log = await ana('/artworks/met:1/logs', { method: 'POST', body: { rating: 4.5, liked: true, body: 'Swirling.', seen_on: '2026-01-02' } });
  assert.equal(log.status, 200);
  // Logging marks it seen, records the rating and like, and clears want-to-see.
  assert.deepEqual({ ...log.data.state }, { seen: 1, liked: 1, want: 0, rating: 4.5 });

  const page = (await ana('/artworks/met:1')).data;
  assert.equal(page.stats.seen, 1);
  assert.equal(page.stats.avg_rating, 4.5);
  assert.equal(page.stats.histogram[8], 1);
  assert.equal(page.reviews.recent[0].body, 'Swirling.');
  assert.equal(page.me.logs.length, 1);
});

test('rejects bad ratings, future dates and anonymous writes', async () => {
  const bo = client();
  await bo('/auth/signup', { method: 'POST', body: { username: 'bo', password: 'longenough' } });
  assert.equal((await bo('/artworks/met:2/state', { method: 'PUT', body: { rating: 4.2 } })).status, 400);
  assert.equal((await bo('/artworks/met:2/logs', { method: 'POST', body: { seen_on: '2999-01-01' } })).status, 400);
  assert.equal((await client()('/artworks/met:2/state', { method: 'PUT', body: { seen: true } })).status, 401);
  const res = await fetch(`${base}/artworks/met:2/state`, { method: 'PUT', body: 'seen=1' });
  assert.equal(res.status, 415);
});

test('cannot edit someone else\'s entry; can like their review', async () => {
  const cy = client();
  const dee = client();
  await cy('/auth/signup', { method: 'POST', body: { username: 'cy', password: 'longenough' } });
  await dee('/auth/signup', { method: 'POST', body: { username: 'dee', password: 'longenough' } });
  const { data } = await cy('/artworks/met:3/logs', { method: 'POST', body: { body: 'Fine.' } });
  assert.equal((await dee(`/logs/${data.id}`, { method: 'PATCH', body: { body: 'hacked' } })).status, 403);
  assert.equal((await dee(`/logs/${data.id}/like`, { method: 'POST' })).status, 200);
  assert.equal((await dee(`/logs/${data.id}`)).data.like_count, 1);
});

test('follow feed, lists and favourites', async () => {
  const ed = client();
  await ed('/auth/signup', { method: 'POST', body: { username: 'ed', password: 'longenough' } });
  await ed('/users/ana/follow', { method: 'POST' });
  const feed = (await ed('/activity?scope=following')).data;
  assert.ok(feed.length >= 1 && feed.every(r => r.username === 'ana'));

  const { data: list } = await ed('/lists', { method: 'POST', body: { name: 'Van Gogh in NYC', artwork_ids: ['met:1', 'met:3'] } });
  assert.equal((await ed(`/lists/${list.id}`)).data.items.length, 2);
  assert.equal((await client()(`/lists/${list.id}/items`, { method: 'POST', body: { artwork_id: 'met:2' } })).status, 401);

  await ed('/me', { method: 'PATCH', body: { favorites: ['met:2', null, 'met:1'] } });
  const profile = (await ed('/users/ed')).data;
  assert.deepEqual(profile.favorites.map(f => [f.position, f.id]), [[0, 'met:2'], [2, 'met:1']]);
  assert.equal(profile.stats.following, 1);
});

test('search and browse filters', async () => {
  const c = client();
  const hits = (await c('/search?q=monet')).data;
  assert.deepEqual(hits.artworks.items.map(a => a.id), ['met:2']);
  assert.equal(hits.artists[0].name, 'Claude Monet');
  assert.equal((await c('/search?q=wheat%20cyp')).data.artworks.items[0].id, 'met:1');
  assert.equal((await c('/artworks?century=18')).data.total, 3);
  assert.equal((await c('/artworks?century=17')).data.total, 0);
  // FTS syntax in user input is treated as plain text.
  assert.equal((await c('/search?q=%22%20OR%20*')).status, 200);
});

test('museum record normalisation', () => {
  const a = normalizeAic({
    id: 1, title: 'Buddha', image_id: 'abc', artist_title: null,
    artist_display: 'India\nNagapattinam, Tamil Nadu', date_start: 1101,
  });
  assert.equal(a.artist, null);
  assert.equal(a.culture, 'India');
  const b = normalizeAic({ id: 2, title: 'The Bedroom', image_id: 'x', artist_title: 'Vincent van Gogh', artist_display: 'Vincent van Gogh (Dutch, 1853–1890)' });
  assert.equal(b.artist_bio, 'Dutch, 1853–1890');
  assert.equal(normalizeAic({ id: 3, title: 'No image' }), null);
  assert.equal(flipName('Brunias, Agostino'), 'Agostino Brunias');
  assert.equal(flipName('Unknown'), null);
  assert.equal(toYear('ca. 1600'), 1600);
  assert.equal(toYear('1688-1689'), 1688);
});
