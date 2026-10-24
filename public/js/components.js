import { html, raw, ago, longDate, plural, session } from './core.js';

// ---------- icons ----------

const paths = {
  eye: '<path d="M12 5C6.5 5 2.2 9.1 1 12c1.2 2.9 5.5 7 11 7s9.8-4.1 11-7c-1.2-2.9-5.5-7-11-7Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill="currentColor"/>',
  heart: '<path d="M12 21s-7.5-4.6-9.6-9.4C1 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.7 3.8 4.3 7.1C19.5 16.4 12 21 12 21Z" fill="currentColor"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.6 3.9 2.3-1 1.7-4.9-2.9V6h2v6.6Z" fill="currentColor"/>',
  grid: '<path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" fill="currentColor"/>',
  review: '<path d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8l-5 4V4a1 1 0 0 1 1-1Zm3 5v2h10V8H7Zm0 4v2h7v-2H7Z" fill="currentColor"/>',
  repeat: '<path d="M17 2l4 4-4 4V7H7a2 2 0 0 0-2 2v2H3V9a4 4 0 0 1 4-4h10V2ZM7 22l-4-4 4-4v3h10a2 2 0 0 0 2-2v-2h2v2a4 4 0 0 1-4 4H7v3Z" fill="currentColor"/>',
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" fill="currentColor"/>',
  star: '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8L12 2.5Z" fill="currentColor"/>',
  frame: '<path d="M3 3h18v18H3V3Zm2 2v14h14V5H5Zm2 10 3-4 2 2.5 3-4 2 5.5H7Z" fill="currentColor"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`);

// ---------- urls ----------

export const artUrl = id => `/art/${encodeURIComponent(id)}`;
export const userUrl = (u, tab = '') => `/u/${encodeURIComponent(u)}${tab ? `/${tab}` : ''}`;
export const artistUrl = name => `/artist/${encodeURIComponent(name)}`;
export const museumUrl = slug => `/museum/${slug}`;

export const MUSEUM_SHORT = { met: 'The Met', aic: 'Art Institute of Chicago', cleveland: 'Cleveland Museum of Art', vam: 'V&A' };

// ---------- ratings ----------

export function stars(rating, cls = '') {
  if (rating == null) return '';
  const full = Math.floor(rating);
  return html`<span class="stars ${cls}" title="${rating} stars">${'★'.repeat(full)}${rating % 1 ? '½' : ''}</span>`;
}

export function starInput(value, name = 'rating') {
  const s = Array.from({ length: 5 }, (_, i) => {
    const n = i + 1;
    const cls = value >= n ? 'full' : value >= n - 0.5 ? 'half' : '';
    return `<span class="s ${cls}"></span>`;
  }).join('');
  return html`<span class="star-input" data-star-input="${name}" data-value="${value ?? ''}" role="slider"
    aria-label="Rating" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${value ?? 0}" tabindex="0">
    <button type="button" class="clear ${value ? 'visible' : ''}" aria-label="Remove rating">✕</button>${raw(s)}</span>`;
}

// Wire every star input inside `root`. onChange(value|null) fires on click/keyboard.
export function bindStarInputs(root, onChange) {
  root.querySelectorAll('[data-star-input]').forEach(el => {
    const starsEls = [...el.querySelectorAll('.s')];
    const paint = v => starsEls.forEach((s, i) => {
      s.classList.toggle('full', v >= i + 1);
      s.classList.toggle('half', v >= i + 0.5 && v < i + 1);
    });
    const valueAt = e => {
      const idx = starsEls.indexOf(e.target.closest('.s'));
      if (idx < 0) return null;
      const r = e.target.closest('.s').getBoundingClientRect();
      return idx + ((e.clientX - r.left) < r.width / 2 ? 0.5 : 1);
    };
    const current = () => (el.dataset.value ? Number(el.dataset.value) : null);
    const set = v => {
      el.dataset.value = v ?? '';
      el.setAttribute('aria-valuenow', v ?? 0);
      el.querySelector('.clear').classList.toggle('visible', !!v);
      paint(v ?? 0);
      onChange?.(v, el);
    };
    el.addEventListener('mousemove', e => { const v = valueAt(e); if (v) { el.classList.add('hovering'); paint(v); } });
    el.addEventListener('mouseleave', () => { el.classList.remove('hovering'); paint(current() ?? 0); });
    el.addEventListener('click', e => {
      e.preventDefault();
      if (e.target.closest('.clear')) return set(null);
      const v = valueAt(e);
      if (v) set(v === current() ? null : v);
    });
    el.addEventListener('keydown', e => {
      const v = current() ?? 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(Math.min(5, v + 0.5)); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(v - 0.5 >= 0.5 ? v - 0.5 : null); }
    });
  });
}

