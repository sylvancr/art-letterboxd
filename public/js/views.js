import {
  html, api, session, route, navigate, withQuery, plural, ago, longDate, toast, openModal,
} from './core.js';
import {
  icon, poster, posterGrid, posterImg, stars, starInput, bindStarInputs, reviewCard, reviewList, likeButton,
  avatar, memberCard, histogram, listCard, sectionHead, ratingMeta, artUrl, userUrl, artistUrl, museumUrl, MUSEUM_SHORT,
} from './components.js';
import { openAuth } from './modals.js';

const centuryLabel = c => {
  if (c < 0) return `${-c}${ordinal(-c)} century BCE`;
  const n = c + 1;
  return `${n}${ordinal(n)} century`;
};
function ordinal(n) {
  const v = n % 100;
  return v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th';
}

// ---------- home ----------

route('/', async () => {
  const d = await api('/home');
  const u = session.user;
  const hero = !u && d.backdrop ? html`
    <section class="hero">
      <div class="hero-art"><img src="${d.backdrop.image_url}" alt="" referrerpolicy="no-referrer"></div>
      <div class="hero-credit"><a href="${artUrl(d.backdrop.id)}">${d.backdrop.title}</a><br>${d.backdrop.artist ?? ''}${d.backdrop.artist ? ' · ' : ''}${MUSEUM_SHORT[d.backdrop.museum]}</div>
      <div class="hero-body">
        <h1>Track art you've seen.<br>Save what you want to see.<br>Tell your friends what's worth the trip.</h1>
        <button class="btn btn-primary btn-big" data-action="signup">Get started — it's free!</button>
        <div class="sub">${plural(d.totals.artworks, 'artwork')} on view right now across ${d.perMuseum.length} museums.</div>
      </div>
    </section>` : '';

  const welcome = u ? html`<p class="welcome">Welcome back, <a href="${userUrl(u.username)}">${u.display_name}</a>. Here's what's been on view.</p>` : '';

  return html`
    ${hero}${welcome}
    <section class="section">
      ${sectionHead('Popular on Salon this week', '/art?sort=popular')}
      ${posterGrid(d.trending.slice(0, 6), {}, 'cols-6')}
    </section>
    ${!u ? html`<section class="features">
      <div class="feature">${icon('eye')}<div>Keep track of every artwork you've stood in front of — or just start from the day you join.</div></div>
      <div class="feature">${icon('heart')}<div>Show some love for your favourite pieces, reviews and lists with a like.</div></div>
      <div class="feature">${icon('review')}<div>Write and share reviews, and follow friends and other members to read theirs.</div></div>
      <div class="feature">${icon('star')}<div>Rate each work on a five-star scale (with halves) to record and share your reaction.</div></div>
      <div class="feature">${icon('clock')}<div>Build a want-to-see list of pieces on display at the museums you're planning to visit.</div></div>
      <div class="feature">${icon('grid')}<div>Compile and share lists of works on any topic — a perfect route through a museum, or every Monet in America.</div></div>
    </section>` : ''}
    ${u && d.friends.length ? html`<section class="section">
      ${sectionHead('New from friends', '/activity?scope=following', 'All activity')}
      ${posterGrid(d.friends.slice(0, 6).map(r => ({ ...r.artwork, rating: r.rating, liked: r.liked, by: r })), {
        meta: a => html`${avatar(a.by)} ${stars(a.rating)}${a.liked ? html`<span class="liked-mark">${icon('heart')}</span>` : ''}`,
      }, 'cols-6')}
    </section>` : ''}
    ${u && !d.friends.length ? html`<p class="muted" style="text-align:center;margin-top:24px">Follow <a href="/members" style="color:#fff">members</a> to see what your friends have been looking at.</p>` : ''}
    <div class="two-col section">
      <section>
        ${sectionHead(d.popularReviews.length ? 'Popular reviews this month' : 'Just reviewed', '/activity', 'More')}
        ${reviewList(d.popularReviews.length ? d.popularReviews : d.reviews, {}, 'No reviews yet. Be the first — open any artwork and hit “Review or log”.')}
      </section>
      <aside>
        <div class="side-block">
          ${sectionHead('Museums', '/museums', 'All')}
          ${d.perMuseum.map(m => html`<a class="artist-chip" href="${museumUrl(m.museum.slug)}"><span style="color:#fff">${m.museum.name}</span><span class="muted">${m.museum.city}</span></a>`)}
        </div>
        ${d.lists.length ? html`<div class="side-block">
          ${sectionHead('Recent lists', '/lists', 'All')}
          ${d.lists.slice(0, 3).map(l => html`<div style="margin-bottom:18px">${listCard(l)}</div>`)}
        </div>` : ''}
      </aside>
    </div>
    ${d.perMuseum.map(m => html`<section class="section">
      ${sectionHead(`On view at ${m.museum.name}`, museumUrl(m.museum.slug), 'See all')}
      ${posterGrid(m.items, {}, 'cols-6')}
    </section>`)}
  `;
});

