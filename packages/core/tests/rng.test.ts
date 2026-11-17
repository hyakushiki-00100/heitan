import { describe, expect, it } from 'vitest';
import { Rng } from '../src';

describe('Rng', () => {
  it('同じシードなら同じ列', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });
  it('違うシードなら違う列', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
  it('0以上1未満、intは範囲内', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});
