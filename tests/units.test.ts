import { describe, expect, it } from 'vitest';
import {
  distanceUnit,
  fmtDistance,
  fmtDuration,
  fmtVolume,
  fmtWeight,
  fromKg,
  parseDuration,
  parseNumber,
  toKg,
  toMeters,
} from '../src/lib/units';

describe('units', () => {
  it('stores kg and shows the chosen unit, round-tripping what was typed', () => {
    expect(toKg(100, 'kg')).toBe(100);
    expect(toKg(185, 'lb')).toBe(83.915);
    expect(fmtWeight(toKg(185, 'lb'), 'lb')).toBe('185');
    expect(fmtWeight(toKg(132.5, 'lb'), 'lb')).toBe('132.5');
    for (let lb = 2.5; lb < 700; lb += 2.5) expect(fromKg(toKg(lb, 'lb'), 'lb')).toBe(lb);
    expect(fmtWeight(80, 'lb')).toBe('176.4');
    expect(fmtWeight(81.25, 'kg')).toBe('81.25');
    expect(fmtWeight(undefined, 'kg')).toBe('');
  });

  it('formats volume with separators', () => {
    expect(fmtVolume(12480, 'kg')).toBe('12,480 kg');
    expect(fmtVolume(1000, 'lb')).toBe('2,205 lb');
  });

  it('reads numbers typed with a comma or a point', () => {
    expect(parseNumber('82,5')).toBe(82.5);
    expect(parseNumber(' 82.5 ')).toBe(82.5);
    expect(parseNumber('8')).toBe(8);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('8x')).toBeNaN();
    expect(parseNumber('-5')).toBeNaN();
  });

  it('reads and shows times', () => {
    expect(parseDuration('130')).toBe(90);
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('1.30')).toBe(90);
    expect(parseDuration('1:02:05')).toBe(3725);
    expect(parseDuration('20000')).toBe(7200);
    expect(parseDuration('abc')).toBeNaN();
    expect(fmtDuration(90)).toBe('1:30');
    expect(fmtDuration(3725)).toBe('1:02:05');
    expect(fmtDuration(5)).toBe('0:05');
  });

  it('uses km or miles for cardio and m or yards for carries', () => {
    expect(distanceUnit('distance', 'kg')).toBe('km');
    expect(distanceUnit('distance', 'lb')).toBe('mi');
    expect(distanceUnit('weight_distance', 'lb')).toBe('yd');
    expect(fmtDistance(5000, 'distance', 'kg')).toBe('5');
    expect(fmtDistance(toMeters(3.1, 'mi'), 'distance', 'lb')).toBe('3.1');
    expect(fmtDistance(40, 'weight_distance', 'kg')).toBe('40');
  });
});