// ---------- browse ----------

const SORTS = [
  ['popular', 'Popularity'], ['rating', 'Highest rated'], ['reviewed', 'Recently reviewed'],
  ['oldest', 'Oldest first'], ['newest', 'Newest first'], ['title', 'Title'], ['shuffle', 'Shuffle'],
];

export async function browseView({ query, title, sub, fixed = {} }) {
  const params = { sort: 'popular', ...query, ...fixed };
  const [facets, res] = await Promise.all([
    api(withQuery('/facets', { museum: params.museum })),
    api(withQuery('/artworks', params)),
  ]);
  const opt = (value, label, current) => html`<option value="${value}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${label}</option>`;
  return html`
    ${title}
    ${sub ?? ''}
    <form class="filters" data-change="filter">
      <span class="label">Browse by</span>
      ${fixed.museum ? '' : html`<select name="museum" aria-label="Museum">${opt('', 'All museums', params.museum)}${facets.museums.map(m => opt(m.slug, m.name, params.museum))}</select>`}
      <select name="type" aria-label="Type">${opt('', 'Any type', params.type)}${facets.types.map(t => opt(t.value, `${t.value} (${t.n})`, params.type))}</select>
      <select name="century" aria-label="Century">${opt('', 'Any century', params.century)}${facets.centuries.map(c => opt(c.value, centuryLabel(c.value), params.century))}</select>
      <span class="spacer"></span>
      <span class="label">Sort by</span>
      <select name="sort" aria-label="Sort">${SORTS.map(([v, l]) => opt(v, l, params.sort))}</select>
      ${session.user ? html`<label class="check"><input type="checkbox" name="hide_seen" value="1" ${params.hide_seen === '1' ? 'checked' : ''}> Hide seen</label>` : ''}
    </form>
    <div class="result-count">${plural(res.total, 'artwork')}</div>
    <div id="browse-grid">${posterGrid(res.items, { quick: true, empty: 'No artworks match those filters.' })}</div>
    ${res.page < res.pages ? html`<div class="load-more"><button class="btn" data-action="load-more" data-page="${res.page + 1}">Load more</button></div>` : ''}
  `;
}

route('/art', ({ query }) => browseView({
  query,
  title: html`<h1 class="page-title">Art on view</h1>`,
  sub: html`<p class="page-sub">Everything currently on display at the museums Salon follows.</p>`,
}));

// ---------- artwork ----------

