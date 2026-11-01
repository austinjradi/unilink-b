import { scrypt, scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

// Browser stand-ins for the node:crypto calls the desktop app makes. Web Crypto has no
// scrypt and is missing on plain-http origins (a phone on the LAN), so this uses
// @noble/hashes. The scrypt settings are Node's defaults, so hashes match the desktop's.

const SCRYPT = { N: 16384, r: 8, p: 1 };

export const randomHex = (bytes: number) => bytesToHex(randomBytes(bytes));

export const sha256Hex = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));

export async function scryptHex(password: string, saltHex: string, keylen: number) {
  return bytesToHex(await scryptAsync(password, hexToBytes(saltHex), { ...SCRYPT, dkLen: keylen }));
}

export function scryptHexSync(password: string, saltHex: string, keylen: number) {
  return bytesToHex(scrypt(password, hexToBytes(saltHex), { ...SCRYPT, dkLen: keylen }));
}

// An integer in [min, max), without modulo bias.
export function randomInt(min: number, max: number) {
  const range = max - min;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return min + (buf[0] % range);
}

export function randomUUID() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
