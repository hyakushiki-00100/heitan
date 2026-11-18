import { describe, expect, it } from 'vitest';
import {
  autoRoles,
  createState,
  dispatch,
  evaluate,
  relayNode,
  retreatPlan,
  runRules,
  setAuto,
  setAutoRoute,
  setCardActive,
  setRetreatRoute,
  step,
  stepWithRules,
  tripPreview,
  type CardId,
  type Scenario,
  type SimState,
} from '../src';
import raw from '../../../games/b-kakuu/data/scenario-01.json';

const scenario = raw as unknown as Scenario;
const MOUNT = ['kura', 'mura', 'toge', 'jin'];
const CARRIERS = scenario.convoys.reduce((n, c) => n + c.carriers, 0);

/** 全隊を自動にし、cards を有効にした状態 */
const autoState = (cards: CardId[], opts: { risk?: boolean; seed?: number; mutate?: (sc: Scenario) => void } = {}): SimState => {
  const sc = structuredClone(scenario);
  if (opts.risk === false) for (const l of sc.map.links) delete l.risk;
  opts.mutate?.(sc);
  const s = createState(sc, opts.seed ?? 1);
  for (const c of s.convoys) setAuto(s, c.id, true);
  for (const id of cards) setCardActive(s, id, true);
  return s;
};
const playOut = (s: SimState) => {
  let g = 0;
  while (s.outcome === 'playing' && g++ < 400) stepWithRules(s);
  return s;
};
/** seeds 個のシードで最後まで自動で動かし、評価を集める */
const many = (cards: CardId[], seeds = 60, mountain = false) =>
  Array.from({ length: seeds }, (_, i) => {
    const s = autoState(cards, { seed: i + 1 });
    if (mountain) {
      setAutoRoute(s, MOUNT);
      setRetreatRoute(s, [...MOUNT].reverse());
    }
    return evaluate(playOut(s));
  });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('カードと自動の切り替え', () => {
  it('自動にしていない隊は動かない', () => {
    const s = createState(structuredClone(scenario), 1);
    runRules(s);
    expect(s.convoys.every((c) => !c.move)).toBe(true);
  });
  it('シナリオに無いカードは有効にできない。知らないカードを持つシナリオは拒否する', () => {
    const s = createState(structuredClone(scenario), 1);
    expect(setCardActive(s, 'kiro', true)).toBe(true);
    expect(s.activeCards).toEqual(['kiro']);
    expect(setCardActive(s, 'kiro', false)).toBe(true);
    expect(s.activeCards).toEqual([]);
    const noCards = structuredClone(scenario);
    delete noCards.cards;
    expect(setCardActive(createState(noCards, 1), 'kiro', true)).toBe(false);
    const bad = structuredClone(scenario) as unknown as { cards: { id: string }[] };
    bad.cards[0]!.id = 'unknown';
    expect(() => createState(bad as unknown as Scenario, 1)).toThrow();
  });
  it('自動便の道は蔵→陣の道だけ', () => {
    const s = createState(structuredClone(scenario), 1);
    expect(setAutoRoute(s, MOUNT)).toBe(true);
    expect(setAutoRoute(s, [...MOUNT].reverse())).toBe(false);
    expect(setAutoRoute(s, ['kura', 'toge', 'jin'])).toBe(false);
  });
  it('同じシード・同じカードなら同じ結果', () => {
    const play = () => JSON.stringify(evaluate(playOut(autoState(['kiro', 'chukei'], { seed: 9 }))));
    expect(play()).toBe(play());
  });
});

describe('基本の動き(カードなし)', () => {
  it('陣が足りなくなりそうなら蔵から陣へ満載で出す', () => {
    const s = autoState([], { risk: false });
    runRules(s);
    const moving = s.convoys.filter((c) => c.move);
    expect(moving.length).toBeGreaterThan(0);
    expect(moving.every((c) => c.cargo === 50 && c.move!.route.at(-1) === 'jin')).toBe(true);
  });
  it('陣に十分あれば出さない(余剰を作らない)', () => {
    const s = autoState([], { risk: false, mutate: (sc) => (sc.nodes.jin!.rice = 1000) });
    runRules(s);
    expect(s.convoys.every((c) => !c.move)).toBe(true);
  });
  it('カードなしでは置き米を運ばないので、撤退で兵が離脱する', () => {
    const r = evaluate(playOut(autoState([], { risk: false })));
    expect(r.held).toBe(true);
    expect(r.troopsHome).toBeLessThan(24);
  });
});

