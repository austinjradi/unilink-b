// 'second-factor': the six-digit codes an authenticator app shows (RFC 6238).
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function newTotpSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => BASE32[b % 32]).join('');
}

function decode(secret: string) {
  let bits = '';
  for (const c of secret.toUpperCase()) bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  return Uint8Array.from(bits.match(/.{8}/g) ?? [], (byte) => parseInt(byte, 2));
}

export async function totpCode(secret: string, at: Date) {
  const key = await crypto.subtle.importKey('raw', decode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(Math.floor(at.getTime() / 1000 / STEP_SECONDS)));
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter.buffer));
  const offset = hash[hash.length - 1] & 0xf;
  const number = new DataView(hash.buffer).getUint32(offset) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, '0');
}

// A step either way, since a phone's clock can be a little off.
export async function checkTotp(secret: string, code: string, at: Date) {
  for (const step of [-1, 0, 1]) {
    if ((await totpCode(secret, new Date(at.getTime() + step * STEP_SECONDS * 1000))) === code.trim()) return true;
  }
  return false;
}
