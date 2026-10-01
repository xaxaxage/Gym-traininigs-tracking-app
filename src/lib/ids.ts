/** Short random ids: 16 characters (~82 bits) for items, 8 for sets and exercises inside a workout. */
export function newId(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}

export const shortId = () => newId(8);

export function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value);
}
