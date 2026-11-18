import { describe, expect, it } from 'vitest';
import {
  createState,
  dispatch,
  evaluate,
  frontDaysLeft,
  retreatPlan,
  setAuto,
  setCardActive,
  step,
  stepWithRules,
  type Scenario,
  type SimState,
} from '../src';
import raw from '../../../games/b-kakuu/data/scenario-02.json';

const scenario = raw as unknown as Scenario;
/** 既定では道の危険を外す(結果を決めて確かめるため) */
const fresh = (mutate?: (sc: Scenario) => void, withRisk = false, seed = 1): SimState => {
  const sc = structuredClone(scenario);
  if (!withRisk) for (const l of sc.map.links) delete l.risk;
  mutate?.(sc);
  return createState(sc, seed);
};
const run = (s: SimState, n: number) => {
  for (let i = 0; i < n; i++) step(s);
};
// 兵24人: 米 0.5×24 = 12/日、薪 0.25×24 = 6/日、塩味噌 0.05×24 = 1.2/日
const RICE = 12;
const FW = 6;
const MISO = 1.2;

describe('物資のデータ', () => {
  it('シナリオ02は検査を通り、拠点に物資がある', () => {
    const s = fresh();
    expect(s.goods.firewood!.kura).toBe(220);
    expect(s.goods.miso!.jin).toBe(12);
    expect(s.goods.firewood!.toge).toBe(0);
  });
  it('知らない物資・重複・不正な働きは拒否する', () => {
    expect(() => fresh((sc) => (sc.nodes.kura!.goods = { unknown: 1 }))).toThrow();
    expect(() => fresh((sc) => sc.goods!.push({ ...sc.goods![0]! }))).toThrow();
    expect(() => fresh((sc) => sc.goods!.push({ id: 'rice', name: '米', kind: 'cook', perTroopPerDay: 0 }))).toThrow();
    expect(() => fresh((sc) => ((sc.goods![0] as { kind: string }).kind = 'magic'))).toThrow();
  });
});

describe('物資を運ぶ', () => {
  it('積める上限は米と物資の合計。拠点に無い物資は積めない', () => {
    const s = fresh();
    expect(dispatch(s, 'c1', 'jin', 40, undefined, { firewood: 11 }).ok).toBe(false); // 51 > 50
    expect(dispatch(s, 'c1', 'jin', 40, undefined, { miso: 41 }).ok).toBe(false); // 蔵の塩味噌は40
    expect(dispatch(s, 'c1', 'jin', 40, undefined, { unknown: 1 }).ok).toBe(false);
    expect(dispatch(s, 'c1', 'jin', 40, undefined, { firewood: 8, miso: 2 }).ok).toBe(true);
    expect(s.goods.firewood!.kura).toBe(212);
    expect(s.goods.miso!.kura).toBe(38);
  });
  it('物資は道中で減らない(人足は米だけを食べる)。着いたら拠点に納める', () => {
    const s = fresh();
    dispatch(s, 'c1', 'jin', 40, ['kura', 'kawa', 'jin'], { firewood: 8, miso: 2 });
    run(s, 10);
    // 5日で陣は 薪30・塩味噌6 を使う
    expect(s.goods.firewood!.jin).toBeCloseTo(60 + 8 - 5 * FW, 6);
    expect(s.goods.miso!.jin).toBeCloseTo(12 + 2 - 5 * MISO, 6);
    expect(s.rice.jin).toBeCloseTo(130 + (40 - 12.5) - 5 * RICE, 6);
  });
  it('道中で食料が尽きた隊の物資は失われる', () => {
    const s = fresh();
    dispatch(s, 'c1', 'jin', 5, undefined, { firewood: 10 });
    run(s, 10);
    expect(s.convoys[0]!.dropped).toBe(true);
    expect(s.convoys[0]!.goods.firewood).toBe(0);
    expect(s.goods.firewood!.jin).toBeCloseTo(60 - 5 * FW, 6);
  });
  it('川越えで荷を失うときは、物資も同じ割合で失う', () => {
    const s = fresh((sc) => (sc.map.links.find((l) => l.a === 'kawa' && l.b === 'jin')!.risk = { label: '川越え', chance: 1, loss: 0.3 }), true);
    dispatch(s, 'c1', 'jin', 40, ['kura', 'kawa', 'jin'], { firewood: 10 });
    run(s, 10);
    expect(s.goods.firewood!.jin).toBeCloseTo(60 + 7 - 5 * FW, 6);
  });
});

