import { describe, expect, it } from 'vitest';
import {
  candidateRoutes,
  createState,
  dispatch,
  evaluate,
  retreatPlan,
  retreatRoute,
  routeFromNodes,
  setRetreatRoute,
  step,
  tripPreview,
  type Scenario,
  type SimState,
} from '../src';
import raw from '../../../games/b-kakuu/data/scenario-01.json';

const scenario = raw as unknown as Scenario;
const RIVER = ['kura', 'kawa', 'jin'];
const MOUNT = ['kura', 'mura', 'toge', 'jin'];
const rev = (r: string[]) => [...r].reverse();

/** 川越えの危険を chance に置き換えた状態を作る */
const withRiver = (chance: number, mutate?: (sc: Scenario) => void, seed = 1): SimState => {
  const sc = structuredClone(scenario);
  const river = sc.map.links.find((l) => l.risk)!;
  river.risk = { ...river.risk!, chance };
  mutate?.(sc);
  return createState(sc, seed);
};
const run = (s: SimState, n: number) => {
  for (let i = 0; i < n; i++) step(s);
};

describe('道の候補', () => {
  it('蔵→陣の候補は日数の短い順に3本(川5日、里の村と川5.5日、山6日)', () => {
    const r = candidateRoutes(scenario.map, 'kura', 'jin');
    expect(r).toEqual([
      { nodes: RIVER, days: 5 },
      { nodes: ['kura', 'mura', 'kawa', 'jin'], days: 5.5 },
      { nodes: MOUNT, days: 6 },
    ]);
  });
  it('件数の上限と、出発点と行き先が同じ場合', () => {
    expect(candidateRoutes(scenario.map, 'kura', 'jin', 1)).toHaveLength(1);
    expect(candidateRoutes(scenario.map, 'kura', 'kura')).toEqual([]);
  });
  it('つながっていない・同じ拠点を2度通る道は不正', () => {
    expect(routeFromNodes(scenario.map, ['kura', 'jin'])).toBeNull();
    expect(routeFromNodes(scenario.map, ['kura', 'mura', 'kura', 'kawa'])).toBeNull();
    expect(routeFromNodes(scenario.map, ['kura'])).toBeNull();
    expect(routeFromNodes(scenario.map, MOUNT)).toEqual({ nodes: MOUNT, days: 6 });
  });
});

describe('道を選んで運ぶ', () => {
  it('山の道を選ぶと6日かかり、届くのは35', () => {
    const s = withRiver(0);
    const r = dispatch(s, 'c1', 'jin', 50, MOUNT);
    expect(r.ok && r.route.days).toBe(6);
    run(s, 11);
    expect(s.convoys[0]!.move).not.toBeNull();
    const before = s.rice.jin!;
    run(s, 1);
    expect(s.convoys[0]!.at).toBe('jin');
    expect(s.rice.jin! - before).toBeCloseTo(35 - 6, 6); // 届いた35 − 陣の半日分の消費6
  });
  it('出発点や行き先が合わない道は拒否する', () => {
    const s = withRiver(0);
    expect(dispatch(s, 'c1', 'jin', 10, ['mura', 'toge', 'jin']).ok).toBe(false);
    expect(dispatch(s, 'c1', 'toge', 10, MOUNT).ok).toBe(false);
    expect(dispatch(s, 'c1', 'jin', 10, ['kura', 'toge', 'jin']).ok).toBe(false);
  });
});

describe('道の危険(川越え)', () => {
  it('確率1なら必ず起き、川を越えた時点の積み荷の3割を失う', () => {
    const s = withRiver(1);
    dispatch(s, 'c1', 'jin', 50, RIVER);
    run(s, 10);
    // 5日で12.5食べて37.5。その3割(11.25)を失い 26.25 が届く
    const delivered = s.log.find((l) => l.text.includes('前線の陣に到着'))!;
    expect(delivered.text).toContain('米26.3');
    expect(s.log.some((l) => l.text.includes('川越えで荷の30%(米11.3)を失った'))).toBe(true);
  });
  it('確率0なら起きない。危険のない山の道でも起きない', () => {
    const s = withRiver(0);
    dispatch(s, 'c1', 'jin', 50, RIVER);
    dispatch(s, 'c2', 'jin', 50, MOUNT);
    run(s, 12);
    expect(s.log.some((l) => l.text.includes('失った'))).toBe(false);
  });
  it('起きる割合はおおむね設定どおり(2000回で20%±3%)', () => {
    let hit = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      const s = withRiver(0.2, undefined, seed);
      dispatch(s, 'c1', 'jin', 50, RIVER);
      run(s, 10);
      if (s.log.some((l) => l.text.includes('川越え'))) hit++;
    }
    expect(hit / N).toBeGreaterThan(0.17);
    expect(hit / N).toBeLessThan(0.23);
  });
  it('同じシードなら同じ結果、シードを変えると結果が変わることがある', () => {
    const outcome = (seed: number) => {
      const s = withRiver(0.5, undefined, seed);
      for (const c of s.convoys) dispatch(s, c.id, 'jin', 50, RIVER);
      run(s, 10);
      return s.rice.jin;
    };
    expect(outcome(7)).toBe(outcome(7));
    const seen = new Set(Array.from({ length: 20 }, (_, i) => outcome(i + 1)));
    expect(seen.size).toBeGreaterThan(1);
  });
  it('帰り分ちょうどで川を越えると、荷を失ったときに道中で食料が尽きる(見積もりの最悪値は負になる)', () => {
    const s = withRiver(1, (sc) => (sc.convoys[0]!.at = 'jin'));
    const c = s.convoys[0]!;
    const p = tripPreview(s, c, rev(RIVER), 12.5)!;
    expect(p.arrive).toBe(0);
    expect(p.arriveWorst).toBeLessThan(0);
    dispatch(s, c.id, 'kura', 12.5, rev(RIVER));
    run(s, 10);
    expect(c.dropped).toBe(true);
  });
  it('出発前の見積もり: 川は無事なら37.5、最悪26.25。山は35で変わらない', () => {
    const s = withRiver(0.2);
    const c = s.convoys[0]!;
    const river = tripPreview(s, c, RIVER, 50)!;
    expect(river).toMatchObject({ eat: 12.5, arrive: 37.5 });
    expect(river.arriveWorst).toBeCloseTo(26.25, 6);
    expect(river.risks.map((r) => r.risk.label)).toEqual(['川越え']);
    const mount = tripPreview(s, c, MOUNT, 50)!;
    expect(mount).toMatchObject({ eat: 15, arrive: 35, arriveWorst: 35, risks: [] });
  });
});

