import {
  html, api, session, setUser, navigate, renderRoute, initActions, onAction, toast, closeModal,
  currentQuery, withQuery, appPath,
} from './core.js';
import { posterGrid, bindStarInputs, userUrl, artUrl } from './components.js';
import { editorItem, favSlot } from './views.js';
import { openAuth, submitAuth, openLog, submitLog, openAddToList, openPicker, bindPicker } from './modals.js';

// ---------- nav ----------

function renderNav() {
  const u = session.user;
  const path = appPath();
  const link = (href, label) => html`<a href="${href}" class="${path === href || (href !== '/' && path.startsWith(href)) ? 'active' : ''}">${label}</a>`;
  document.getElementById('nav').innerHTML = String(html`
    ${u ? html`<a href="${userUrl(u.username)}" class="me ${path.startsWith(userUrl(u.username)) ? 'active' : ''}">${u.display_name}</a>`
      : html`<button class="link" data-action="signin">Sign in</button><button class="link" data-action="signup">Create account</button>`}
    ${link('/art', 'Art')}${link('/museums', 'Museums')}${link('/lists', 'Lists')}${link('/members', 'Members')}${link('/activity', 'Activity')}
    ${u ? html`<button class="link" data-action="signout">Sign out</button>` : ''}
    <form class="nav-search" data-submit="search" role="search"><input type="search" name="q" placeholder="Search" aria-label="Search" value="${path === '/search' ? currentQuery().q ?? '' : ''}"></form>
  `);
}
session.listeners.add(renderNav);
document.addEventListener('routechange', () => { renderNav(); afterRender(); });
onAction('toggle-nav', () => document.getElementById('nav').classList.toggle('open'));

// ---------- auth ----------

onAction('signin', () => openAuth('signin'));
onAction('signup', () => openAuth('signup'));
onAction('signin-submit', form => submitAuth(form, 'login'));
onAction('signup-submit', form => submitAuth(form, 'signup'));
onAction('signout', async () => {
  await api('/auth/logout', { method: 'POST' });
  setUser(null);
  toast('Signed out');
  navigate('/');
});

function requireSignIn() {
  if (session.user) return true;
  openAuth('signin');
  return false;
}

// ---------- artwork state ----------

const artworkIdOnPage = () => document.querySelector('[data-artwork]')?.dataset.artwork;

function paintPanel(state) {
  const panel = document.getElementById('action-panel');
  if (!panel) return;
  const labels = { seen: ['Seen', 'Seen it?'], liked: ['Liked', 'Like'], want: ['Want to see', 'Want to see'] };
  panel.querySelectorAll('[data-action=toggle-state]').forEach(b => {
    const on = !!state[b.dataset.k];
    b.classList.toggle('on', on);
    b.querySelector('span').textContent = labels[b.dataset.k][on ? 0 : 1];
  });
  panel.querySelector('.ap-rate > div').textContent = state.rating ? 'Rated' : 'Rate';
}

async function setArtState(id, patch) {
  return api(`/artworks/${encodeURIComponent(id)}/state`, { method: 'PUT', body: patch });
}

onAction('toggle-state', async el => {
  const id = artworkIdOnPage();
  const k = el.dataset.k;
  const state = await setArtState(id, { [k]: !el.classList.contains('on') });
  if (k === 'seen' && !state.seen) {
    renderRoute(false); // un-seeing clears the rating too
    return;
  }
  paintPanel(state);
});

onAction('quick', async el => {
  if (!requireSignIn()) return;
  const id = el.closest('[data-art]').dataset.art;
  const state = await setArtState(id, { [el.dataset.k]: !el.classList.contains('on') });
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', !!state[b.dataset.k]));
});

async function loadArtwork(id) {
  return api(`/artworks/${encodeURIComponent(id)}`);
}

onAction('log', async () => {
  if (!requireSignIn()) return;
  const d = await loadArtwork(artworkIdOnPage());
  openLog(d.artwork, { rating: d.me.rating, liked: !!d.me.liked });
});
onAction('log-submit', form => submitLog(form));
onAction('toggle-heart', el => el.classList.toggle('on'));

onAction('edit-log', async el => {
  const r = await api(`/logs/${el.dataset.id}`);
  openLog(r.artwork, { entry: r });
});
onAction('delete-log', async el => {
  if (!confirm('Delete this diary entry? This cannot be undone.')) return;
  const r = await api(`/logs/${el.dataset.id}`);
  await api(`/logs/${el.dataset.id}`, { method: 'DELETE' });
  toast('Entry deleted');
  navigate(artUrl(r.artwork.id), { replace: true });
});

onAction('add-to-list', async () => {
  const d = await loadArtwork(artworkIdOnPage());
  openAddToList(d.artwork.id, d.me.lists);
});
onAction('toggle-list', async el => {
  const has = !!el.dataset.has;
  const path = `/lists/${el.dataset.list}/items`;
  if (has) await api(`${path}/${encodeURIComponent(el.dataset.art)}`, { method: 'DELETE' });
  else await api(path, { method: 'POST', body: { artwork_id: el.dataset.art } });
  el.dataset.has = has ? '' : '1';
  el.querySelector('.tick').textContent = has ? '' : '✓';
});
onAction('quick-list', async form => {
  const name = new FormData(form).get('name');
  const { id } = await api('/lists', { method: 'POST', body: { name, artwork_ids: [form.dataset.art] } });
  closeModal();
  toast(`Added to “${name}”`);
  navigate(`/list/${id}`);
});

