import { describe, expect, it } from 'vitest';
import {
  buyLocal,
  convoyRaidChance,
  createState,
  dispatch,
  evaluate,
  ledgerMismatch,
  marketPrice,
  orderLocal,
  purchaseCost,
  runRules,
  setCardActive,
  step,
  tripPreview,
  type Scenario,
  type SimState,
} from '../src';
import raw02 from '../../../games/b-kakuu/data/scenario-02.json';
import raw03 from '../../../games/b-kakuu/data/scenario-03.json';

const s02 = raw02 as unknown as Scenario;
const s03 = raw03 as unknown as Scenario;
const make = (base: Scenario, mutate?: (sc: Scenario) => void, seed = 1): SimState => {
  const sc = structuredClone(base);
  mutate?.(sc);
  return createState(sc, seed);
};
const run = (s: SimState, n: number) => {
  for (let i = 0; i < n; i++) step(s);
};
const HIGHWAY = ['kura', 'juku', 'seki', 'toride', 'jin'];
const raidLink = (sc: Scenario) => sc.map.links.find((l) => l.raid)!;

describe('襲撃(野伏せり)', () => {
  it('半日ごとの確率 = 1日の確率 × 0.5。護衛付きなら4分の1', () => {
    const s = make(s03);
    const raid = raidLink(s.scenario).raid!;
    expect(convoyRaidChance(s, raid)).toBeCloseTo(0.15, 9);
    setCardActive(s, 'goei', true);
    expect(convoyRaidChance(s, raid)).toBeCloseTo(0.0375, 9);
  });
  it('その道にいる間、半日ごとに判定する(確率1なら1.5日=3刻みで3回襲われる)', () => {
    const s = make(s03, (sc) => (raidLink(sc).raid!.chancePerDay = 2));
    dispatch(s, 'c1', 'jin', 50, HIGHWAY);
    run(s, 12);
    expect(s.log.filter((l) => l.text.includes('野伏せりに襲われ'))).toHaveLength(3);
    expect(ledgerMismatch(s)).toEqual([]);
  });
  it('襲撃のない道では起きない。軍勢は襲われない', () => {
    const s = make(s03, (sc) => {
      raidLink(sc).raid!.chancePerDay = 2;
      sc.nodes.jin = { rice: 2000, goods: { firewood: 2000, miso: 2000 } };
    });
    s.army.retreatNodes = [...HIGHWAY].reverse();
    dispatch(s, 'c1', 'juku', 20, ['kura', 'juku']);
    run(s, 60);
    expect(s.log.some((l) => l.text.includes('襲われ'))).toBe(false);
    expect(s.army.phase).toBe('home');
  });
  it('出発前の見積もり: 襲撃は区間ごとに1回襲われた場合を最悪値に入れる', () => {
    const s = make(s03);
    const c = s.convoys[0]!;
    const p = tripPreview(s, c, HIGHWAY, 50)!;
    expect(p.raids.map((r) => r.raid.label)).toEqual(['野伏せり']);
    expect(p.arrive).toBe(35);
    expect(p.arriveWorst).toBeCloseTo(35 * 0.8, 9);
  });
});

describe('市と米価', () => {
  it('米価は買うほど上がる(売り切ると 1+priceRise 倍)。払う額は買う前と後の平均', () => {
    const s = make(s02);
    expect(marketPrice(s, 'mura')).toBe(1);
    expect(marketPrice(s, 'kura')).toBeNull();
    // 80 のうち 40 買う: 米価は 1 → 1.75、払う額は 40 × 1.375
    expect(purchaseCost(s, 'mura', 40)).toBeCloseTo(55, 9);
    expect(buyLocal(s, 'mura', 40)).toEqual({ ok: true, cost: 55 });
    expect(marketPrice(s, 'mura')).toBeCloseTo(1.75, 9);
    expect(s.rice.mura).toBe(40);
    expect(s.purchaseBurden).toBe(55);
    expect(ledgerMismatch(s)).toEqual([]);
  });
  it('市のない拠点・売り切れ・不正な量は拒否する', () => {
    const s = make(s02);
    expect(buyLocal(s, 'kawa', 1).ok).toBe(false);
    expect(buyLocal(s, 'mura', 81).ok).toBe(false);
    expect(buyLocal(s, 'mura', 0).ok).toBe(false);
    expect(buyLocal(s, 'mura', -5).ok).toBe(false);
  });
  it('払った額は村への負担として減点される', () => {
    const play = (buy: boolean) => {
      const s = make(s02, (sc) => {
        for (const l of sc.map.links) delete l.risk;
        sc.nodes.jin = { rice: 2000, goods: { firewood: 2000, miso: 2000 } };
      });
      if (buy) buyLocal(s, 'mura', 10);
      run(s, 60);
      return evaluate(s);
    };
    const a = play(false);
    const b = play(true);
    expect(b.purchaseBurden).toBeCloseTo(purchaseCost(make(s02), 'mura', 10), 9);
    // 買った米10は里の村に残るので余剰にもなる
    expect(b.villageBurden - a.villageBurden).toBeCloseTo(b.purchaseBurden + 10, 9);
    expect(a.score - b.score).toBeCloseTo(b.purchaseBurden + 10, 9);
  });
  it('村の運び手に頼むと、道の日数のあとに届く(届く途中も帳簿が合う)', () => {
    const s = make(s02);
    const r = orderLocal(s, 'mura', 'jin', 20);
    expect(r.ok && r.days).toBe(4.5); // 里の村→河原→陣
    const before = s.rice.jin!;
    run(s, 8);
    expect(ledgerMismatch(s)).toEqual([]);
    expect(s.orders).toHaveLength(1);
    run(s, 1);
    expect(s.orders).toHaveLength(0);
    expect(s.rice.jin! - before).toBeCloseTo(20 - 9 * 0.5 * 12, 9);
    expect(ledgerMismatch(s)).toEqual([]);
  });
});

describe('現地調達のカード', () => {
  it('陣の米が「届くまでの日数+2日」を切ると、陣に一番近い市から4日分を頼む。届く途中は重ねて頼まない', () => {
    const s = make(s02, (sc) => (sc.nodes.jin!.rice = 60)); // 60/12 = 5日 < 4.5+2
    setCardActive(s, 'genchi', true);
    runRules(s);
    expect(s.orders).toEqual([{ from: 'mura', to: 'jin', rice: 48, arriveStep: 9 }]);
    runRules(s);
    expect(s.orders).toHaveLength(1);
  });
  it('陣に十分あれば頼まない。カードがなければ頼まない', () => {
    const s = make(s02, (sc) => (sc.nodes.jin!.rice = 1000));
    setCardActive(s, 'genchi', true);
    runRules(s);
    expect(s.orders).toHaveLength(0);
    const t = make(s02, (sc) => (sc.nodes.jin!.rice = 60));
    runRules(t);
    expect(t.orders).toHaveLength(0);
  });
});