describe('陣で物資が足りないとき', () => {
  it('薪が尽きると、米があっても炊けず陣を保てない', () => {
    const s = fresh((sc) => (sc.nodes.jin!.goods = { firewood: 6, miso: 12 }));
    run(s, 2); // 1日で薪6を使い切る
    expect(s.outcome).toBe('playing');
    run(s, 1);
    expect(s.outcome).toBe('lost');
    expect(s.log.at(-1)!.text).toContain('薪');
  });
  it('塩味噌が尽きても陣は保てるが、少しずつ兵が体を壊して離脱する(1日に兵の2%×不足の割合)', () => {
    const s = fresh((sc) => {
      sc.nodes.jin = { rice: 1000, goods: { firewood: 1000, miso: 0 } };
    });
    run(s, 20); // 10日
    expect(s.outcome).toBe('playing');
    // 24人×2%×10日 = 4.8人ぶんの端数 → 兵が減ると端数のたまり方も減るので 4人前後
    expect(s.army.dropped).toBeGreaterThanOrEqual(3);
    expect(s.army.dropped).toBeLessThanOrEqual(5);
    expect(s.log.some((l) => l.text.includes('塩味噌が足りず'))).toBe(true);
  });
  it('塩味噌が足りていれば体を壊さない', () => {
    const s = fresh((sc) => {
      sc.nodes.jin = { rice: 1000, goods: { firewood: 1000, miso: 1000 } };
    });
    run(s, 20);
    expect(s.army.dropped).toBe(0);
  });
  it('あと何日分: 米と薪の早く尽きるほうで決まり、塩味噌は別に出す', () => {
    const s = fresh();
    // 米130/12=10.8日、薪60/6=10日、塩味噌12/1.2=10日
    const d = frontDaysLeft(s, 'jin');
    expect(d.days).toBeCloseTo(10, 9);
    expect(d.limiting).toBe('薪');
    expect(d.health).toHaveLength(1);
    expect(d.health[0]!.name).toBe('塩味噌');
    expect(d.health[0]!.days).toBeCloseTo(10, 9);
  });
});

describe('撤退と物資', () => {
  it('見積もりは米と物資の合計で計算し、割合で分ける(米:薪:塩味噌 = 12:6:1.2)', () => {
    const p = retreatPlan(fresh());
    expect(p.need).toBeCloseTo(19.2 * 5, 9); // 5日
    expect(p.capacity).toBe(72); // 24人×3
    expect(p.shares.rice).toBeCloseTo(12 / 19.2, 9);
    expect(p.shares.firewood).toBeCloseTo(6 / 19.2, 9);
    expect(p.shares.miso).toBeCloseTo(1.2 / 19.2, 9);
    // 陣を72持って出て、3日で57.6使い14.4。残り2日分38.4 → 河原に24
    expect(p.stops[0]!.id).toBe('kawa');
    expect(p.stops[0]!.required).toBeCloseTo(24, 9);
  });
  it('河原に割合どおり置けば全員帰る。薪だけ足りないと一部が離脱する', () => {
    const play = (fw: number) => {
      const s = fresh((sc) => {
        sc.nodes.jin = { rice: 1000, goods: { firewood: 1000, miso: 1000 } };
        sc.nodes.kawa = { rice: 24 * (12 / 19.2), goods: { firewood: fw, miso: 24 * (1.2 / 19.2) } };
      });
      run(s, 60);
      return s.army;
    };
    expect(play(24 * (6 / 19.2))).toMatchObject({ phase: 'home', troops: 24 });
    expect(play(0).troops).toBeLessThan(24);
  });
  it('置き米の have は、いちばん足りない物資で決まる', () => {
    const s = fresh((sc) => (sc.nodes.kawa = { rice: 100, goods: { firewood: 0, miso: 100 } }));
    expect(retreatPlan(s).stops[0]!.have).toBe(0);
  });
});

describe('評価と自動', () => {
  it('余剰には物資も入る', () => {
    const s = fresh((sc) => {
      sc.nodes.jin = { rice: 1000, goods: { firewood: 1000, miso: 1000 } };
      sc.nodes.toge = { rice: 0, goods: { firewood: 5 } };
    });
    run(s, 60);
    const r = evaluate(s);
    expect(r.surplusByNode.find((x) => x.id === 'toge')).toEqual({ id: 'toge', amount: 5 });
    expect(r.surplus).toBeGreaterThan(1000);
  });
  it('自動の隊は米と物資を足りない比で運ぶ。帰路分を残すで陣は落ちず、人足は全員帰る(30シード)', () => {
    const carriers = scenario.convoys.reduce((n, c) => n + c.carriers, 0);
    for (let seed = 1; seed <= 30; seed++) {
      const s = fresh(undefined, true, seed);
      for (const c of s.convoys) setAuto(s, c.id, true);
      setCardActive(s, 'kiro', true);
      let g = 0;
      while (s.outcome === 'playing' && g++ < 400) stepWithRules(s);
      const r = evaluate(s);
      expect(r.held, `seed ${seed}`).toBe(true);
      expect(r.carriersHome, `seed ${seed}`).toBe(carriers);
      expect(s.log.some((l) => l.text.includes('体を壊して')), `seed ${seed}`).toBe(false);
    }
  });
});
