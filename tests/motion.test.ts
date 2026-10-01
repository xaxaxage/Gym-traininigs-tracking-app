import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

// Load the store and motion modules fresh for each test, so they share one store.
async function load() {
  const store = await import('../src/lib/store');
  const motion = await import('../src/lib/motion');
  return { ...store, ...motion };
}

describe('animations switch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is on by default and follows the setting', async () => {
    const { applyMotion, motionOn, updateSettings } = await load();
    applyMotion();
    expect(motionOn()).toBe(true);
    expect(document.documentElement.dataset.motion).toBe('on');
    updateSettings({ animations: false });
    applyMotion();
    expect(document.documentElement.dataset.motion).toBe('off');
  });

  it("stays off when the phone asks for reduced motion", async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {} }));
    const { motionOn, systemReducesMotion } = await load();
    expect(systemReducesMotion()).toBe(true);
    expect(motionOn()).toBe(false);
  });

  it('shows numbers straight away when off', async () => {
    const { useCountUp, updateSettings } = await load();
    updateSettings({ animations: false });
    const root = document.createElement('div');
    const Counter = ({ n }: { n: number }) => h('span', null, String(Math.round(useCountUp('test', n))));
    act(() => render(h(Counter, { n: 1326 }), root));
    expect(root.textContent).toBe('1326');
    act(() => render(h(Counter, { n: 1500 }), root));
    expect(root.textContent).toBe('1500');
  });

  it('turns off every animation except the loading spinner', () => {
    const css = readFileSync('src/motion.css', 'utf8');
    expect(css).toMatch(/html\[data-motion='off'\] \*:not\(\.spinner\)[\s\S]*animation: none !important;[\s\S]*transition: none !important;/);
  });
});
