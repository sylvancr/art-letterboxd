const UA = 'Salon/0.1 (art review platform; https://github.com/sylvancr/art-letterboxd)';

export async function getJson(url, { retries = 3, headers = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'AIC-User-Agent': UA, Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

// Run `fn` over `items` with at most `limit` in flight, preserving order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export const clean = s => {
  if (s == null) return null;
  const t = String(s).replace(/<[^>]+>/g, '').replace(/\s+\n/g, '\n').trim();
  return t || null;
};

// First plausible year in a value like 1889, "1760", "ca. 1600" or "1688-1689".
export const toYear = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v ?? '').match(/-?\d{3,4}/);
  return m ? Number(m[0]) : null;
};
