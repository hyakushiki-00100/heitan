import { describe, expect, it } from 'vitest';
import {
  createExpedition,
  exCache,
  exCapacity,
  exChoose,
  exEatPerDay,
  exLedgerGap,
  exMove,
  exNext,
  exResult,
  exSendHome,
  exStart,
  generateExMap,
  type ExState,
} from '../src/expedition';
import { Rng } from '../src/rng';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

/** 何も考えないボット: 荷駄は中くらい、選択肢と道はでたらめ。置き米も荷駄を帰すこともしない */
function randomBot(s: ExState, rng: Rng): void {
  exStart(s, 5);
  let g = 0;
  while (s.phase !== 'done' && g++ < 300) {
    if (s.pending) {
      const cs = s.pending.choices.filter((c) => !c.disabled);
      exChoose(s, cs[rng.int(0, cs.length - 1)]!.id);
      continue;
    }
    const nx = exNext(s);
    exMove(s, nx[rng.int(0, nx.length - 1)]!);
  }
}

/**
 * 考えるボット: 帰りの分を行きの拠点に置いていき、空いた荷駄は帰し、村・森で補い、
 * 城は勝てそうなら攻め、そうでなければ囲む
 */
function smartBot(s: ExState, porters: number): void {
  exStart(s, porters);
  const cols = s.map.cols;
  /** 残りの旅で要る米の見積もり(行きは城まで+包囲2日+帰り、帰りは蔵まで。兵だけ・荷駄1隊で数える) */
  const need = () => {
    const col = s.map.nodes[s.at]!.col;
    const per = s.troops * s.rules.troopEat + s.rules.porterEat;
    const days = s.phase === 'back' ? col : cols - 1 - col + 2 + (cols - 1);
    const cached = s.phase === 'back' ? Object.values(s.cache).reduce((a, b) => a + b, 0) : 0;
    return per * days - cached;
  };
  let g = 0;
  while (s.phase !== 'done' && g++ < 300) {
    if (s.pending) {
      const ids = s.pending.choices.filter((c) => !c.disabled).map((c) => c.id);
      const pick = (...pref: string[]) => pref.find((p) => ids.includes(p)) ?? ids[0]!;
      switch (s.pending.type) {
        case 'mura':
        case 'shuku':
          exChoose(s, pick(s.food < need() ? 'buy' : 'pass', 'pass'));
          break;
        case 'mori':
          exChoose(s, pick(s.food < need() && s.food > exEatPerDay(s) * 2 ? 'forage' : 'pass', 'pass'));
          break;
        case 'kawa':
          exChoose(s, pick(s.food > 60 ? 'ford' : 'cross'));
          break;
        case 'nobuse':
          exChoose(s, pick(s.troops >= 4 ? 'fight' : 'pay'));
          break;
        case 'shiro':
          exChoose(s, pick(s.troops * s.rules.assaultPerTroop >= 0.45 ? 'assault' : 'siege', 'withdraw'));
          if (s.phase === 'siege' && s.day > 12 && s.pending) exChoose(s, 'withdraw');
          break;
        default:
          exChoose(s, ids[0]!);
      }
      continue;
    }
    if (s.phase === 'out' && s.at !== 0) {
      // 帰りにこの拠点から蔵まで要る分(1列1日として、兵だけになった前提)を置く
      const col = s.map.nodes[s.at]!.col;
      const backNeed = s.troops * s.rules.troopEat * 1 + 0; // 1列ぶん
      if ((s.cache[s.at] ?? 0) < backNeed && s.food > exEatPerDay(s) * (cols - 1 - col) + backNeed) exCache(s, backNeed);
      // 空き荷駄を帰す(残りの米が1隊分以上少なければ)
      while (s.porters > 1 && s.food <= exCapacity(s) - s.rules.carry) exSendHome(s);
    }
    const nx = exNext(s);
    // 村・宿場・森を好む
    const score = (id: number) => ({ mura: 3, shuku: 3, mori: 2, no: 1, kawa: 0, toge: -1, nobuse: -1, kura: 0, shiro: 5 })[s.map.nodes[id]!.type];
    nx.sort((a, b) => score(b) - score(a));
    exMove(s, nx[0]!);
  }
}

describe('遠征(試作)', () => {
  it('地図: 列0が蔵、最後が城。どの拠点も前後の列とつながる', () => {
    for (const seed of SEEDS) {
      const m = generateExMap(seed);
      expect(m.nodes[0]!.type).toBe('kura');
      expect(m.nodes.at(-1)!.type).toBe('shiro');
      for (const n of m.nodes) {
        if (n.col > 0) expect(m.edges.some((e) => e[1] === n.id), `seed ${seed} 入り ${n.id}`).toBe(true);
        if (n.col < m.cols - 1) expect(m.edges.some((e) => e[0] === n.id), `seed ${seed} 出 ${n.id}`).toBe(true);
      }
    }
  });

  it('でたらめに遊んでも、例外・無限ループ・米の合計のずれがない', () => {
    for (const seed of SEEDS) {
      const s = createExpedition(seed);
      randomBot(s, new Rng(seed * 7));
      expect(s.phase, `seed ${seed}`).toBe('done');
      expect(Math.abs(exLedgerGap(s)), `seed ${seed}`).toBeLessThan(1e-9);
      expect(s.food).toBeGreaterThanOrEqual(0);
      expect(s.troops + s.lostTroops).toBe(s.rules.troops);
    }
  });

  it('難しさの目安: 考えて遊べば★2以上が多く、でたらめでは少ない', () => {
    const stars = (f: (s: ExState, seed: number) => void) =>
      SEEDS.map((seed) => {
        const s = createExpedition(seed);
        f(s, seed);
        expect(Math.abs(exLedgerGap(s))).toBeLessThan(1e-9);
        return exResult(s).stars;
      });
    const rnd = stars((s, seed) => randomBot(s, new Rng(seed * 7)));
    const smart = stars((s) => smartBot(s, 6));
    const rate = (xs: number[], k: number) => xs.filter((x) => x >= k).length / xs.length;
    console.log('random ★', rnd.join(''), ' smart ★', smart.join(''));
    expect(rate(smart, 2)).toBeGreaterThan(rate(rnd, 2));
    expect(rate(smart, 2)).toBeGreaterThanOrEqual(0.5);
    expect(rate(rnd, 2)).toBeLessThanOrEqual(0.3);
  });
});
