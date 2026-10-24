import { getJson, clean } from './http.js';

const API = 'https://api.artic.edu/api/v1';
const IIIF = 'https://www.artic.edu/iiif/2';
const FIELDS = [
  'id', 'title', 'image_id', 'artist_title', 'artist_display', 'date_display', 'date_start',
  'medium_display', 'dimensions', 'department_title', 'artwork_type_title', 'classification_title',
  'place_of_origin', 'gallery_title', 'description', 'short_description', 'credit_line', 'is_boosted',
].join(',');

export function normalize(a, rank = 0) {
  if (!a?.image_id || !a.title) return null;
  // artist_display looks like "Vincent van Gogh (Dutch, 1853–1890)", or just a place for anonymous works.
  const [first = '', ...rest] = (a.artist_display || '').split('\n');
  const bio = a.artist_title ? first.match(/\(([^)]+)\)\s*$/)?.[1] : null;
  return {
    id: `aic:${a.id}`,
    museum: 'aic',
    source_id: String(a.id),
    title: a.title,
    artist: clean(a.artist_title),
    artist_bio: clean(bio ?? rest.join(' ')),
    date_display: clean(a.date_display),
    year: Number.isFinite(a.date_start) ? a.date_start : null,
    medium: clean(a.medium_display),
    dimensions: clean(a.dimensions),
    department: clean(a.department_title),
    classification: clean(a.artwork_type_title || a.classification_title),
    culture: clean(a.place_of_origin || (!a.artist_title ? first : null)),
    gallery: clean(a.gallery_title),
    description: clean(a.description || a.short_description),
    credit: clean(a.credit_line),
    image_url: `${IIIF}/${a.image_id}/full/843,/0/default.jpg`,
    thumb_url: `${IIIF}/${a.image_id}/full/400,/0/default.jpg`,
    source_url: `https://www.artic.edu/artworks/${a.id}`,
    highlight: a.is_boosted ? 1 : 0,
    rank,
    enriched: 1,
  };
}

export async function fetchOnView({ limit = 500, log = () => {} } = {}) {
  const params = JSON.stringify({
    query: { bool: { must: [{ term: { is_on_view: true } }, { exists: { field: 'image_id' } }] } },
    sort: [{ is_boosted: 'desc' }, { _score: 'desc' }],
  });
  const out = [];
  for (let page = 1; out.length < limit; page++) {
    const qs = new URLSearchParams({ params, fields: FIELDS, limit: 100, page });
    const res = await getJson(`${API}/artworks/search?${qs}`);
    const data = res?.data ?? [];
    out.push(...data.map((a, i) => normalize(a, out.length + i)).filter(Boolean));
    log(`aic: ${out.length} records`);
    if (page >= (res?.pagination?.total_pages ?? 0)) break;
  }
  return out.slice(0, limit);
}

export async function enrich() {
  return null;
}
