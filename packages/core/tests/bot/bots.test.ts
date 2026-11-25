/**
 * 全作品・全シナリオを、全ボット × シード1〜20で最後まで遊ばせ、異常がないことを確かめる。
 * balance.csv の書き出しと調整候補の報告は scripts/balance.ts(npm run balance)
 */
import { describe, expect, it } from 'vitest';
import { ALL_BOTS } from './bots';
import { runBot } from './runner';
import { ALL_SCENARIOS, BOT_SEEDS } from './scenarios';

describe('自動プレイボット', () => {
  it('シナリオが見つかる(B 架空戦国の 01・02・03 と練習1〜4)', () => {
    expect(ALL_SCENARIOS.map((x) => `${x.game}/${x.scenario.id}`)).toEqual([
      'b-kakuu/b-01',
      'b-kakuu/b-02',
      'b-kakuu/b-03',
      'b-kakuu/t-1',
      'b-kakuu/t-2',
      'b-kakuu/t-3',
      'b-kakuu/t-4',
    ]);
  });
  for (const { game, scenario } of ALL_SCENARIOS) {
    for (const bot of ALL_BOTS) {
      it(`${game}/${scenario.id} × ${bot.name}: シード${BOT_SEEDS[0]}〜${BOT_SEEDS.at(-1)}で例外・無限ループ・合計のずれがない`, () => {
        const problems: string[] = [];
        for (const seed of BOT_SEEDS) {
          const { failures } = runBot(game, scenario, bot, seed);
          for (const f of failures) problems.push(`seed ${seed}: ${f}`);
        }
        expect(problems).toEqual([]);
      });
    }
  }
});
