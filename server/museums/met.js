import { getJson, mapLimit, clean, toYear } from './http.js';

const API = 'https://collectionapi.metmuseum.org/public/collection';

async function searchIds(params, limit) {
  const ids = [];
  for (let offset = 0; ids.length < limit; offset += 500) {
    const qs = new URLSearchParams({ q: '*', isOnView: 'true', hasImages: 'true', ...params, limit: 500, offset });
    const page = await getJson(`${API}/v1.1/search?${qs}`);
    const batch = page?.objectIDs ?? [];
    ids.push(...batch);
    if (batch.length < 500) break;
  }
  return ids;
}

export function normalize(o, rank = 0) {
  if (!o?.primaryImageSmall || !o.title) return null;
  return {
    id: `met:${o.objectID}`,
    museum: 'met',
    source_id: String(o.objectID),
    title: o.title,
    artist: clean(o.artistDisplayName),
    artist_bio: clean(o.artistDisplayBio),
    date_display: clean(o.objectDate),
    year: toYear(o.objectBeginDate),
    medium: clean(o.medium),
    dimensions: clean(o.dimensions),
    department: clean(o.department),
    classification: clean(o.classification || o.objectName),
    culture: clean(o.culture || o.country),
    gallery: o.GalleryNumber ? `Gallery ${o.GalleryNumber}` : null,
    description: null,
    credit: clean(o.creditLine),
    image_url: o.primaryImageSmall,
    thumb_url: o.primaryImageSmall,
    source_url: o.objectURL,
    highlight: o.isHighlight ? 1 : 0,
    rank,
    enriched: 1,
  };
}

// Met highlights first, then the rest of what's on view, until `limit` usable records.
export async function fetchOnView({ limit = 500, log = () => {} } = {}) {
  const highlights = await searchIds({ isHighlight: 'true' }, limit * 2);
  const rest = highlights.length < limit * 1.5 ? await searchIds({}, limit * 2) : [];
  const seen = new Set();
  const ids = [...highlights, ...rest].filter(id => !seen.has(id) && seen.add(id)).slice(0, Math.ceil(limit * 1.4));
  log(`met: fetching ${ids.length} object records`);
  // The Met throttles bursts hard (especially from cloud IPs), so go gently and retry generously.
  let failed = 0;
  const objects = await mapLimit(ids, 3, async id => {
    try { return await getJson(`${API}/v1/objects/${id}`, { retries: 6 }); } catch { failed++; return null; }
  });
  if (failed) log(`met: ${failed} object records could not be fetched`);
  return objects.map((o, i) => normalize(o, i)).filter(Boolean).slice(0, limit);
}

export async function enrich() {
  return null; // object records are already complete
}
