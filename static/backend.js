// Runs the real Salon API (server/app.js) inside the page for the GitHub Pages prototype.
// The catalog snapshot ships with the site; everything a visitor does is saved in their browser.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { setSqlite, DatabaseSync } from './sqlite-shim.js';
import { createApp } from '../server/app.js';

const COOKIE_KEY = 'salon:session';
const IDB = { name: 'salon-prototype', store: 'db', key: 'main' };

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB.name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(IDB.store);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction(IDB.store, mode).objectStore(IDB.store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

function deserialize(sqlite3, bytes) {
  const db = new sqlite3.oo1.DB(':memory:');
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const { capi } = sqlite3;
  const rc = capi.sqlite3_deserialize(db.pointer, 'main', p, bytes.length, bytes.length,
    capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
  db.checkRc(rc);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

async function boot() {
  const base = new URL(document.baseURI);
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  setSqlite(sqlite3);
  const version = (await (await fetch(new URL('data/version.txt', base))).text()).trim();

  // Saved state is tied to the snapshot it grew from; a new deploy starts fresh.
  let saved = null;
  try { saved = await idb('readonly', s => s.get(IDB.key)); } catch { /* storage unavailable */ }
  let bytes;
  if (saved?.version === version) bytes = saved.bytes;
  else {
    bytes = new Uint8Array(await (await fetch(new URL(`data/salon.db?v=${version}`, base))).arrayBuffer());
    localStorage.removeItem(COOKIE_KEY);
  }
  const raw = deserialize(sqlite3, bytes);
  const app = createApp(new DatabaseSync(raw));

  let saveTimer;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const data = sqlite3.capi.sqlite3_js_db_export(raw.pointer);
      idb('readwrite', s => s.put({ version, bytes: data }, IDB.key)).catch(() => {});
    }, 300);
  };

  return async function request(method, url, body) {
    const token = localStorage.getItem(COOKIE_KEY);
    const res = await app.handle({ method, url, body, cookie: token ? `salon_session=${token}` : '' });
    if (res.setCookie) {
      const [pair] = res.setCookie.split(';');
      const value = pair.split('=')[1];
      if (!value || /Max-Age=0/.test(res.setCookie)) localStorage.removeItem(COOKIE_KEY);
      else localStorage.setItem(COOKIE_KEY, value);
    }
    if (method !== 'GET') persist();
    return res;
  };
}

window.salonLocal = boot();