route('/art/:id', async ({ params }) => {
  const d = await api(`/artworks/${encodeURIComponent(params.id)}`);
  const a = d.artwork;
  document.title = `${a.title}${a.artist ? ` by ${a.artist}` : ''} · Salon`;
  const s = d.stats;
  const details = [
    ['Artist', a.artist && html`<a href="${artistUrl(a.artist)}" style="color:#fff">${a.artist}</a>${a.artist_bio ? html`<br><span class="muted">${a.artist_bio}</span>` : ''}`],
    ['Date', a.date_display], ['Medium', a.medium], ['Dimensions', a.dimensions], ['Type', a.classification && html`<a href="${withQuery('/art', { type: a.classification })}" style="color:#fff">${a.classification}</a>`],
    ['Culture', a.culture], ['Department', a.department], ['Credit', a.credit],
  ].filter(([, v]) => v);
  return html`
    <div class="backdrop"><img src="${a.thumb_url}" alt="" referrerpolicy="no-referrer"></div>
    <div class="art-layout" data-artwork="${a.id}">
      <div>
        <div class="art-image" data-action="zoom" data-src="${a.image_url}">
          <span class="fallback">${a.title}</span><img src="${a.image_url}" alt="${a.title}" referrerpolicy="no-referrer">
        </div>
        <div class="art-stats">
          <span class="seen" title="Seen by ${plural(s.seen, 'member')}">${icon('eye')} ${s.seen}</span>
          <span class="lists" title="In ${plural(s.lists, 'list')}">${icon('grid')} ${s.lists}</span>
          <span class="likes" title="Liked by ${plural(s.likes, 'member')}">${icon('heart')} ${s.likes}</span>
        </div>
      </div>
      <div class="art-main">
        <div class="art-head">
          <h1>${a.title}</h1>
          <div class="byline">${a.date_display ? html`<span class="yr">${a.date_display}</span>` : ''}${a.date_display && a.artist ? ' · ' : ''}${a.artist ? html`<a href="${artistUrl(a.artist)}">${a.artist}</a>` : ''}</div>
          <div class="art-where"><span class="dot"></span><span>On view${a.gallery ? ` · ${a.gallery}` : ''} · <a href="${museumUrl(a.museum)}">${a.museum_info.name}</a>, ${a.museum_info.city}</span></div>
        </div>
        ${a.description ? html`<div class="art-desc clamp" id="art-desc">${a.description}</div>
          <button class="link-btn" style="margin-top:6px;font-size:13px" data-action="expand-desc">Read more</button>` : ''}
        <div class="tabs"><button class="active">Details</button></div>
        <dl class="details">${details.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
        <a class="btn btn-ghost btn-small" href="${a.source_url}" target="_blank" rel="noopener">View on ${a.museum_info.short} website ↗</a>

        ${d.friends.length ? html`<section class="section">
          ${sectionHead('Activity from friends')}
          <div style="display:flex;flex-wrap:wrap;gap:14px">${d.friends.map(f => html`<a href="${userUrl(f.username)}" style="text-align:center;font-size:12px">${avatar(f, 'md')}<div>${stars(f.rating)}${f.liked ? html`<span class="liked-mark">${icon('heart')}</span>` : ''}</div></a>`)}</div>
        </section>` : ''}

        <section class="section">
          ${sectionHead('Popular reviews', s.reviews > 6 ? `/art/${encodeURIComponent(a.id)}/reviews` : null, 'All reviews')}
          ${reviewList(d.reviews.popular, { showArtwork: false }, session.user ? 'No reviews yet. Seen it? Tell people what you thought.' : 'No reviews yet.')}
        </section>
        ${d.reviews.recent.length > 2 ? html`<section class="section">
          ${sectionHead('Recent reviews', `/art/${encodeURIComponent(a.id)}/reviews`, 'All reviews')}
          ${reviewList(d.reviews.recent, { showArtwork: false })}
        </section>` : ''}
      </div>
      <aside class="art-side">
        ${actionPanel(d)}
        <div class="side-block" style="margin-top:28px">
          ${sectionHead('Ratings')}
          ${histogram(s.histogram, s.avg_rating, s.ratings)}
        </div>
        ${d.me?.logs.length ? html`<div class="side-block">
          ${sectionHead('Your diary')}
          ${d.me.logs.map(l => html`<div class="artist-chip"><a href="/review/${l.id}">${l.seen_on ? longDate(l.seen_on) : ago(l.created_at)}</a><span>${stars(l.rating)}${l.liked ? html` <span class="liked-mark">${icon('heart')}</span>` : ''}</span></div>`)}
        </div>` : ''}
      </aside>
    </div>
    ${d.more.length ? html`<section class="section">
      ${sectionHead(d.more.some(m => m.artist && m.artist === a.artist) ? `More by ${a.artist} on view` : `Also in ${a.gallery}`)}
      ${posterGrid(d.more.slice(0, 6), {}, 'cols-6')}
    </section>` : ''}
  `;
});

export function actionPanel(d) {
  if (!session.user) {
    return html`<div class="signin-panel"><p><button class="link-btn" style="color:#fff;text-decoration:underline" data-action="signin">Sign in</button> to log, rate or review</p>
      <button class="btn btn-primary" data-action="signup">Create account</button></div>`;
  }
  const m = d.me;
  const t = (k, ic, on, off) => html`<button data-action="toggle-state" data-k="${k}" class="${m[k] ? 'on' : ''}">${icon(ic)}<span>${m[k] ? on : off}</span></button>`;
  return html`<div class="action-panel" id="action-panel">
    <div class="ap-toggles">
      ${t('seen', 'eye', 'Seen', 'Seen it?')}
      ${t('liked', 'heart', 'Liked', 'Like')}
      ${t('want', 'clock', 'Want to see', 'Want to see')}
    </div>
    <div class="ap-rate"><div>${m.rating ? 'Rated' : 'Rate'}</div>${starInput(m.rating, 'panel')}</div>
    <button class="ap-row" data-action="log">${m.logs.length ? 'Review or log again…' : 'Review or log…'}</button>
    <button class="ap-row" data-action="add-to-list">Add to lists…</button>
    <button class="ap-row" data-action="share">Share</button>
  </div>`;
}

