import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_KEY, guessDevice, renameThisDevice, thisDevice } from '../src/lib/sync/device';
import { deviceShown, parsePart, type DevicePart } from '../src/lib/sync/parts';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:141.0) Gecko/20100101 Firefox/141.0',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

describe('device names', () => {
  it('reads the platform and browser', () => {
    expect(guessDevice(UA.iphone)).toEqual({ name: 'iPhone · Safari', type: 'phone' });
    expect(guessDevice(UA.iphone, { standalone: true })).toEqual({ name: 'iPhone · Home Screen app', type: 'phone' });
    expect(guessDevice(UA.ipad, { touchPoints: 5 })).toEqual({ name: 'iPad · Safari', type: 'tablet' });
    expect(guessDevice(UA.ipad, { touchPoints: 0 })).toEqual({ name: 'Mac · Safari', type: 'computer' });
    expect(guessDevice(UA.windowsChrome)).toEqual({ name: 'Windows · Chrome', type: 'computer' });
    expect(guessDevice(UA.windowsEdge)).toEqual({ name: 'Windows · Edge', type: 'computer' });
    expect(guessDevice(UA.windowsChrome, { standalone: true }).name).toBe('Windows · installed app');
    expect(guessDevice(UA.macFirefox).name).toBe('Mac · Firefox');
    expect(guessDevice(UA.android)).toEqual({ name: 'Android phone · Chrome', type: 'phone' });
    expect(guessDevice('something else')).toEqual({ name: 'Browser', type: 'computer' });
  });
});

describe('this device', () => {
  beforeEach(() => localStorage.clear());

  it('keeps one id, and a name the user can change and reset', () => {
    const first = thisDevice();
    expect(first.id).toMatch(/^[a-z0-9-]{8,64}$/i);
    expect(thisDevice().id).toBe(first.id);
    expect(first.custom).toBe(false);
    renameThisDevice('  Kitchen   iPad ');
    expect(thisDevice()).toMatchObject({ id: first.id, name: 'Kitchen iPad', custom: true });
    renameThisDevice('');
    expect(thisDevice()).toMatchObject({ id: first.id, name: first.name, custom: false });
    expect(JSON.parse(localStorage.getItem(DEVICE_KEY)!)).toEqual({ id: first.id });
  });
});

describe('device and retired parts', () => {
  const device: DevicePart = {
    kind: 'device',
    name: 'device:0f5c3a1e-aaaa-bbbb-cccc-123456789abc',
    id: '0f5c3a1e-aaaa-bbbb-cccc-123456789abc',
    deviceName: 'iPhone · Safari',
    type: 'phone',
    version: '2026-09-25 10:31 · 1c5894d',
    seenAt: 1000,
  };

  it('round-trips and validates', () => {
    expect(parsePart(JSON.parse(JSON.stringify(device)))).toEqual(device);
    expect(parsePart({ ...device, type: 'toaster', deviceName: ' x'.repeat(50), name: 'device:other' })).toMatchObject({
      type: 'computer',
      name: `device:${device.id}`,
    });
    expect((parsePart({ ...device, deviceName: 'y'.repeat(100) }) as DevicePart).deviceName).toHaveLength(60);
    expect(parsePart({ ...device, id: 'bad id!' })).toBeUndefined();
    expect(parsePart({ ...device, deviceName: '  ' })).toBeUndefined();
    expect(parsePart({ kind: 'retired', at: 5 })).toEqual({ kind: 'retired', at: 5 });
    expect(parsePart({ kind: 'retired' })).toBeUndefined();
  });

  it('hides a removed device until it is used again', () => {
    expect(deviceShown(device)).toBe(true);
    expect(deviceShown({ ...device, removedAt: 2000 })).toBe(false);
    expect(deviceShown({ ...device, removedAt: 2000, seenAt: 3000 })).toBe(true);
  });
});
