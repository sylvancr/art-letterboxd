import { html, api, openModal, closeModal, setUser, renderRoute, toast, todayISO, withQuery } from './core.js';
import { posterImg, starInput, bindStarInputs, icon } from './components.js';

// ---------- sign in / sign up ----------

export function openAuth(mode = 'signin') {
  const signup = mode === 'signup';
  const modal = openModal(html`
    <form data-submit="${signup ? 'signup-submit' : 'signin-submit'}">
      <div class="form-error"></div>
      <label class="field"><span>Username</span><input type="text" name="username" autocomplete="username" required autofocus></label>
      ${signup ? html`<label class="field"><span>Display name (optional)</span><input type="text" name="display_name" maxlength="60"></label>` : ''}
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="${signup ? 8 : 1}"></label>
      <div class="modal-foot"><button class="btn btn-primary">${signup ? 'Create account' : 'Sign in'}</button></div>
      <div class="auth-switch">${signup ? html`Already a member? <button type="button" class="link-btn" data-action="signin">Sign in</button>`
        : html`New here? <button type="button" class="link-btn" data-action="signup">Create an account</button>`}</div>
    </form>`, { title: signup ? 'Join Salon' : 'Sign in' });
  modal.querySelector('input[name=username]').focus();
}

export async function submitAuth(form, kind) {
  const body = Object.fromEntries(new FormData(form));
  const { user } = await api(`/auth/${kind}`, { method: 'POST', body });
  setUser(user);
  closeModal();
  toast(kind === 'signup' ? `Welcome to Salon, ${user.display_name}!` : `Welcome back, ${user.display_name}.`);
  renderRoute(false);
}

// ---------- log / review ----------

// `entry` is an existing diary entry when editing.
export function openLog(artwork, { entry = null, rating = null, liked = false } = {}) {
  const editing = !!entry;
  const seenOn = entry ? entry.seen_on : todayISO();
  const modal = openModal(html`
    <form data-submit="log-submit" data-art="${artwork.id}" data-entry="${entry?.id ?? ''}">
      <div class="log-grid">
        ${posterImg(artwork)}
        <div>
          <div class="log-title">${artwork.title} ${artwork.date_display ? html`<span class="yr">${artwork.date_display}</span>` : ''}</div>
          <div class="form-error"></div>
          <div class="log-row">
            <label class="check"><input type="checkbox" name="has_date" ${seenOn ? 'checked' : ''}> Seen on</label>
            <input type="date" name="seen_on" value="${seenOn ?? todayISO()}" max="${todayISO()}" style="width:auto">
          </div>
          <div class="log-row"><label class="check"><input type="checkbox" name="revisit" ${entry?.revisit ? 'checked' : ''}> I've seen this before</label></div>
          <textarea name="body" placeholder="Add a review…" maxlength="8000">${entry?.body ?? ''}</textarea>
          <div class="log-rate">
            <div><span class="lbl">Rating</span>${starInput(entry ? entry.rating : rating, 'log')}</div>
            <div><span class="lbl">Like</span><button type="button" class="heart-toggle ${(entry ? entry.liked : liked) ? 'on' : ''}" data-action="toggle-heart">${icon('heart')}</button></div>
          </div>
          <div class="modal-foot"><button class="btn btn-primary">${editing ? 'Save' : 'Save'}</button></div>
        </div>
      </div>
    </form>`, { title: editing ? 'Edit diary entry' : 'I saw…', wide: true });
  bindStarInputs(modal);
  const dateInput = modal.querySelector('input[name=seen_on]');
  const hasDate = modal.querySelector('input[name=has_date]');
  const sync = () => { dateInput.disabled = !hasDate.checked; };
  hasDate.addEventListener('change', sync);
  sync();
  modal.querySelector('textarea').focus();
}

export async function submitLog(form) {
  const fd = new FormData(form);
  const rating = form.querySelector('[data-star-input]').dataset.value;
  const body = {
    seen_on: fd.get('has_date') ? fd.get('seen_on') : null,
    revisit: !!fd.get('revisit'),
    body: fd.get('body'),
    rating: rating ? Number(rating) : null,
    liked: form.querySelector('.heart-toggle').classList.contains('on'),
  };
  if (form.dataset.entry) {
    await api(`/logs/${form.dataset.entry}`, { method: 'PATCH', body });
  } else {
    await api(`/artworks/${encodeURIComponent(form.dataset.art)}/logs`, { method: 'POST', body });
  }
  closeModal();
  toast(body.body.trim() ? 'Review saved' : 'Added to your diary');
  renderRoute(false);
}

// ---------- lists ----------

export function openAddToList(artworkId, lists) {
  openModal(html`
    <div>${lists.length ? lists.map(l => html`<button class="list-check" data-action="toggle-list" data-list="${l.id}" data-art="${artworkId}" data-has="${l.has ? 1 : ''}">
        <span>${l.name}</span><span class="tick">${l.has ? '✓' : ''}</span></button>`)
      : html`<p class="muted" style="color:#bcd">You don't have any lists yet.</p>`}</div>
    <form data-submit="quick-list" data-art="${artworkId}" style="display:flex;gap:8px;margin-top:16px">
      <input type="text" name="name" placeholder="New list name…" required maxlength="120">
      <button class="btn btn-primary">Create</button>
    </form>`, { title: 'Add to lists' });
}

// ---------- artwork picker (favourites, list editor) ----------

export function bindPicker(input, resultsEl, onPick) {
  let timer, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      const mine = ++seq;
      if (!q) { resultsEl.innerHTML = ''; return; }
      const res = await api(withQuery('/artworks', { q }));
      if (mine !== seq) return;
      resultsEl.innerHTML = String(res.items.length ? html`${res.items.slice(0, 20).map(a => html`
        <button type="button" data-pick="${a.id}">${posterImg(a)}<span><span class="t">${a.title}</span><br><span class="s">${a.artist ?? ''}${a.date_display ? ` · ${a.date_display}` : ''}</span></span></button>`)}`
        : html`<p class="muted">No matches on view.</p>`);
      resultsEl.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () =>
        onPick(res.items.find(a => a.id === b.dataset.pick))));
    }, 220);
  });
}

export function openPicker(title, onPick) {
  const modal = openModal(html`
    <input type="search" placeholder="Search artworks on view…" autofocus autocomplete="off" aria-label="Search artworks">
    <div class="picker-results"></div>`, { title });
  const input = modal.querySelector('input');
  bindPicker(input, modal.querySelector('.picker-results'), a => { closeModal(); onPick(a); });
  input.focus();
}
