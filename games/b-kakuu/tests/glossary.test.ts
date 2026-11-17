import { describe, expect, it } from 'vitest';
import data from '../data/glossary.json';
import { TERMS, t } from '../src/glossary';

describe('用語集', () => {
  it('用語は重複せず、読み・説明があり、種類は word か game', () => {
    const seen = new Set<string>();
    for (const x of TERMS) {
      expect(seen.has(x.term), x.term).toBe(false);
      seen.add(x.term);
      expect(x.reading.length, x.term).toBeGreaterThan(0);
      expect(x.body.length, x.term).toBeGreaterThan(5);
      expect(['word', 'game']).toContain(x.kind);
    }
    expect(TERMS.length).toBe((data as { terms: unknown[] }).terms.length);
  });
  it('説明付きの HTML を作る。用語集にない言葉は例外(書き間違いに気づくため)', () => {
    expect(t('兵糧')).toBe('<span class="term" tabindex="0" role="button" data-term="兵糧">兵糧</span>');
    expect(t('帰り分', '帰り分だけ')).toContain('>帰り分だけ<');
    expect(() => t('存在しない言葉')).toThrow();
  });
});