route('/art/:id/reviews', async ({ params, query }) => {
  const [d, reviews] = await Promise.all([
    api(`/artworks/${encodeURIComponent(params.id)}`),
    api(withQuery(`/artworks/${encodeURIComponent(params.id)}/reviews`, { sort: query.sort })),
  ]);
  const a = d.artwork;
  return html`
    <div style="display:flex;gap:18px;align-items:center;margin-top:30px">
      <a href="${artUrl(a.id)}" style="width:70px">${posterImg(a)}</a>
      <div><div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.08em">Reviews of</div>
      <h1 class="page-title" style="margin:2px 0"><a href="${artUrl(a.id)}">${a.title}</a></h1>
      <div class="muted">${a.artist ?? ''}</div></div>
    </div>
    <div class="tabs" style="margin-bottom:6px">
      <a href="${withQuery(`/art/${encodeURIComponent(a.id)}/reviews`, {})}" class="${query.sort !== 'popular' ? 'active' : ''}">Newest</a>
      <a href="${withQuery(`/art/${encodeURIComponent(a.id)}/reviews`, { sort: 'popular' })}" class="${query.sort === 'popular' ? 'active' : ''}">Popular</a>
    </div>
    ${reviewList(reviews, { showArtwork: false })}
  `;
});

// ---------- single review ----------

route('/review/:id', async ({ params }) => {
  const r = await api(`/logs/${params.id}`);
  const a = r.artwork;
  const mine = session.user?.username === r.username;
  return html`
    <div class="two-col" style="margin-top:34px">
      <div>
        <div class="rv-meta" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          ${avatar(r, 'md')}<span>${r.body ? 'Review' : 'Diary entry'} by <a href="${userUrl(r.username)}" style="color:#fff;font-weight:600">${r.display_name}</a></span>
        </div>
        <h1 class="page-title" style="margin-top:0"><a href="${artUrl(a.id)}">${a.title}</a> <span class="muted" style="font:400 18px var(--sans)">${a.date_display ?? ''}</span></h1>
        <div style="display:flex;gap:10px;align-items:center;margin:8px 0 18px">
          ${stars(r.rating, 'big')}${r.liked ? html`<span class="liked-mark">${icon('heart')}</span>` : ''}
          <span class="muted" style="font-size:13px">${r.seen_on ? `Seen ${longDate(r.seen_on)}` : `Logged ${longDate(r.created_at)}`}${r.revisit ? ' · seen before' : ''}</span>
        </div>
        ${r.body ? html`<div class="rv-text" style="font-size:17px;line-height:1.7;color:#cde;white-space:pre-wrap">${r.body}</div>` : ''}
        <div style="display:flex;gap:16px;align-items:center;margin-top:24px">
          ${r.body ? likeButton(r) : ''}
          ${mine ? html`<button class="btn btn-small" data-action="edit-log" data-id="${r.id}">Edit</button>
            <button class="btn btn-small btn-ghost" data-action="delete-log" data-id="${r.id}">Delete</button>` : ''}
        </div>
        ${r.likers.length ? html`<div class="section">${sectionHead('Liked by')}<div style="display:flex;gap:8px;flex-wrap:wrap">${r.likers.map(u => html`<a href="${userUrl(u.username)}" title="${u.display_name}">${avatar(u, 'md')}</a>`)}</div></div>` : ''}
      </div>
      <aside><a href="${artUrl(a.id)}" class="poster" style="max-width:230px">${posterImg(a)}</a>
        <div style="margin-top:10px;font-size:14px"><a href="${artUrl(a.id)}" style="color:#fff">${a.title}</a><div class="muted">${a.artist ?? ''}</div><div class="muted">${MUSEUM_SHORT[a.museum]}${a.gallery ? ` · ${a.gallery}` : ''}</div></div>
      </aside>
    </div>`;
});

// ---------- museums ----------

route('/museums', async () => {
  const museums = await api('/museums');
  return html`
    <h1 class="page-title">Museums</h1>
    <p class="page-sub">Salon follows what's on the walls right now. Pick a museum to see everything currently on display.</p>
    <div class="museum-grid">${museums.map(m => html`<a class="museum-card" href="${museumUrl(m.slug)}">
      <div class="mosaic">${m.cover.map(a => html`<img src="${a.thumb_url}" alt="" loading="lazy" referrerpolicy="no-referrer">`)}</div>
      <div class="mc-body"><h3>${m.name}</h3><div class="mc-sub">${m.city}, ${m.country} · ${plural(m.count, 'work')} on view</div></div>
    </a>`)}</div>`;
});

