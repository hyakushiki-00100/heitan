import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, type ShareV1 } from '../src';

const sample: ShareV1 = {
  scenario: 'b-02',
  seed: 3735928559,
  cards: ['kiro', 'chukei'],
  outcome: 'done',
  score: 552.4,
  stars: 2,
  troopsHome: 24,
  carriersHome: 35,
  surplus: 16.6,
};

describe('共有文字列 HY1', () => {
  it('形は HY1-本体-チェックサム8桁。読み戻すと同じ中身(カードは並べ替えて保存)', () => {
    const code = encodeShare(sample);
    expect(code).toMatch(/^HY1-[A-Za-z0-9_-]+-[0-9a-f]{8}$/);
    expect(decodeShare(code)).toEqual({ ok: true, data: { ...sample, cards: ['chukei', 'kiro'] } });
  });
  it('同じ中身なら同じ文字列(カードの順は問わない)', () => {
    expect(encodeShare(sample)).toBe(encodeShare({ ...sample, cards: ['chukei', 'kiro'] }));
  });
  it('HY1 の意味は変えない: 決まった中身の文字列が、決まった値になる', () => {
    // この期待値を変えるときは、HY1 の意味が変わったということ。変えずに HY2 を作ること
    const fixed = encodeShare({ scenario: 'b-01', seed: 1, cards: ['kiro'], outcome: 'done', score: 487.5, stars: 2, troopsHome: 24, carriersHome: 25, surplus: 2.5 });
    expect(fixed).toBe('HY1-WyJiLTAxIiwxLFsia2lybyJdLDEsNDg3NSwyLDI0LDI1LDI1XQ-f36aae88');
    expect(decodeShare(fixed).ok).toBe(true);
  });
  it('1文字でも変わると、チェックサムで見つける', () => {
    const code = encodeShare(sample);
    const i = 10;
    const changed = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
    expect(decodeShare(changed)).toEqual({ ok: false, error: '文字列が欠けているか、書き換わっています' });
    expect(decodeShare(code.slice(0, -1)).ok).toBe(false);
  });
  it('知らない版・形の違う文字列・前後の空白', () => {
    const code = encodeShare(sample);
    expect(decodeShare(code.replace('HY1', 'HY2'))).toEqual({ ok: false, error: 'この版(HY2)には対応していません' });
    expect(decodeShare('hello').ok).toBe(false);
    expect(decodeShare('').ok).toBe(false);
    expect(decodeShare(`  ${code}\n`).ok).toBe(true);
  });
  it('チェックサムが合っていても、中身の型が違えば拒否する(受け取った文字列を信用しない)', () => {
    const fnv = (t: string) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
      return h.toString(16).padStart(8, '0');
    };
    const make = (arr: unknown) => {
      const body = btoa(JSON.stringify(arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `HY1-${body}-${fnv(body)}`;
    };
    expect(decodeShare(make(['b-01', 1, [], 1, 100, 9, 1, 1, 0])).ok).toBe(false); // ★9
    expect(decodeShare(make(['<script>', 1, [], 1, 100, 1, 1, 1, 0])).ok).toBe(false);
    expect(decodeShare(make(['b-01', -1, [], 1, 100, 1, 1, 1, 0])).ok).toBe(false);
    expect(decodeShare(make({ a: 1 })).ok).toBe(false);
    expect(decodeShare(make(['b-01', 1, [], 1, 100, 1, 1, 1, 0])).ok).toBe(true);
  });
});
