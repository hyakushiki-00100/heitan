/**
 * 練習の遠征(チュートリアル)の数値の確かめ。
 * 何もしなければ失敗し、教えたい手順どおりに遊べば★2以上が取れることを、シード1〜20で確かめる
 */
import { describe, expect, it } from 'vitest';
import {
  createState,
  dispatch,
  evaluate,
  retreatPlan,
  setAuto,
  setCardActive,
  step,
  stepWithRules,
  tripPreview,
  type Scenario,
  type SimState,
} from '@hyoro/core';
import t1 from '../data/scenario-t1.json';
import t2 from '../data/scenario-t2.json';
import t3 from '../data/scenario-t3.json';
import t4 from '../data/scenario-t4.json';
import tutorial from '../data/tutorial.json';

const S = { t1, t2, t3, t4 } as unknown as Record<string, Scenario>;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

function play(sc: Scenario, seed: number, onStep: (s: SimState) => void, auto = false): SimState {
  const s = createState(structuredClone(sc), seed);
  let g = 0;
  while (s.outcome === 'playing' && g++ < 500) {
    onStep(s);
    if (auto) stepWithRules(s);
    else step(s);
  }
  return s;
}

/** 待機中の隊を、route で to へ(1隊につき1回だけ)。load を省くと満載 */
const sent = new WeakMap<SimState, Set<string>>();
function send(s: SimState, id: string, route: string[], load?: number): void {
  const c = s.convoys.find((x) => x.id === id)!;
  const done = sent.get(s) ?? new Set<string>();
  sent.set(s, done);
  if (done.has(id) || c.move || c.dropped || c.at !== route[0]) return;
  done.add(id);
  const cap = c.carriers * s.scenario.carrierCapacity;
  const l = Math.min(load ?? cap, s.rice[c.at] ?? 0);
  const r = dispatch(s, id, route[route.length - 1]!, l, route);
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

/** 陣に着いた隊を、危険が起きても尽きない分だけ持たせて蔵へ戻す */
function sendBack(s: SimState, id: string, route: string[]): void {
  const c = s.convoys.find((x) => x.id === id)!;
  if (c.move || c.dropped || c.at !== route[0]) return;
  let l = tripPreview(s, c, route, 0)!.eat;
  while ((tripPreview(s, c, route, l)!.arriveWorst ?? -1) < 0) l += 0.5;
  dispatch(s, id, 'kura', l, route);
}

describe('練習の遠征', () => {
  it('どの練習も、何もしなければ★1以下(陣が落ちるか、撤退で兵が離脱する)', () => {
    for (const sc of Object.values(S)) {
      const s = play(sc, 1, () => {});
      expect(evaluate(s).stars, sc.id).toBeLessThanOrEqual(1);
    }
  });

  it('練習1: 満載で陣へ送り、帰り分を持たせて戻せば★2以上', () => {
    for (const seed of SEEDS) {
      const s = play(S.t1!, seed, (x) => {
        send(x, 'c1', ['kura', 'juku', 'jin']);
        sendBack(x, 'c1', ['jin', 'juku', 'kura']);
      });
      const r = evaluate(s);
      expect(r.held && r.stars >= 2, `seed ${seed} ★${r.stars}`).toBe(true);
    }
  });

  it('練習1: 送った隊を戻さないと、帰還に数えられず★が下がる', () => {
    const s = play(S.t1!, 1, (x) => send(x, 'c1', ['kura', 'juku', 'jin']));
    const r = evaluate(s);
    expect(r.carriersHome).toBe(0);
    expect(r.stars).toBeLessThan(2);
  });

  it('練習2: 安全な峠道で2隊を送り、帰り分で戻せば★2以上(危険の有無に左右されない)', () => {
    const safe = ['kura', 'toge', 'jin'];
    for (const seed of SEEDS) {
      const s = play(S.t2!, seed, (x) => {
        send(x, 'c1', safe);
        send(x, 'c2', safe);
        sendBack(x, 'c1', [...safe].reverse());
        sendBack(x, 'c2', [...safe].reverse());
      });
      const r = evaluate(s);
      expect(r.held && r.stars >= 2, `seed ${seed} ★${r.stars}`).toBe(true);
    }
  });

  it('練習2: 近い川越えの道で送ると、荷を失って★が下がるシードがある', () => {
    const near = ['kura', 'kawa', 'jin'];
    const stars: number[] = [];
    for (const seed of SEEDS) {
      const s = play(S.t2!, seed, (x) => {
        send(x, 'c1', near);
        sendBack(x, 'c1', [...near].reverse());
      });
      stars.push(evaluate(s).stars);
    }
    expect(Math.min(...stars)).toBeLessThan(2);
  });

  it('練習3: 陣へ1隊、撤退路の宿場へ置き米を1隊で運べば★2以上。置き米をしないと兵が離脱する', () => {
    const toJin = ['kura', 'juku', 'jin'];
    for (const seed of SEEDS) {
      const s = play(S.t3!, seed, (x) => {
        send(x, 'c1', toJin);
        sendBack(x, 'c1', [...toJin].reverse());
        if (x.army.phase === 'hold') {
          const stop = retreatPlan(x).stops.find((st) => st.id === 'juku');
          // 宿場へ、置き米と往復の食べる分(行き7.5・帰り7.5。帰り分は着いた宿場の米から積む)を合わせて運ぶ
          if (stop && stop.have < stop.required) send(x, 'c2', ['kura', 'juku'], stop.required - stop.have + 15);
        }
        sendBack(x, 'c2', ['juku', 'kura']);
      });
      const r = evaluate(s);
      expect(r.held && r.stars >= 2, `seed ${seed} ★${r.stars}`).toBe(true);
    }
    const s = play(S.t3!, 1, (x) => {
      send(x, 'c1', toJin);
      sendBack(x, 'c1', [...toJin].reverse());
    });
    expect(evaluate(s).troopsHome).toBeLessThan(10);
  });

  it('練習4: 全隊を自動にして「帰路分を残す」を入れれば★2以上', () => {
    for (const seed of SEEDS) {
      const s = createState(structuredClone(S.t4!), seed);
      for (const c of s.convoys) setAuto(s, c.id, true);
      setCardActive(s, 'kiro', true);
      let g = 0;
      while (s.outcome === 'playing' && g++ < 500) stepWithRules(s);
      const r = evaluate(s);
      expect(r.held && r.stars >= 2, `seed ${seed} ★${r.stars}`).toBe(true);
    }
  });

  it('練習の説明のデータ: どの練習にも題と説明があり、隠す札は既知のもの', () => {
    const t = tutorial as unknown as Record<string, { intro: string[]; hide: string[] }>;
    for (const sc of Object.values(S)) {
      const x = t[sc.id];
      expect(x, sc.id).toBeTruthy();
      expect(x!.intro.length).toBeGreaterThan(0);
      for (const h of x!.hide) expect(['retreat', 'cards', 'auto']).toContain(h);
    }
  });
});
