import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string | Buffer, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

/**
 * hash(HMAC(pin, PIN_PEPPER)). The pepper is a server secret that never touches the DB,
 * so a leaked table cannot be brute-forced offline across the tiny 4–6 digit PIN space.
 */
export async function hashPin(pin: string, pepper: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(createHmac('sha256', pepper).update(pin).digest(), salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPin(pin: string, stored: string, pepper: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const actual = await scrypt(createHmac('sha256', pepper).update(pin).digest(), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Device and approval tokens are high-entropy, so a fast hash is sufficient for lookup. */
export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
