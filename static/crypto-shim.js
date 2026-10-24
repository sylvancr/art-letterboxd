import { scrypt } from '@noble/hashes/scrypt';
import { Buffer } from './buffer-shim.js';

export const randomBytes = n => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
// Same parameters as Node's scryptSync defaults, so hashes made by the Node server verify here.
export const scryptSync = (password, salt, keylen) => Buffer.from(scrypt(password, salt, { N: 16384, r: 8, p: 1, dkLen: keylen }));
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
