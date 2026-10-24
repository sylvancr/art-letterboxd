// A node:sqlite-compatible DatabaseSync facade over the official SQLite WebAssembly build.
let sqlite3;
export function setSqlite(s) { sqlite3 = s; }

const bindOf = params => {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) return params[0];
  return params.length ? params : undefined;
};

export class DatabaseSync {
  constructor(db) { this.db = db instanceof sqlite3.oo1.DB ? db : new sqlite3.oo1.DB(':memory:'); }
  exec(sql) { this.db.exec(sql); }
  prepare(sql) {
    const db = this.db;
    const rows = params => db.exec({ sql, bind: bindOf(params), rowMode: 'object', returnValue: 'resultRows' });
    return {
      all: (...p) => rows(p),
      get: (...p) => rows(p)[0],
      run: (...p) => {
        db.exec({ sql, bind: bindOf(p) });
        return { changes: db.changes(), lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(db.pointer)) };
      },
    };
  }
}
