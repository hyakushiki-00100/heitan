/** ボットの異常検出が本当に働くか(わざと異常を起こして確かめる) */
import { describe, expect, it } from 'vitest';
import { createState, dispatch, ledgerMismatch, type Scenario } from '../../src';
import { idle, type Bot } from './bots';
import { runBot } from './runner';
import { ALL_SCENARIOS } from './scenarios';

const { game, scenario } = ALL_SCENARIOS.find((x) => x.scenario.id === 'b-02')!;

describe('異常の検出', () => {
  it('物資の合計: 何もしていなければ合う。米や物資が消えたらずれを出す', () => {
    const s = createState(structuredClone(scenario) as Scenario, 1);
    expect(ledgerMismatch(s)).toEqual([]);
    s.rice.kura! -= 1;
    s.goods.firewood!.jin! += 2;
    expect(ledgerMismatch(s)).toEqual([
      { res: 'rice', diff: 1 },
      { res: 'firewood', diff: -2 },
    ]);
  });
  it('物資の合計のずれを、ボットの実行が失敗として報告する', () => {
    const leaky: Bot = { name: 'leaky', act: (s) => void (s.step === 3 && (s.rice.kura! -= 5)) };
    const r = runBot(game, scenario, leaky, 1);
    expect(r.failures.some((f) => f.startsWith('物資の合計が合わない'))).toBe(true);
  });
  it('人数の合計のずれを報告する', () => {
    const r = runBot(game, scenario, { name: 'x', act: (s) => void (s.step === 3 && (s.army.troops -= 1)) }, 1);
    expect(r.failures.some((f) => f.startsWith('兵の合計が合わない'))).toBe(true);
  });
  it('例外を報告する', () => {
    const r = runBot(game, scenario, { name: 'x', act: () => { throw new Error('boom'); } }, 1);
    expect(r.failures[0]).toContain('例外');
    expect(r.failures[0]).toContain('boom');
  });
  it('終わらない遠征を無限ループとして報告する', () => {
    // 撤退の後、2隊を半日ずらして蔵と里の村の間で往復させ続ける。
    // 1隊だけだと、着いた刻みに「移動中の隊なし」となって遠征が終わる(終わらなくなるのは、常にどれかが移動中のときだけ)
    const forever: Bot = {
      name: 'forever',
      act: (s) => {
        if (s.army.phase === 'hold') return;
        [0, 1].forEach((i) => {
          const c = s.convoys[i]!;
          if (c.move || s.step % 2 !== i) return;
          // 蔵からは5積んで里の村へ(1日で2.5食べ、2.5残る)。里の村からはその2.5で蔵へ戻る
          if (c.at === 'kura') dispatch(s, c.id, 'mura', 5);
          else dispatch(s, c.id, 'kura', 2.5);
        });
      },
    };
    // 陣が落ちて先に終わらないよう、陣に十分な物資を置く
    const sc = structuredClone(scenario) as Scenario;
    sc.nodes.jin = { rice: 2000, goods: { firewood: 2000, miso: 2000 } };
    const r = runBot(game, sc, forever, 1);
    expect(r.failures.some((f) => f.startsWith('無限ループ'))).toBe(true);
  });
  it('idle は何も運ばないので陣が落ち、記録には兵糧の尽きた拠点が1つ残る', () => {
    const r = runBot(game, scenario, idle, 1);
    expect(r.failures).toEqual([]);
    expect(r.row).toMatchObject({ outcome: 'lost', stars: 0, starvedNodes: 1 });
  });
});
