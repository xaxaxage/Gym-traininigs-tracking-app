/**
 * The app's store keeps its data in localStorage. A server has none (and
 * newer Node versions have a half-working one), so give it an in-memory one:
 * the real copy lives on the sync relays and is pulled fresh on every request.
 * Import this before anything from src/.
 */

export class MemoryStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

for (const name of ['localStorage', 'sessionStorage']) {
  try {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true });
  } catch {
    (globalThis as Record<string, unknown>)[name] = new MemoryStorage();
  }
}

// stdout carries the conversation with Claude, so anything a library prints goes to stderr instead.
console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