describe('帰路分を残す', () => {
  it('最初に撤退路の置き米(必要量+川越えへの上乗せ)を河原へ運ぶ', () => {
    const s = autoState(['kiro']);
    const stop = retreatPlan(s).stops[0]!;
    const target = stop.required + stop.riskBuffer; // 12 + 3.6
    runRules(s);
    const toKawa = s.convoys.filter((c) => c.move?.route.at(-1) === 'kawa');
    expect(toKawa).toHaveLength(1);
    for (let i = 0; i < 4; i++) step(s);
    // 着いた時点では、置き米に加えてその隊の帰り分(5)も下ろしてある。帰り分を積んで出た後に確かめる
    runRules(s);
    expect(s.convoys.some((c) => c.move?.route[0] === 'kawa')).toBe(true);
    expect(s.rice.kawa!).toBeGreaterThanOrEqual(target);
    expect(s.rice.kawa!).toBeLessThan(target + 1); // 0.5刻みの切り上げ分しか多く置かない
  });
  it('撤退が始まるとき、陣にいる運搬隊の帰り分は兵が持ち出さずに残す', () => {
    const s = autoState(['kiro'], {
      risk: false,
      mutate: (sc) => {
        sc.nodes.jin!.rice = 20 * 12 + 30; // 撤退の日に30しか残らない
        sc.convoys[0]!.at = 'jin';
      },
    });
    for (const c of s.convoys) setAuto(s, c.id, false);
    for (let i = 0; i < 40; i++) step(s);
    expect(s.army.phase).toBe('retreat');
    // 帰り分 12.5 を残し、兵は 17.5 を持ち出す
    expect(s.army.cargo).toBeCloseTo(17.5, 6);
    expect(s.rice.jin).toBeCloseTo(12.5, 6);
  });
  it('カードがなければ兵が先に持ち出し、隊の帰り分は残らない', () => {
    const s = autoState([], {
      risk: false,
      mutate: (sc) => {
        sc.nodes.jin!.rice = 20 * 12 + 30;
        sc.convoys[0]!.at = 'jin';
      },
    });
    for (const c of s.convoys) setAuto(s, c.id, false);
    for (let i = 0; i < 40; i++) step(s);
    expect(s.army.cargo).toBe(30);
    expect(s.rice.jin).toBe(0);
  });
  it('自動の隊は全員蔵に帰り、陣が落ちることもない(60シード)', () => {
    const rs = many(['kiro']);
    expect(rs.every((r) => r.held && r.carriersHome === CARRIERS)).toBe(true);
    expect(mean(rs.map((r) => r.score))).toBeGreaterThan(mean(many([]).map((r) => r.score)) + 100);
  });
});

describe('中継経由', () => {
  it('中継地は自動便の道の真ん中に近い拠点(川なら河原、山なら峠)', () => {
    const s = createState(structuredClone(scenario), 1);
    expect(relayNode(s)).toBe('kawa');
    setAutoRoute(s, MOUNT);
    expect(relayNode(s)).toBe('toge');
  });
  it('自動の5隊を、蔵⇔中継地2隊と中継地⇔陣3隊に分ける。カードがなければ全員直送', () => {
    const s = autoState(['chukei']);
    const roles = [...autoRoles(s).values()];
    expect(roles.filter((r) => r === 'near')).toHaveLength(2);
    expect(roles.filter((r) => r === 'far')).toHaveLength(3);
    expect([...autoRoles(autoState([])).values()].every((r) => r === 'direct')).toBe(true);
  });
  it('蔵⇔中継地の隊は陣へ行かない', () => {
    const s = autoState(['chukei', 'kiro'], { risk: false });
    const near = [...autoRoles(s).entries()].filter(([, r]) => r === 'near').map(([id]) => id);
    let g = 0;
    while (s.outcome === 'playing' && g++ < 400) {
      stepWithRules(s);
      for (const c of s.convoys) if (near.includes(c.id)) expect(c.at).not.toBe('jin');
    }
  });
  it('帰路分+中継は、帰路分だけより平均点が高い(60シード)', () => {
    const kiro = mean(many(['kiro']).map((r) => r.score));
    const both = many(['kiro', 'chukei']);
    expect(both.every((r) => r.held && r.carriersHome === CARRIERS)).toBe(true);
    expect(mean(both.map((r) => r.score))).toBeGreaterThan(kiro);
  });
});

describe('護衛付き', () => {
  it('危険な道の隊だけ食事が1割増える(川の道 5日で 13.75、山の道は 15 のまま)', () => {
    const s = autoState(['goei']);
    const c = s.convoys[0]!;
    expect(tripPreview(s, c, ['kura', 'kawa', 'jin'], 50)!.eat).toBeCloseTo(13.75, 9);
    expect(tripPreview(s, c, MOUNT, 50)!.eat).toBe(15);
  });
  it('運搬隊に危険が起きる確率が4分の1(2000回で 5%±1.5%)', () => {
    let hit = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      const s = createState(structuredClone(scenario), seed);
      setCardActive(s, 'goei', true);
      dispatch(s, 'c1', 'jin', 50, ['kura', 'kawa', 'jin']);
      for (let i = 0; i < 10; i++) step(s);
      if (s.log.some((l) => l.text.includes('川越え'))) hit++;
    }
    expect(hit / N).toBeGreaterThan(0.035);
    expect(hit / N).toBeLessThan(0.065);
  });
  it('軍勢には護衛の効果がない(確率1の川越えは護衛付きでも起きる)', () => {
    const s = autoState(['goei'], {
      mutate: (sc) => {
        sc.map.links.find((l) => l.risk)!.risk!.chance = 1;
        sc.nodes.jin!.rice = 1000;
      },
    });
    for (const c of s.convoys) setAuto(s, c.id, false);
    for (let i = 0; i < 50; i++) step(s);
    expect(s.log.some((l) => l.text.startsWith('軍勢は川越え'))).toBe(true);
  });
});