route('/museum/:slug', async ({ params, query }) => {
  const m = await api(`/museums/${params.slug}`);
  document.title = `${m.name} · Salon`;
  const head = html`
    <div class="museum-head" style="margin-top:32px">
      <div><h1 class="page-title" style="margin:0">${m.name}</h1>
        <div class="muted" style="margin-top:4px">${m.city}, ${m.country} · <a href="${m.url}" target="_blank" rel="noopener" style="color:var(--blue)">Visit website ↗</a></div></div>
      <div class="stat-row">
        <div class="stat"><b>${m.stats.works.toLocaleString()}</b><span>On view</span></div>
        <div class="stat"><b>${m.stats.logs.toLocaleString()}</b><span>Logs</span></div>
        <div class="stat"><b>${m.stats.reviews.toLocaleString()}</b><span>Reviews</span></div>
      </div>
    </div>
    ${m.reviews.length ? html`<section class="section" style="margin-bottom:30px">${sectionHead(`Recent reviews from ${m.short}`)}<div class="review-tiles">${m.reviews.slice(0, 4).map(r => reviewCard(r))}</div></section>` : html`<div style="height:20px"></div>`}`;
  return browseView({ query, title: head, fixed: { museum: m.slug } });
});

route('/artist/:name', async ({ params }) => {
  const d = await api(`/artists/${encodeURIComponent(params.name)}`);
  const museums = [...new Set(d.items.map(i => MUSEUM_SHORT[i.museum]))];
  return html`
    <div class="muted" style="margin-top:32px;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Works on view by</div>
    <h1 class="page-title" style="margin-top:4px">${d.name}</h1>
    <p class="page-sub">${d.bio ? html`${d.bio} · ` : ''}${plural(d.items.length, 'work')} on view at ${museums.join(', ')}</p>
    ${posterGrid(d.items, { caption: true, quick: true })}`;
});

// ---------- search ----------

route('/search', async ({ query }) => {
  const term = query.q ?? '';
  const r = term ? await api(withQuery('/search', { q: term })) : { artworks: { items: [], total: 0 }, artists: [], members: [], lists: [] };
  return html`
    <form class="search-big" data-submit="search"><input type="search" name="q" value="${term}" placeholder="Search artworks, artists, members, lists…" autofocus aria-label="Search"><button class="btn btn-primary">Search</button></form>
    ${term ? html`<p class="page-sub">${plural(r.artworks.total, 'artwork')} matching “${term}”</p>` : ''}
    <div class="two-col">
      <div>${term ? posterGrid(r.artworks.items, { caption: true, quick: true, empty: 'No artworks on view match that search.' }) : html`<div class="empty">Try “Monet”, “samurai armor”, “Chicago” or “tapestry”.</div>`}</div>
      <aside>
        ${r.artists.length ? html`<div class="side-block">${sectionHead('Artists')}${r.artists.map(x => html`<a class="artist-chip" href="${artistUrl(x.name)}"><span style="color:#fff">${x.name}</span><span class="muted">${x.n}</span></a>`)}</div>` : ''}
        ${r.members.length ? html`<div class="side-block">${sectionHead('Members')}${r.members.map(m => html`<a class="artist-chip" href="${userUrl(m.username)}"><span style="display:flex;gap:8px;align-items:center;color:#fff">${avatar(m)}${m.display_name}</span><span class="muted">@${m.username}</span></a>`)}</div>` : ''}
        ${r.lists.length ? html`<div class="side-block">${sectionHead('Lists')}${r.lists.map(l => html`<div style="margin-bottom:16px">${listCard(l)}</div>`)}</div>` : ''}
      </aside>
    </div>`;
});

// ---------- people & activity ----------

route('/members', async () => {
  const members = await api('/users');
  return html`<h1 class="page-title">Members</h1><p class="page-sub">Find people with good taste and follow them.</p>
    ${members.length ? html`<div class="member-grid">${members.map(memberCard)}</div>` : html`<div class="empty">No members yet.</div>`}`;
});

route('/activity', async ({ query }) => {
  const scope = query.scope === 'following' && session.user ? 'following' : 'all';
  const items = await api(withQuery('/activity', { scope }));
  return html`
    <h1 class="page-title">Activity</h1>
    <div class="tabs" style="margin-bottom:6px">
      <a href="/activity" class="${scope === 'all' ? 'active' : ''}">Everyone</a>
      ${session.user ? html`<a href="/activity?scope=following" class="${scope === 'following' ? 'active' : ''}">Following</a>` : ''}
    </div>
    ${items.length ? items.map(activityItem) : html`<div class="empty">${scope === 'following' ? 'Nobody you follow has logged anything yet.' : 'No activity yet.'}</div>`}`;
});

