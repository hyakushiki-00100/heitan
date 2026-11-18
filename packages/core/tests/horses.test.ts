import { describe, expect, it } from 'vitest';
import {
  autoRoles,
  convoyCapacity,
  createState,
  dispatch,
  ledgerMismatch,
  setAuto,
  setCardActive,
  step,
  tripPreview,
  type Scenario,
  type SimState,
} from '../src';
import raw from '../../../games/b-kakuu/data/scenario-03.json';

const scenario = raw as unknown as Scenario;
const fresh = (mutate?: (sc: Scenario) => void): SimState => {
  const sc = structuredClone(scenario);
  for (const l of sc.map.links) delete l.risk;
  mutate?.(sc);
  return createState(sc, 1);
};
const run = (s: SimState, n: number) => {
  for (let i = 0; i < n; i++) step(s);
};
const HIGHWAY = ['kura', 'juku', 'seki', 'toride', 'jin']; // 6日

describe('馬と飼い葉', () => {
  it('馬の隊の積める上限は 人足×10 + 馬×30', () => {
    const s = fresh();
    expect(convoyCapacity(s, s.convoys.find((c) => c.id === 'h1')!)).toBe(2 * 10 + 4 * 30);
    expect(convoyCapacity(s, s.convoys.find((c) => c.id === 'c1')!)).toBe(50);
  });
  it('見積もり: 馬4頭 × 1.5 × 6日 = 飼い葉36、人足2人 × 0.5 × 6日 = 米6', () => {
    const s = fresh();
    const p = tripPreview(s, s.convoys.find((c) => c.id === 'h1')!, HIGHWAY, 100)!;
    expect(p.fodderNeed).toBe(36);
    expect(p.eat).toBe(6);
  });
  it('飼い葉を積めば、馬は満載で運べる(飼い葉は道中で食べ切る)', () => {
    const s = fresh();
    expect(dispatch(s, 'h1', 'jin', 100, HIGHWAY, { fodder: 36, firewood: 4 }).ok).toBe(true);
    run(s, 12);
    const h = s.convoys.find((c) => c.id === 'h1')!;
    expect(h.at).toBe('jin');
    expect(s.log.some((l) => l.text.includes('一番馬が前線の陣に到着(米94・薪4を納めた)'))).toBe(true);
    expect(s.goods.fodder!.jin).toBe(0);
  });
  it('飼い葉が足りないと、尽きたところで人足が運べる量(20)まで荷を捨てる', () => {
    const s = fresh();
    dispatch(s, 'h1', 'jin', 100, HIGHWAY, { fodder: 3 }); // 馬4頭の半日分(4×1.5×0.5)しかない
    run(s, 2); // 2刻み目で足りなくなり、人足が運べる20まで捨てる
    const h = s.convoys.find((c) => c.id === 'h1')!;
    expect(h.cargo + Object.values(h.goods).reduce((a, b) => a + b, 0)).toBeCloseTo(20, 9);
    expect(s.log.some((l) => l.text.includes('飼い葉が尽き、馬が荷を運べなくなった'))).toBe(true);
    expect(ledgerMismatch(s)).toEqual([]);
  });
  it('荷が人足だけで運べる量なら、飼い葉がなくても捨てない(記録もしない)', () => {
    const s = fresh();
    dispatch(s, 'h1', 'jin', 15, HIGHWAY);
    run(s, 12);
    const h = s.convoys.find((c) => c.id === 'h1')!;
    expect(h.at).toBe('jin');
    expect(s.log.some((l) => l.text.includes('飼い葉'))).toBe(false);
  });
  it('飼い葉は兵が使わない(陣のあと何日に入らない)。馬を使うのに飼い葉や馬の性質がないシナリオは拒否', () => {
    expect(() => fresh((sc) => delete sc.horse)).toThrow();
    expect(() => fresh((sc) => (sc.goods = sc.goods!.filter((g) => g.kind !== 'fodder')))).toThrow();
    expect(() => fresh((sc) => (sc.goods!.find((g) => g.kind === 'fodder')!.perTroopPerDay = 1))).toThrow();
    expect(() => fresh((sc) => (sc.convoys[4]!.horses = -1))).toThrow();
  });
  it('中継経由でも、馬の隊は蔵から直送。人足の隊は区間の日数の比で分ける', () => {
    const s = fresh();
    for (const c of s.convoys) setAuto(s, c.id, true);
    setCardActive(s, 'chukei', true);
    const roles = autoRoles(s);
    expect(roles.get('h1')).toBe('direct');
    expect(roles.get('h2')).toBe('direct');
    // 自動便の道は 蔵→浦(1.5日)→陣(4日)。人足の4隊を 1.5/5.5 で分けると 蔵⇔浦 1隊、浦⇔陣 3隊
    const walkers = ['c1', 'c2', 'c3', 'c4'].map((id) => roles.get(id));
    expect(walkers.filter((r) => r === 'near')).toHaveLength(1);
    expect(walkers.filter((r) => r === 'far')).toHaveLength(3);
  });
});
