import { getJson, clean, toYear } from './http.js';

const API = 'https://api.vam.ac.uk/v2';

// "Brunias, Agostino" -> "Agostino Brunias"
export const flipName = n => {
  if (!n || /^unknown/i.test(n)) return null;
  const parts = n.split(',').map(s => s.trim());
  return parts.length === 2 && parts[1] ? `${parts[1]} ${parts[0]}` : n;
};

export function normalize(r, rank = 0) {
  const base = r?._images?._iiif_image_base_url;
  if (!base || r._currentLocation?.onDisplay === false) return null;
  const title = r._primaryTitle || r.objectType;
  if (!title) return null;
  return {
    id: `vam:${r.systemNumber}`,
    museum: 'vam',
    source_id: r.systemNumber,
    title,
    artist: flipName(r._primaryMaker?.name),
    date_display: clean(r._primaryDate),
    year: toYear(r._primaryDate),
    classification: clean(r.objectType),
    culture: clean(r._primaryPlace),
    gallery: clean(r._currentLocation?.displayName),
    image_url: `${base}full/!1000,1000/0/default.jpg`,
    thumb_url: `${base}full/!400,400/0/default.jpg`,
    source_url: `https://collections.vam.ac.uk/item/${r.systemNumber}/`,
    highlight: 0,
    rank,
    enriched: 0,
  };
}

export async function fetchOnView({ limit = 500, log = () => {} } = {}) {
  const out = [];
  for (let page = 1; out.length < limit; page++) {
    const qs = new URLSearchParams({
      q: '', images_exist: 1, on_display_at: 'southken', page_size: 100, page,
      order_by: 'fields_populated', order_sort: 'desc',
    });
    const res = await getJson(`${API}/objects/search?${qs}`);
    const records = (res?.records ?? []).filter(r => r._primaryTitle && r._images?.imageResolution !== 'low');
    out.push(...records.map((r, i) => normalize(r, out.length + i)).filter(Boolean));
    log(`vam: ${out.length} records`);
    if (page >= (res?.info?.pages ?? 0) || page >= 50) break;
  }
  return out.slice(0, limit);
}

// Search results are thin; pull the full record when someone first opens the artwork.
export async function enrich(sourceId) {
  const res = await getJson(`${API}/object/${encodeURIComponent(sourceId)}`);
  const r = res?.record;
  if (!r) return null;
  const dims = (r.dimensions ?? []).filter(d => d.value)
    .map(d => `${d.dimension} ${d.value} ${d.unit}`).join(', ');
  return {
    description: clean(r.summaryDescription || r.briefDescription || r.physicalDescription),
    medium: clean(r.materialsAndTechniques),
    dimensions: clean(dims),
    credit: clean(r.creditLine),
  };
}