function activityItem(r) {
  if (r.body) return reviewCard(r);
  const a = r.artwork;
  return html`<div class="review" style="align-items:center;padding:12px 0">
    <a class="rv-poster" style="width:40px" href="${artUrl(a.id)}">${posterImg(a)}</a>
    <div class="rv-body" style="font-size:14px">${avatar(r)} <a href="${userUrl(r.username)}" style="color:#fff;font-weight:600">${r.display_name}</a>
      saw <a href="${artUrl(a.id)}" style="color:#fff">${a.title}</a> ${stars(r.rating)}${r.liked ? html` <span class="liked-mark">${icon('heart')}</span>` : ''}
      <span class="muted"> · ${ago(r.created_at)}</span></div></div>`;
}

// ---------- lists ----------

route('/lists', async () => {
  const lists = await api('/lists');
  return html`
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px">
      <div><h1 class="page-title">Lists</h1><p class="page-sub" style="margin-bottom:0">Collect, curate and share. Lists are the perfect way to plan a museum visit.</p></div>
      ${session.user ? html`<a class="btn btn-primary" href="/list/new">Start a new list</a>` : html`<button class="btn btn-primary" data-action="signup">Start a new list</button>`}
    </div>
    <div class="section">${lists.length ? html`<div class="list-grid">${lists.map(listCard)}</div>` : html`<div class="empty">No lists yet.</div>`}</div>`;
});

route('/list/new', async () => {
  if (!session.user) { openAuth('signin'); return html`<div class="empty">Sign in to make a list.</div>`; }
  return listEditor({ name: '', description: '', items: [] });
});

route('/list/:id/edit', async ({ params }) => listEditor(await api(`/lists/${params.id}`)));

function listEditor(list) {
  const isNew = !list.id;
  return html`
    <h1 class="page-title">${isNew ? 'New list' : 'Edit list'}</h1>
    <form data-submit="save-list" data-id="${list.id ?? ''}" class="two-col">
      <div>
        <div class="form-error"></div>
        <label class="field"><span>Name</span><input type="text" name="name" value="${list.name}" required maxlength="120"></label>
        <label class="field"><span>Description</span><textarea name="description" maxlength="2000">${list.description}</textarea></label>
        <label class="field"><span>Add an artwork</span><input type="search" data-picker="list" placeholder="Search artworks on view…" autocomplete="off"></label>
        <div class="picker-results" id="picker-results"></div>
        <div class="section-head" style="margin-top:20px"><h3>Artworks</h3></div>
        <div id="list-items" class="poster-grid small">${list.items.map(a => editorItem(a))}</div>
      </div>
      <aside>
        <button class="btn btn-primary" style="width:100%">Save list</button>
        ${!isNew ? html`<button type="button" class="btn btn-ghost" style="width:100%;margin-top:10px" data-action="delete-list" data-id="${list.id}">Delete list</button>` : ''}
      </aside>
    </form>`;
}

export function editorItem(a) {
  return html`<div class="fav-slot" data-item="${a.id}" style="border-style:solid">${posterImg(a)}<button type="button" class="x" data-action="remove-item" aria-label="Remove">×</button></div>`;
}

route('/list/:id', async ({ params }) => {
  const l = await api(`/lists/${params.id}`);
  document.title = `${l.name} · Salon`;
  return html`
    <div style="margin-top:32px;display:flex;align-items:center;gap:10px;font-size:13px">${avatar(l)} List by <a href="${userUrl(l.username)}" style="color:#fff;font-weight:600">${l.display_name}</a> <span class="muted">· Updated ${ago(l.updated_at)}</span></div>
    <h1 class="page-title" style="margin-top:12px">${l.name}</h1>
    ${l.description ? html`<p style="max-width:700px;color:#bcd;white-space:pre-wrap">${l.description}</p>` : ''}
    <div style="display:flex;gap:10px;margin:16px 0 26px">
      ${l.isMine ? html`<a class="btn btn-small" href="/list/${l.id}/edit">Edit list</a>` : ''}
      <button class="btn btn-small btn-ghost" data-action="share">Share</button>
    </div>
    <div class="numbered">${posterGrid(l.items, { caption: true, quick: true, empty: 'This list is empty.', meta: () => '' })}</div>`;
});

