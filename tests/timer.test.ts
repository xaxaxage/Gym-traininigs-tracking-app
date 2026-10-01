import { beforeEach, describe, expect, it } from 'vitest';
import { adjustRest, getRest, restLeft, startRest, stopRest, TIMER_KEY } from '../src/lib/timer';

describe('rest timer', () => {
  beforeEach(() => stopRest());

  it('counts from timestamps, so time in the background is counted', () => {
    const t0 = 1_000_000;
    startRest(90, 'Bench · set 1', 'w1', t0);
    const timer = getRest()!;
    expect(restLeft(timer, t0)).toBe(90);
    expect(restLeft(timer, t0 + 30_500)).toBe(60);
    // The app was in the background for five minutes: the rest is simply over.
    expect(restLeft(timer, t0 + 300_000)).toBe(0);
    expect(JSON.parse(localStorage.getItem(TIMER_KEY)!).endsAt).toBe(t0 + 90_000);
  });

  it('adds and takes off 15 s, never below zero', () => {
    const t0 = 2_000_000;
    startRest(60, '', 'w1', t0);
    adjustRest(15, t0);
    expect(restLeft(getRest()!, t0)).toBe(75);
    adjustRest(-15, t0);
    adjustRest(-15, t0);
    expect(restLeft(getRest()!, t0)).toBe(45);
    adjustRest(-120, t0);
    expect(restLeft(getRest()!, t0)).toBe(0);
    adjustRest(15, t0 + 10_000);
    expect(restLeft(getRest()!, t0 + 10_000)).toBe(15);
  });

  it('skips', () => {
    startRest(60, '', 'w1');
    stopRest();
    expect(getRest()).toBeNull();
    expect(localStorage.getItem(TIMER_KEY)).toBeNull();
  });
});
