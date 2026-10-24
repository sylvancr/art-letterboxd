// Just enough of Express for server/app.js to run in the browser against an in-page request object.

function compile(path) {
  if (path instanceof RegExp) return { re: path, keys: [] };
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}

export default function express() {
  const layers = [];
  const add = (method, path, handlers) => {
    if (typeof path === 'function') { handlers = [path, ...handlers]; path = null; }
    for (const fn of handlers) layers.push({ method, path, match: path && method ? compile(path) : null, fn });
  };
  const app = {
    disable() {},
    use: (path, ...fns) => add(null, path, fns),
    get: (path, ...fns) => add('GET', path, fns),
    post: (path, ...fns) => add('POST', path, fns),
    put: (path, ...fns) => add('PUT', path, fns),
    patch: (path, ...fns) => add('PATCH', path, fns),
    delete: (path, ...fns) => add('DELETE', path, fns),

    // Resolves to { status, data, cookie } once a handler calls res.json().
    handle({ method, url, body, cookie }) {
      return new Promise(resolve => {
        const u = new URL(url, 'http://local');
        const req = {
          method, path: u.pathname, url, body: body ?? {},
          query: Object.fromEntries(u.searchParams),
          headers: { cookie: cookie ?? '' },
          params: {},
          is: type => type === 'application/json' && method !== 'GET',
        };
        let setCookie = null;
        const res = {
          statusCode: 200,
          status(n) { this.statusCode = n; return this; },
          setHeader(name, value) { if (name.toLowerCase() === 'set-cookie') setCookie = value; },
          json(data) { resolve({ status: this.statusCode, data, setCookie }); },
          sendFile() { resolve({ status: 404, data: { error: 'Not found' } }); },
        };
        let i = 0;
        const next = err => {
          while (i < layers.length) {
            const layer = layers[i++];
            if (layer.method && layer.method !== method) continue;
            if (layer.match) {
              const m = req.path.match(layer.match.re);
              if (!m) continue;
              req.params = Object.fromEntries(layer.match.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]));
            } else if (layer.path && !req.path.startsWith(layer.path)) continue;
            const isErrorHandler = layer.fn.length === 4;
            if (err ? !isErrorHandler : isErrorHandler) continue;
            try {
              return err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
            } catch (e) { return next(e); }
          }
          resolve({ status: err ? 500 : 404, data: { error: err ? 'Something went wrong.' : 'Not found' } });
        };
        next();
      });
    },
  };
  return app;
}
express.json = () => (_req, _res, next) => next();
express.static = () => (_req, _res, next) => next();