// ---------- profile ----------

const PROFILE_TABS = [
  ['', 'Profile'], ['diary', 'Diary'], ['reviews', 'Reviews'], ['seen', 'Artworks'],
  ['want', 'Want to see'], ['likes', 'Likes'], ['lists', 'Lists'], ['following', 'Following'], ['followers', 'Followers'],
];

async function profileFrame(username, tab, body) {
  const p = await api(`/users/${encodeURIComponent(username)}`);
  const u = p.user;
  document.title = `${u.display_name} · Salon`;
  const content = await body(p);
  return html`
    <div class="profile-head">
      <div class="profile-id">${avatar(u, 'lg')}
        <div><h1>${u.display_name}
          ${p.isMe ? html`<a class="btn btn-small" href="/settings">Edit profile</a>`
            : session.user ? html`<button class="btn btn-small ${p.isFollowing ? '' : 'btn-primary'}" data-action="follow" data-user="${u.username}" data-following="${p.isFollowing ? 1 : ''}">${p.isFollowing ? 'Following' : 'Follow'}</button>` : ''}
          </h1>
          <div class="muted" style="font-size:13px">@${u.username} · Joined ${longDate(u.created_at)}</div>
          ${u.bio ? html`<div class="bio">${u.bio}</div>` : ''}</div>
      </div>
      <div class="stat-row">
        <a class="stat" href="${userUrl(u.username, 'seen')}"><b>${p.stats.seen}</b><span>Artworks</span></a>
        <a class="stat" href="${userUrl(u.username, 'diary')}"><b>${p.stats.this_year}</b><span>This year</span></a>
        <a class="stat" href="${userUrl(u.username, 'lists')}"><b>${p.stats.lists}</b><span>Lists</span></a>
        <a class="stat" href="${userUrl(u.username, 'following')}"><b>${p.stats.following}</b><span>Following</span></a>
        <a class="stat" href="${userUrl(u.username, 'followers')}"><b>${p.stats.followers}</b><span>Followers</span></a>
      </div>
    </div>
    <nav class="profile-tabs">${PROFILE_TABS.map(([t, label]) => html`<a href="${userUrl(u.username, t)}" class="${t === tab ? 'active' : ''}">${label}</a>`)}</nav>
    ${content}`;
}

route('/u/:username', ({ params }) => profileFrame(params.username, '', p => html`
  <div class="two-col">
    <div>
      <section>
        ${sectionHead('Favourite artworks', p.isMe ? '/settings' : null, 'Edit')}
        ${p.favorites.length ? posterGrid(p.favorites, {}, 'cols-4')
          : html`<div class="empty">${p.isMe ? html`Pick your four favourite artworks in <a href="/settings" style="color:#fff">settings</a>.` : 'No favourites yet.'}</div>`}
      </section>
      <section class="section">
        ${sectionHead('Recent activity', userUrl(p.user.username, 'diary'), 'All')}
        ${posterGrid(p.recent.slice(0, 8), { meta: ratingMeta, empty: 'Nothing logged yet.' }, 'cols-4')}
      </section>
      <section class="section">
        ${sectionHead('Recent reviews', userUrl(p.user.username, 'reviews'), 'More')}
        ${reviewList(p.reviews, {}, 'No reviews yet.')}
      </section>
    </div>
    <aside>
      <div class="side-block">
        ${sectionHead('Want to see', userUrl(p.user.username, 'want'), String(p.stats.want))}
      </div>
      <div class="side-block">
        ${sectionHead('Ratings')}
        ${histogram(p.histogram, avgFrom(p.histogram), p.histogram.reduce((x, y) => x + y, 0))}
      </div>
      ${p.museumsSeen.length ? html`<div class="side-block museum-bars">
        ${sectionHead('Museums')}
        ${p.museumsSeen.map(m => html`<a class="row" href="${museumUrl(m.slug)}"><span>${m.name}</span><span class="muted">${m.n}</span></a>`)}
      </div>` : ''}
    </aside>
  </div>`));

const avgFrom = h => {
  const n = h.reduce((x, y) => x + y, 0);
  return n ? h.reduce((sum, c, i) => sum + c * (i + 1) / 2, 0) / n : null;
};

