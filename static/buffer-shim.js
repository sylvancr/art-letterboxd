// The slice of Node's Buffer that server/auth.js uses.
const b64 = bytes => btoa(String.fromCharCode(...bytes));
export class Buffer extends Uint8Array {
  static from(value, encoding) {
    if (typeof value === 'string') {
      if (encoding !== 'base64') throw new Error(`unsupported encoding ${encoding}`);
      return new Buffer([...atob(value)].map(c => c.charCodeAt(0)));
    }
    return new Buffer(value);
  }
  toString(encoding) {
    if (encoding === 'base64') return b64(this);
    if (encoding === 'base64url') return b64(this).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (encoding === 'hex') return [...this].map(x => x.toString(16).padStart(2, '0')).join('');
    return new TextDecoder().decode(this);
  }
}