// ---------- posters ----------

export function posterImg(a) {
  return html`<div class="poster-frame"><span class="fallback">${a.title}</span>${a.thumb_url ? html`<img src="${a.thumb_url}" alt="${a.title}${a.artist ? `, ${a.artist}` : ''}" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>`;
}

const tipText = a => [a.title, a.date_display].filter(Boolean).join(' (') + (a.date_display ? ')' : '');

export function poster(a, { meta, caption = false, quick = false } = {}) {
  const q = quick && session.user;
  return html`<div class="poster-wrap">
    <a class="poster" href="${artUrl(a.id)}" data-art="${a.id}">
      ${posterImg(a)}
      ${!caption ? html`<span class="poster-tip">${tipText(a)}</span>` : ''}
      ${q ? html`<span class="quick-actions">
        <button type="button" data-action="quick" data-k="seen" class="${a.my_seen ? 'on' : ''}" title="Seen">${icon('eye')}</button>
        <button type="button" data-action="quick" data-k="liked" class="${a.my_liked ? 'on' : ''}" title="Like">${icon('heart')}</button>
        <button type="button" data-action="quick" data-k="want" class="${a.my_want ? 'on' : ''}" title="Want to see">${icon('clock')}</button>
      </span>` : ''}
    </a>
    ${caption ? html`<div class="poster-caption"><a class="t" href="${artUrl(a.id)}">${a.title}</a><span class="s">${a.artist || MUSEUM_SHORT[a.museum]}</span></div>` : ''}
    ${meta ? html`<div class="poster-meta">${meta}</div>` : ''}
  </div>`;
}

export function posterGrid(items, opts = {}, cls = '') {
  if (!items?.length) return html`<div class="empty">${opts.empty ?? 'Nothing here yet.'}</div>`;
  return html`<div class="poster-grid ${cls}">${items.map(a => poster(a, { ...opts, meta: opts.meta?.(a) }))}</div>`;
}

export const ratingMeta = a => html`${stars(a.rating)}${a.liked ? html`<span class="liked-mark">${icon('heart')}</span>` : ''}${a.reviewed ? html`<a class="muted" href="/review/${a.log_id}" title="Review">${icon('review')}</a>` : ''}`;

// ---------- people ----------

const AVATAR_COLORS = ['#e8743b', '#00a35a', '#2a8fd6', '#a254c8', '#d64569', '#c9a227', '#2bb3a3', '#6a7fd8'];
export function avatar(u, size = '') {
  const name = u.username ?? '';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initial = (u.display_name || name).trim()[0] ?? '?';
  return html`<span class="avatar ${size}" style="background:${AVATAR_COLORS[h % AVATAR_COLORS.length]}" aria-hidden="true">${initial}</span>`;
}

export function memberCard(m) {
  const me = session.user?.username === m.username;
  return html`<div class="member-card">
    <a href="${userUrl(m.username)}">${avatar(m, 'md')}</a>
    <div class="mc-info"><a href="${userUrl(m.username)}">${m.display_name}</a>
      <div class="s">${plural(m.seen ?? 0, 'artwork')} · ${plural(m.reviews ?? 0, 'review')}</div></div>
    ${session.user && !me ? html`<button class="btn btn-small ${m.following ? '' : 'btn-primary'}" data-action="follow" data-user="${m.username}" data-following="${m.following ? 1 : ''}">${m.following ? 'Following' : 'Follow'}</button>` : ''}
  </div>`;
}

// ---------- reviews ----------

export function reviewCard(r, { showArtwork = true, clamp = true } = {}) {
  const a = r.artwork;
  const when = r.seen_on ? `Seen ${longDate(r.seen_on)}` : ago(r.created_at);
  return html`<article class="review">
    ${showArtwork && a ? html`<a class="rv-poster" href="${artUrl(a.id)}">${posterImg(a)}</a>` : ''}
    <div class="rv-body">
      ${showArtwork && a ? html`<a class="rv-title" href="${artUrl(a.id)}">${a.title}${a.date_display ? html`<span class="yr">${a.date_display}</span>` : ''}</a>` : ''}
      <div class="rv-meta">
        <a href="${userUrl(r.username)}">${avatar(r)}</a>
        <a class="by" href="${userUrl(r.username)}">Review by <b>${r.display_name}</b></a>
        ${stars(r.rating)}
        ${r.liked ? html`<span class="liked-mark" title="Liked">${icon('heart', 'sm')}</span>` : ''}
        ${r.revisit ? html`<span class="muted" title="Seen before">${icon('repeat')}</span>` : ''}
      </div>
      <a href="/review/${r.id}" class="rv-text ${clamp ? 'clamp' : ''}">${r.body}</a>
      <div class="rv-foot">
        ${likeButton(r)}
        <a href="/review/${r.id}" class="muted">${when}</a>
      </div>
    </div>
  </article>`;
}

export function likeButton(r) {
  return html`<button class="like-btn ${r.liked_by_me ? 'on' : ''}" data-action="like-review" data-id="${r.id}" data-on="${r.liked_by_me ? 1 : ''}" data-count="${r.like_count}">
    ${icon('heart')}<span>${r.liked_by_me ? 'Liked' : 'Like review'}${r.like_count ? ` · ${r.like_count}` : ''}</span></button>`;
}

export function reviewList(reviews, opts, empty = 'No reviews yet.') {
  if (!reviews?.length) return html`<div class="empty">${empty}</div>`;
  return html`<div>${reviews.map(r => reviewCard(r, opts))}</div>`;
}

// ---------- histogram ----------

export function histogram(counts, avg, total) {
  const max = Math.max(1, ...counts);
  return html`<div class="ratings-box">
    <span class="lo">★</span>
    <div class="histogram">${counts.map((n, i) => html`<div style="height:${Math.max(2, (n / max) * 100)}%" title="${plural(n, `${(i + 1) / 2}-star rating`)}"></div>`)}</div>
    <span class="avg">${avg ? avg.toFixed(1) : '–'}<span class="lo"> ★★★★★</span></span>
  </div>
  <div class="muted" style="font-size:12px;margin-top:6px">${total ? plural(total, 'rating') : 'No ratings yet'}</div>`;
}

// ---------- lists ----------

export function listCard(l) {
  return html`<a class="list-card" href="/list/${l.id}">
    <div class="stack">${(l.preview.length ? l.preview : [{}]).slice(0, 5).map(a => a.id ? posterImg(a) : html`<div class="poster-frame"></div>`)}</div>
    <h3>${l.name}</h3>
    <div class="lc-meta">${avatar(l)}<span>${l.display_name}</span><span>·</span><span>${plural(l.count, 'artwork')}</span></div>
    ${l.description ? html`<p>${l.description}</p>` : ''}
  </a>`;
}

export function sectionHead(title, link, linkText = 'More') {
  return html`<div class="section-head"><h2>${title}</h2>${link ? html`<a href="${link}">${linkText}</a>` : ''}</div>`;
}
