/**
 * 全作品・全シナリオを、全ボット × 決まったシードで遊ばせ、out/balance.csv に記録し、調整候補を報告する。
 * 使い方: npm run balance
 * 異常(例外・無限ループ・合計のずれ)があれば、その内容を出して終了コード1で終わる
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { judge, toCsv } from '../packages/core/tests/bot/balance';
import { ALL_BOTS } from '../packages/core/tests/bot/bots';
import { runBot, type RunRow } from '../packages/core/tests/bot/runner';
import { ALL_SCENARIOS, BOT_SEEDS } from '../packages/core/tests/bot/scenarios';

const outDir = fileURLToPath(new URL('../out/', import.meta.url));
const rows: RunRow[] = [];
const problems: string[] = [];
for (const { game, scenario } of ALL_SCENARIOS) {
  for (const bot of ALL_BOTS) {
    for (const seed of BOT_SEEDS) {
      const { row, failures } = runBot(game, scenario, bot, seed);
      rows.push(row);
      for (const f of failures) problems.push(`${game}/${scenario.id} ${bot.name} seed ${seed}: ${f}`);
    }
  }
}
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + 'balance.csv', toCsv(rows));
console.log(`out/balance.csv に ${rows.length} 行を書いた(${ALL_SCENARIOS.length}シナリオ × ${ALL_BOTS.length}ボット × シード${BOT_SEEDS.length}個)`);

const f1 = (v: number) => v.toFixed(1);
for (const rep of judge(rows)) {
  console.log(`\n## ${rep.game}/${rep.scenario}`);
  console.log('| ボット | ★中央値 | ★平均 | ★最小〜最大 | 平均点 | 平均余剰 | 陣の失陥率 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const b of rep.bots) {
    console.log(`| ${b.bot} | ${b.medianStars} | ${f1(b.meanStars)} | ${b.minStars}〜${b.maxStars} | ${f1(b.meanScore)} | ${f1(b.meanSurplus)} | ${Math.round(b.lostRate * 100)}% |`);
  }
  console.log(rep.flags.length ? `調整候補: ${rep.flags.join(' / ')}` : '調整候補: なし');
}
if (problems.length) {
  console.error(`\n異常 ${problems.length} 件:`);
  for (const p of problems.slice(0, 50)) console.error('  ' + p);
  process.exit(1);
}
