import { describe, expect, it } from 'vitest';
import { KEY_PREFIX, ads, loadJson, noAds, saveJson, setAdProvider, type KeyValueStore } from '../src';

const memStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};
const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

describe('storage', () => {
  it('書いて読める。キーには版の前置きが付く', () => {
    const s = memStore();
    expect(saveJson('best', 123, s)).toBe(true);
    expect(s.data.get(KEY_PREFIX + 'best')).toBe('123');
    expect(loadJson('best', 0, isNum, s)).toBe(123);
  });
  it('無いときは fallback', () => {
    expect(loadJson('none', 7, isNum, memStore())).toBe(7);
  });
  it('壊れた JSON・形の違う値は fallback(中身を信用しない)', () => {
    const s = memStore();
    s.data.set(KEY_PREFIX + 'a', '{broken');
    s.data.set(KEY_PREFIX + 'b', '"text"');
    expect(loadJson('a', 1, isNum, s)).toBe(1);
    expect(loadJson('b', 2, isNum, s)).toBe(2);
  });
  it('localStorage が例外を出しても、外に出さず fallback / false を返す', () => {
    expect(loadJson('x', 5, isNum, throwing)).toBe(5);
    expect(saveJson('x', 1, throwing)).toBe(false);
  });
  it('保存先がない環境(null)でも動く', () => {
    expect(loadJson('x', 5, isNum, null)).toBe(5);
    expect(saveJson('x', 1, null)).toBe(false);
  });
  it('既定の保存先(テスト環境には localStorage がない)でも例外を出さない', () => {
    expect(() => loadJson('x', 5, isNum)).not.toThrow();
    expect(() => saveJson('x', 1)).not.toThrow();
  });
});

describe('ads', () => {
  it('既定は広告なしで、unavailable を返す', async () => {
    expect(ads()).toBe(noAds);
    expect(ads().available).toBe(false);
    expect(await ads().showRewarded('retry')).toBe('unavailable');
  });
  it('差し替えられる', async () => {
    setAdProvider({ available: true, showRewarded: async () => 'rewarded' });
    expect(await ads().showRewarded('retry')).toBe('rewarded');
    setAdProvider(noAds);
  });
});