describe('撤退路を選ぶ', () => {
  it('山の撤退路: 6日で72要る。峠に24置く必要があり、里の村には要らない', () => {
    const s = withRiver(0);
    expect(setRetreatRoute(s, rev(MOUNT)).ok).toBe(true);
    expect(retreatRoute(s)).toEqual({ nodes: rev(MOUNT), days: 6 });
    const plan = retreatPlan(s);
    expect(plan.need).toBe(72);
    expect(plan.stops).toEqual([
      { id: 'toge', required: 24, have: 0, riskBuffer: 0 },
      { id: 'mura', required: 0, have: 0, riskBuffer: 0 },
    ]);
    expect(plan.risks).toEqual([]);
  });
  it('峠に24置けば、山の撤退路で全員が帰る', () => {
    const s = withRiver(0, (sc) => {
      sc.nodes.jin!.rice = 1000;
      sc.nodes.toge = { rice: 24 };
    });
    setRetreatRoute(s, rev(MOUNT));
    run(s, 60);
    expect(s.army).toMatchObject({ phase: 'home', troops: 24, dropped: 0 });
  });
  it('川の撤退路で川越えが起きると、置き米ちょうどでは足りず一部が離脱する。少し多めに置けば防げる', () => {
    const play = (kawa: number) => {
      const s = withRiver(1, (sc) => {
        sc.nodes.jin!.rice = 1000;
        sc.nodes.kawa = { rice: kawa };
      });
      run(s, 60);
      return s.army;
    };
    // 河原に着いた時点の残り12の3割(3.6)を失う。見積もりの riskBuffer もこの 3.6 になる
    const stop = retreatPlan(withRiver(1)).stops[0]!;
    expect(stop).toMatchObject({ id: 'kawa', required: 12, have: 0 });
    expect(stop.riskBuffer).toBeCloseTo(3.6, 9);
    expect(play(12).troops).toBeLessThan(24);
    expect(play(12 + 3.6).troops).toBe(24);
  });
  it('撤退が始まった後や、陣から蔵への道でないものには変えられない', () => {
    const s = withRiver(0, (sc) => (sc.nodes.jin!.rice = 1000));
    expect(setRetreatRoute(s, MOUNT).ok).toBe(false); // 向きが逆
    expect(setRetreatRoute(s, ['jin', 'kura']).ok).toBe(false);
    run(s, 40);
    expect(s.army.phase).toBe('retreat');
    expect(setRetreatRoute(s, rev(MOUNT)).ok).toBe(false);
  });
});

describe('危険の入ったシナリオ01', () => {
  it('川の危険の確率・割合が0〜1の外ならシナリオを拒否する', () => {
    expect(() => withRiver(1.5)).toThrow();
    expect(() =>
      withRiver(0.2, (sc) => {
        sc.map.links.find((l) => l.risk)!.risk!.loss = -0.1;
      }),
    ).toThrow();
  });
  it('山の道だけを使い、峠に置き米をすれば、どのシードでも全員帰還できる(危険がないので結果は同じ)', () => {
    const scores = new Set<number>();
    for (const seed of [1, 2, 3]) {
      const s = withRiver(0.2, undefined, seed);
      setRetreatRoute(s, rev(MOUNT));
      let stocked = false;
      let g = 0;
      while (s.outcome === 'playing' && g++ < 500) {
        for (const c of s.convoys) {
          if (c.move || c.dropped) continue;
          const day = s.step * s.scenario.stepDays;
          if (c.at === 'kura') {
            // 峠へ: 24置き、戻りの3日分(7.5)を残すため、行きの7.5と合わせて39積む
            if (!stocked && day >= 6) {
              stocked = dispatch(s, c.id, 'toge', 39, ['kura', 'mura', 'toge']).ok;
              continue;
            }
            if (s.army.phase === 'hold' && day + 6 <= 20 && s.rice.kura! >= 50) dispatch(s, c.id, 'jin', 50, MOUNT);
          } else if (c.at === 'jin' && s.rice.jin! >= 15) dispatch(s, c.id, 'kura', 15, rev(MOUNT));
          else if (c.at === 'toge' && s.rice.toge! >= 7.5) dispatch(s, c.id, 'kura', 7.5, ['toge', 'mura', 'kura']);
        }
        step(s);
      }
      const r = evaluate(s);
      expect(r).toMatchObject({ held: true, troopsHome: 24, carriersHome: 25 });
      scores.add(r.score);
    }
    expect(scores.size).toBe(1);
  });
});
