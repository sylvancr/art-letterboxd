// Small runtime: escaped templates, API client, session state, router, modal and toast.

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
export const raw = s => new Safe(String(s));
const render = v => v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(render).join('') : esc(v);
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}

// ---------- API ----------

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// On GitHub Pages the API runs inside the page (static/backend.js) instead of on a server.
export async function api(path, { method = 'GET', body } = {}) {
  if (window.salonLocal) {
    const request = await window.salonLocal;
    const res = await request(method, `/api${path}`, body);
    if (res.status >= 400) throw new ApiError(res.status, res.data?.error || `Request failed (${res.status})`);
    return res.data;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- session ----------

export const session = { user: null, listeners: new Set() };
export function setUser(user) {
  session.user = user;
  session.listeners.forEach(fn => fn(user));
}

// ---------- routing ----------

// The site may be served from a sub-path (e.g. /art-letterboxd/ on GitHub Pages), set by <base href>.
// App code always deals in root-relative paths like "/art"; these helpers add and strip the prefix.
export const BASE = new URL(document.baseURI).pathname.replace(/\/$/, '');
export const appPath = (pathname = location.pathname) =>
  (BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname) || '/';

function prefixLinks(root) {
  if (!BASE || root.nodeType !== 1) return;
  const links = root.matches('a[href^="/"]') ? [root] : root.querySelectorAll('a[href^="/"]');
  for (const a of links) {
    const href = a.getAttribute('href');
    if (!href.startsWith(`${BASE}/`) && href !== BASE) a.setAttribute('href', BASE + href);
  }
}

const routes = [];
export function route(pattern, view) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, view });
}

let renderToken = 0;
export async function navigate(url, { replace = false, scroll = true } = {}) {
  if (url !== appPath() + location.search) {
    history[replace ? 'replaceState' : 'pushState']({}, '', BASE + url);
  }
  await renderRoute(scroll);
}

export async function renderRoute(scroll = true) {
  const token = ++renderToken;
  const main = document.getElementById('main');
  const path = decodeURIComponent(appPath());
  const query = Object.fromEntries(new URLSearchParams(location.search));
  closeModal();
  document.getElementById('nav')?.classList.remove('open');
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    main.innerHTML = '<div class="loading">Loading</div>';
    if (scroll) window.scrollTo(0, 0);
    try {
      const out = await r.view({ params, query, main, isCurrent: () => token === renderToken });
      if (token !== renderToken) return;
      if (out !== undefined) main.innerHTML = String(out);
    } catch (err) {
      if (token !== renderToken) return;
      main.innerHTML = String(html`<div class="empty"><h1 class="page-title">${err.status === 404 ? 'Not found' : 'Something went wrong'}</h1><p>${err.message}</p><a class="btn" href="/">Back home</a></div>`);
    }
    document.dispatchEvent(new CustomEvent('routechange', { detail: { path } }));
    return;
  }
  main.innerHTML = String(html`<div class="empty"><h1 class="page-title">Page not found</h1><a class="btn" href="/">Back home</a></div>`);
}

export function currentQuery() {
  return Object.fromEntries(new URLSearchParams(location.search));
}

export function withQuery(path, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

// ---------- actions (event delegation) ----------

const actions = {};
export function onAction(name, fn) { actions[name] = fn; }
export function initActions() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) {
      e.preventDefault();
      Promise.resolve(actions[el.dataset.action](el, e)).catch(showError);
      return;
    }
    const a = e.target.closest('a[href]');
    if (a && a.origin === location.origin && !a.target && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      navigate(appPath(a.pathname) + a.search);
    }
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest('form[data-submit]');
    if (form && actions[form.dataset.submit]) {
      e.preventDefault();
      Promise.resolve(actions[form.dataset.submit](form, e)).catch(err => {
        const box = form.querySelector('.form-error');
        if (box) box.textContent = err.message; else showError(err);
      });
    }
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el && actions[el.dataset.change]) Promise.resolve(actions[el.dataset.change](el, e)).catch(showError);
  });
  // Museum image hosts occasionally 404; fall back to the title card behind the image.
  document.addEventListener('error', e => {
    if (e.target.tagName === 'IMG') e.target.classList.add('broken');
  }, true);
  window.addEventListener('popstate', () => renderRoute(false));
  if (BASE) {
    prefixLinks(document.body);
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(prefixLinks)))
      .observe(document.body, { childList: true, subtree: true });
  }
}

// ---------- modal & toast ----------

let modalCleanup = null;
export function openModal(content, { wide = false, title = '', onClose } = {}) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = String(html`
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal-head"><h2>${title}</h2><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div>
        <div class="modal-body">${content}</div>
      </div>
    </div>`);
  const backdrop = root.firstElementChild;
  const onKey = e => { if (e.key === 'Escape') closeModal(); };
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', onKey);
  modalCleanup = () => { document.removeEventListener('keydown', onKey); onClose?.(); };
  backdrop.querySelector('[autofocus]')?.focus();
  return backdrop.querySelector('.modal');
}
export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root?.firstChild) return;
  root.innerHTML = '';
  const fn = modalCleanup; modalCleanup = null; fn?.();
}
onAction('close-modal', closeModal);

let toastTimer;
export function toast(message, { error = false } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}
export function showError(err) {
  console.error(err);
  toast(err.message || 'Something went wrong', { error: true });
}

// ---------- formatting ----------

export const plural = (n, word, many = `${word}s`) => `${Number(n).toLocaleString()} ${n === 1 ? word : many}`;
export function ago(ts) {
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export function longDate(day) {
  const d = new Date(day.length === 10 ? `${day}T12:00:00` : day.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
