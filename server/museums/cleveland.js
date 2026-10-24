import { getJson, clean, toYear } from './http.js';

const API = 'https://openaccess-api.clevelandart.org/api/artworks/';

export function normalize(a, rank = 0) {
  const img = a?.images?.web?.url;
  if (!img || !a.title) return null;
  const creator = a.creators?.[0]?.description ?? '';
  const m = creator.match(/^([^(]+?)\s*\((.+)\)\s*$/);
  return {
    id: `cleveland:${a.id}`,
    museum: 'cleveland',
    source_id: String(a.id),
    title: a.title,
    artist: clean(m ? m[1] : creator),
    artist_bio: clean(m?.[2]),
    date_display: clean(a.creation_date),
    year: toYear(a.creation_date_earliest),
    medium: clean(a.technique),
    dimensions: clean(a.measurements),
    department: clean(a.department),
    classification: clean(a.type),
    culture: clean(a.culture?.[0]),
    gallery: clean(a.current_location),
    description: clean(a.description || a.did_you_know),
    credit: clean(a.creditline),
    image_url: img,
    thumb_url: img,
    source_url: a.url,
    highlight: a.is_highlight ? 1 : 0,
    rank,
    enriched: 1,
  };
}

async function page(params, limit, offset) {
  const qs = new URLSearchParams({ currently_on_view: 1, has_image: 1, ...params, limit, skip: offset });
  return (await getJson(`${API}?${qs}`))?.data ?? [];
}

export async function fetchOnView({ limit = 500, log = () => {} } = {}) {
  const raw = [];
  const ids = new Set();
  for (const params of [{ highlight: 1 }, {}]) {
    for (let offset = 0; raw.length < limit; offset += 200) {
      const data = await page(params, 200, offset);
      for (const a of data) if (!ids.has(a.id)) { ids.add(a.id); raw.push(a); }
      log(`cleveland: ${raw.length} records`);
      if (data.length < 200) break;
    }
  }
  return raw.map((a, i) => normalize(a, i)).filter(Boolean).slice(0, limit);
}

export async function enrich() {
  return null;
}