onAction('share', async () => {
  try {
    if (navigator.share) await navigator.share({ title: document.title, url: location.href });
    else { await navigator.clipboard.writeText(location.href); toast('Link copied'); }
  } catch { /* share sheet dismissed */ }
});

onAction('zoom', el => {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img alt="" referrerpolicy="no-referrer">`;
  box.querySelector('img').src = el.dataset.src;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(box);
});

onAction('expand-desc', el => {
  document.getElementById('art-desc')?.classList.remove('clamp');
  el.remove();
});

// ---------- social ----------

onAction('like-review', async el => {
  if (!requireSignIn()) return;
  const on = !!el.dataset.on;
  await api(`/logs/${el.dataset.id}/like`, { method: on ? 'DELETE' : 'POST' });
  const count = Number(el.dataset.count) + (on ? -1 : 1);
  el.dataset.on = on ? '' : '1';
  el.dataset.count = count;
  el.classList.toggle('on', !on);
  el.querySelector('span').textContent = `${on ? 'Like review' : 'Liked'}${count ? ` · ${count}` : ''}`;
});

onAction('follow', async el => {
  if (!requireSignIn()) return;
  const following = !!el.dataset.following;
  await api(`/users/${encodeURIComponent(el.dataset.user)}/follow`, { method: following ? 'DELETE' : 'POST' });
  el.dataset.following = following ? '' : '1';
  el.textContent = following ? 'Follow' : 'Following';
  el.classList.toggle('btn-primary', following);
});

// ---------- browse & search ----------

onAction('filter', (_el, e) => {
  const form = e.target.form;
  const params = Object.fromEntries(new FormData(form));
  navigate(withQuery(appPath(), params), { scroll: false });
});

onAction('load-more', async el => {
  const museum = appPath().match(/^\/museum\/([^/]+)/)?.[1];
  el.disabled = true;
  const res = await api(withQuery('/artworks', { sort: 'popular', ...currentQuery(), museum, page: el.dataset.page }));
  const tmp = document.createElement('div');
  tmp.innerHTML = String(posterGrid(res.items, { quick: true }));
  document.querySelector('#browse-grid .poster-grid').append(...tmp.firstElementChild.children);
  if (res.page < res.pages) { el.dataset.page = res.page + 1; el.disabled = false; } else el.parentElement.remove();
});

onAction('search', form => {
  const q = new FormData(form).get('q').trim();
  if (q) navigate(withQuery('/search', { q }));
});

// ---------- lists ----------

onAction('remove-item', el => el.closest('[data-item]').remove());

onAction('save-list', async form => {
  const fd = new FormData(form);
  const artwork_ids = [...form.querySelectorAll('[data-item]')].map(n => n.dataset.item);
  const body = { name: fd.get('name'), description: fd.get('description') };
  let id = form.dataset.id;
  if (id) {
    await api(`/lists/${id}`, { method: 'PATCH', body });
    // Rebuild membership and order from the editor.
    const current = await api(`/lists/${id}`);
    for (const a of current.items) await api(`/lists/${id}/items/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
    for (const aid of artwork_ids) await api(`/lists/${id}/items`, { method: 'POST', body: { artwork_id: aid } });
  } else {
    ({ id } = await api('/lists', { method: 'POST', body: { ...body, artwork_ids } }));
  }
  toast('List saved');
  navigate(`/list/${id}`);
});

onAction('delete-list', async el => {
  if (!confirm('Delete this list?')) return;
  await api(`/lists/${el.dataset.id}`, { method: 'DELETE' });
  toast('List deleted');
  navigate(userUrl(session.user.username, 'lists'));
});

// ---------- settings ----------

onAction('pick-fav', el => {
  openPicker('Pick a favourite', a => {
    el.outerHTML = String(favSlot(a, Number(el.dataset.pos)));
  });
});
onAction('clear-fav', el => {
  const slot = el.closest('.fav-slot');
  slot.outerHTML = String(favSlot(null, Number(slot.dataset.pos)));
});
onAction('save-profile', async form => {
  const fd = new FormData(form);
  const favorites = [...form.querySelectorAll('[data-fav]')].map(n => n.dataset.fav || null);
  await api('/me', { method: 'PATCH', body: { display_name: fd.get('display_name'), bio: fd.get('bio'), favorites } });
  const { user } = await api('/me');
  setUser(user);
  toast('Profile saved');
  navigate(userUrl(user.username));
});

// ---------- per-page wiring after each render ----------

function afterRender() {
  const main = document.getElementById('main');
  const artId = artworkIdOnPage();
  if (artId) {
    bindStarInputs(main, async rating => {
      if (!session.user) return;
      const state = await setArtState(artId, { rating });
      paintPanel(state);
      toast(rating ? `Rated ${rating} ★` : 'Rating removed');
    });
  }
  const picker = main.querySelector('[data-picker=list]');
  if (picker) {
    bindPicker(picker, main.querySelector('#picker-results'), a => {
      const items = main.querySelector('#list-items');
      if (!items.querySelector(`[data-item="${CSS.escape(a.id)}"]`)) items.insertAdjacentHTML('beforeend', String(editorItem(a)));
      picker.value = '';
      main.querySelector('#picker-results').innerHTML = '';
      picker.focus();
    });
    picker.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  }
}

// ---------- boot ----------

initActions();
const { user } = await api('/me').catch(() => ({ user: null }));
session.user = user;
renderNav();
renderRoute();
