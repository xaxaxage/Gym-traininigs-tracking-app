import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { isValidPhrase, normalizePhrase } from '../src/lib/sync/crypto';

/**
 * Connector addresses for everyone using a shared connector: the person's
 * sync key, sealed with the server's secret, becomes the last part of their
 * address. Only this server can open it, so the address doesn't reveal the
 * key (to Claude's connector settings, or to anyone who sees it), and
 * changing the server's secret retires every address at once.
 *
 * The sealed form is 60 characters: a version byte, then the key's 16 bytes
 * of entropy with AES-256-GCM. The nonce comes from an HMAC of the entropy,
 * so a key always seals to the same address (a random 128-bit message never
 * repeats, so the nonce doesn't either).
 */

const VERSION = 1;
const AAD = new TextEncoder().encode('gym-tracker-connector/v1');

export interface SealKeys {
  enc: CryptoKey;
  mac: CryptoKey;
}

async function hkdf(secret: Uint8Array, info: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('gym-tracker-connector'), info: new TextEncoder().encode(info) },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** Keys for sealing, from the server's secret (any long random text, or bytes derived from one). */
export async function sealKeys(secret: string | Uint8Array): Promise<SealKeys> {
  const raw = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
  const [enc, mac] = await Promise.all([hkdf(raw, 'seal-encryption'), hkdf(raw, 'seal-nonce')]);
  return {
    enc: await crypto.subtle.importKey('raw', enc as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']),
    mac: await crypto.subtle.importKey('raw', mac as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  };
}

const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

/** The sealed form of a 12-word sync key. */
export async function seal(keys: SealKeys, phrase: string): Promise<string> {
  const normal = normalizePhrase(phrase);
  if (!isValidPhrase(normal)) throw new Error('Not a valid 12-word sync key.');
  const entropy = mnemonicToEntropy(normal, wordlist);
  const iv = new Uint8Array(await crypto.subtle.sign('HMAC', keys.mac, entropy as BufferSource)).slice(0, 12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, keys.enc, entropy as BufferSource));
  const out = new Uint8Array(1 + iv.length + sealed.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(sealed, 1 + iv.length);
  return toBase64Url(out);
}

/** The sync key inside a sealed address, or null if this server didn't seal it (or it was altered). */
export async function unseal(keys: SealKeys, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{60}$/.test(token)) return null;
  const bytes = new Uint8Array(Buffer.from(token, 'base64url'));
  if (bytes.length !== 45 || bytes[0] !== VERSION) return null;
  try {
    const entropy = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(1, 13), additionalData: AAD },
      keys.enc,
      bytes.slice(13) as BufferSource,
    );
    return entropyToMnemonic(new Uint8Array(entropy), wordlist);
  } catch {
    return null;
  }
}