route('/u/:username/:tab', ({ params, query }) => {
  const tab = params.tab;
  if (!PROFILE_TABS.some(([t]) => t === tab)) throw Object.assign(new Error('Unknown page'), { status: 404 });
  return profileFrame(params.username, tab, async p => {
    const rows = await api(withQuery(`/users/${encodeURIComponent(params.username)}/${tab}`, { page: query.page }));
    switch (tab) {
      case 'diary': return diaryTable(rows, p.isMe);
      case 'reviews': return reviewList(rows, {}, 'No reviews yet.');
      case 'seen': case 'likes': case 'want':
        return posterGrid(rows, { quick: true, meta: tab === 'want' ? null : ratingMeta, empty: 'Nothing here yet.' });
      case 'lists': return rows.length ? html`<div class="list-grid">${rows.map(listCard)}</div>` : html`<div class="empty">No lists yet.</div>`;
      default: return rows.length ? html`<div class="member-grid">${rows.map(memberCard)}</div>` : html`<div class="empty">Nobody yet.</div>`;
    }
  });
});

function diaryTable(rows, isMe) {
  if (!rows.length) return html`<div class="empty">The diary is empty.</div>`;
  let lastMonth = '';
  return html`<table class="diary">
    <thead><tr><th>Month</th><th>Day</th><th>Artwork</th><th class="hide-sm">Date</th><th>Rating</th><th class="c">Like</th><th class="c hide-sm">Again</th><th class="c">Review</th></tr></thead>
    <tbody>${rows.map(r => {
      const day = r.seen_on ?? r.created_at.slice(0, 10);
      const d = new Date(`${day}T12:00:00`);
      const month = `${d.getFullYear()}-${d.getMonth()}`;
      const showMonth = month !== lastMonth;
      lastMonth = month;
      return html`<tr>
        <td class="month">${showMonth ? html`<div class="cal">${d.toLocaleString(undefined, { month: 'short' })}<b>${d.getFullYear()}</b></div>` : ''}</td>
        <td class="day">${d.getDate()}</td>
        <td><div class="art"><a href="${artUrl(r.id)}">${posterImg(r)}</a><div><a class="t" href="${artUrl(r.id)}">${r.title}</a><div class="muted" style="font-size:12px">${r.artist ?? MUSEUM_SHORT[r.museum]}</div></div></div></td>
        <td class="hide-sm muted">${r.date_display ?? ''}</td>
        <td>${stars(r.rating)}</td>
        <td class="c">${r.liked ? html`<span class="liked-mark">${icon('heart')}</span>` : ''}</td>
        <td class="c hide-sm">${r.revisit ? html`<span class="muted">${icon('repeat')}</span>` : ''}</td>
        <td class="c"><a href="/review/${r.id}" class="${r.reviewed ? '' : 'muted'}" title="${r.reviewed ? 'Read review' : isMe ? 'Edit entry' : 'Entry'}">${icon(r.reviewed ? 'review' : 'frame')}</a></td>
      </tr>`;
    })}</tbody></table>`;
}

// ---------- settings ----------

route('/settings', async () => {
  if (!session.user) { openAuth('signin'); return html`<div class="empty">Sign in to edit your profile.</div>`; }
  const p = await api(`/users/${encodeURIComponent(session.user.username)}`);
  const favs = [0, 1, 2, 3].map(i => p.favorites.find(f => f.position === i) ?? null);
  return html`
    <h1 class="page-title">Settings</h1>
    <form data-submit="save-profile" class="two-col">
      <div>
        <div class="form-error"></div>
        <label class="field"><span>Username</span><input type="text" value="${p.user.username}" disabled></label>
        <label class="field"><span>Display name</span><input type="text" name="display_name" value="${p.user.display_name}" maxlength="60"></label>
        <label class="field"><span>Bio</span><textarea name="bio" maxlength="500" style="min-height:100px">${p.user.bio}</textarea></label>
        <div class="field"><span>Favourite artworks</span>
          <div class="fav-slots" id="fav-slots">${favs.map((f, i) => favSlot(f, i))}</div></div>
        <button class="btn btn-primary">Save changes</button>
      </div>
      <aside><p class="muted" style="font-size:13px">Your four favourites appear at the top of your profile. Click an empty slot to choose one from everything on view.</p></aside>
    </form>`;
});

export function favSlot(a, i) {
  return a
    ? html`<div class="fav-slot" data-fav="${a.id}" data-pos="${i}"><img src="${a.thumb_url}" alt="${a.title}" referrerpolicy="no-referrer"><button type="button" class="x" data-action="clear-fav" aria-label="Remove">×</button></div>`
    : html`<button type="button" class="fav-slot" data-fav="" data-pos="${i}" data-action="pick-fav" aria-label="Choose favourite">+</button>`;
}

export { bindStarInputs, poster, toast };
