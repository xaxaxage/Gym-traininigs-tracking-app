import { generateMnemonic, mnemonicToSeedWebcrypto, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { getPublicKey } from 'nostr-tools/pure';

/**
 * The sync key is a 12-word phrase (the standard BIP-39 format that note apps and crypto
 * wallets use). Everything else is derived from it on the device:
 * - a signing key, so relays accept updates only from holders of the phrase,
 * - an AES-256-GCM key that encrypts all data before it leaves the phone,
 * - a key that turns part names ("2026-09") into opaque labels.
 * Relays only ever see the public key, opaque labels and ciphertext.
 */

export function newPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

/** Lower-case, single spaces, no punctuation — so pasted or dictated phrases still work. */
export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export function isValidPhrase(text: string): boolean {
  const phrase = normalizePhrase(text);
  return phrase.split(' ').length === 12 && validateMnemonic(phrase, wordlist);
}

/**
 * This app's own salt: the same 12 words used in the calorie tracker (or any
 * other app) give completely different keys, labels and signing keys here,
 * so the apps can never read, mix up or overwrite each other's data.
 */
export const SALT = 'gym-tracker-sync';

export interface SyncKeys {
  secretKey: Uint8Array;
  pubkey: string;
  encKey: CryptoKey;
  nameKey: CryptoKey;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hkdf(seed: CryptoKey, info: string, bits = 256): Promise<Uint8Array> {
  const out = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(SALT), info: enc.encode(info) },
    seed,
    bits,
  );
  return new Uint8Array(out);
}

export async function deriveKeys(phrase: string): Promise<SyncKeys> {
  const seed = await mnemonicToSeedWebcrypto(normalizePhrase(phrase));
  const base = await crypto.subtle.importKey('raw', seed as BufferSource, 'HKDF', false, ['deriveBits']);

  let secretKey: Uint8Array | undefined;
  let pubkey = '';
  // A derived value is almost never an invalid curve key, but try the next one if it is.
  for (let i = 0; !secretKey; i++) {
    const candidate = await hkdf(base, `nostr-signing-key/${i}`);
    try {
      pubkey = getPublicKey(candidate);
      secretKey = candidate;
    } catch {
      // try again
    }
  }

  const encKey = await crypto.subtle.importKey(
    'raw',
    (await hkdf(base, 'data-encryption-key')) as BufferSource,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
  const nameKey = await crypto.subtle.importKey(
    'raw',
    (await hkdf(base, 'part-name-key')) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return { secretKey, pubkey, encKey, nameKey };
}

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The secret part of an older, single-person connector address. Anyone with
 * the address can use the training log through it, so it's as unguessable as a key
 * (128 bits) and derived from the sync key: it changes when the key does, and
 * doesn't reveal the key.
 */
export async function connectorToken(phrase: string): Promise<string> {
  const seed = await mnemonicToSeedWebcrypto(normalizePhrase(phrase));
  const base = await crypto.subtle.importKey('raw', seed as BufferSource, 'HKDF', false, ['deriveBits']);
  return hex(await hkdf(base, 'claude-connector-address', 128));
}

/** Opaque, stable label for a part name, so relays can't see which months you trained. */
export async function partLabel(nameKey: CryptoKey, name: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', nameKey, enc.encode(`part:${name}`))).slice(0, 32);
}

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const out = new Response(input.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** "1z:<base64>" (gzip) or "1j:<base64>" (plain JSON) — IV followed by AES-GCM ciphertext. */
export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  let body: Uint8Array = enc.encode(text);
  let flag = 'j';
  if (canCompress) {
    body = await pipe(body, new CompressionStream('gzip'));
    flag = 'z';
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body as BufferSource));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv);
  packed.set(cipher, iv.length);
  return `1${flag}:${toBase64(packed)}`;
}

export async function decryptText(key: CryptoKey, content: string): Promise<string> {
  const m = /^1([zj]):(.+)$/s.exec(content);
  if (!m) throw new Error('Unknown sync data format');
  const packed = fromBase64(m[2]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.subarray(0, 12) as BufferSource },
      key,
      packed.subarray(12) as BufferSource,
    ),
  );
  if (m[1] === 'j') return dec.decode(plain);
  if (!canCompress) throw new Error('This browser cannot read compressed sync data');
  return dec.decode(await pipe(plain, new DecompressionStream('gzip')));
}
