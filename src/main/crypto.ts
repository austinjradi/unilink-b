import { scrypt, scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

// Browser stand-ins for the node:crypto calls the desktop app makes. Web Crypto has no
// scrypt and is missing on plain-http origins (a phone on the LAN), so this uses
// @noble/hashes. The scrypt settings are Node's defaults, so hashes match the desktop's.

// scrypt's cost settings: N is the CPU and memory cost (a power of
// two), r the block size, p how many times it runs in parallel.
const SCRYPT = { N: 16384, r: 8, p: 1 };

// Cryptographically secure random bytes as hex text, two characters per byte.
export const randomHex = (bytes: number) => bytesToHex(randomBytes(bytes));

export const sha256Hex = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));

// The async version lets the browser keep working while it hashes, so signing in
// doesn't freeze the page. The Sync version below is used when seeding demo accounts.
export async function scryptHex(password: string, saltHex: string, keylen: number) {
  return bytesToHex(await scryptAsync(password, hexToBytes(saltHex), { ...SCRYPT, dkLen: keylen }));
}

export function scryptHexSync(password: string, saltHex: string, keylen: number) {
  return bytesToHex(scrypt(password, hexToBytes(saltHex), { ...SCRYPT, dkLen: keylen }));
}

// An integer in [min, max), without modulo bias.
// A plain `random % range` would make some results slightly more likely than others.
// Draws from the uneven top slice of the 32-bit range are thrown away and drawn again.
export function randomInt(min: number, max: number) {
  const range = max - min;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buf = new Uint32Array(1);
  // do … while runs its body at least once. getRandomValues fills the array with secure random numbers.
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return min + (buf[0] % range);
}

// A version 4 UUID: 16 random bytes, with a few bits set to mark
// the version (4) and the variant, as the standard requires.
export function randomUUID() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Compares every character even after a mismatch, so the time taken doesn't reveal how much
// of a guess was right. XOR (^) gives 0 for equal characters, and `|=` keeps any difference.
export function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
