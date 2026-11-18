/**
 * ボットで遠征を最後まで動かし、記録と異常を返す。
 * 異常(どれか1つでも起きたら失敗): 例外 / 無限ループ / 物資の合計が合わない / 人数の合計が合わない
 */
import { createState, currentDay, evaluate, ledgerMismatch, step, type Scenario, type SimState } from '../../src';
import type { Bot } from './bots';

/** 物資の合計の許容誤差(浮動小数の端数の切り捨てが積み重なる分) */
export const LEDGER_TOLERANCE = 1e-4;

export interface RunRow {
  game: string;
  scenario: string;
  bot: string;
  seed: number;
  outcome: string;
  stars: number;
  score: number;
  maxScore: number;
  /** 遠征が終わった日(所要日数) */
  days: number;
  /** 兵糧(または薪)が尽きた拠点の数(陣が尽きれば1) */
  starvedNodes: number;
  /** 撤退中に食べられない兵が出た日数 */
  hungerDays: number;
  surplus: number;
  /** 負傷者数(このゲームでは離脱した兵と人足の合計) */
  injured: number;
  /** 村への負担(余剰の減点 + 市で払った額) */
  villageBurden: number;
  troopsHome: number;
  carriersHome: number;
}

export interface RunResult {
  row: RunRow;
  failures: string[];
}

/** 人数の合計が合っているか(兵: 今の兵数+離脱=最初の兵数。人足: 隊ごとの人数は変わらない) */
function headcountProblems(s: SimState): string[] {
  const out: string[] = [];
  const a = s.army;
  if (a.troops < 0 || a.troops + a.dropped !== a.troopsTotal) out.push(`兵の合計が合わない: ${a.troops}+${a.dropped}≠${a.troopsTotal}`);
  s.convoys.forEach((c, i) => {
    const orig = s.scenario.convoys[i]!;
    if (c.carriers !== orig.carriers) out.push(`人足の数が変わった: ${c.id}`);
    if (c.dropped && (c.move || c.cargo > 0)) out.push(`離脱した隊が動いている/荷を持っている: ${c.id}`);
  });
  return out;
}

export function runBot(game: string, scenario: Scenario, bot: Bot, seed: number): RunResult {
  const failures: string[] = [];
  let s: SimState | null = null;
  // 撤退開始の日数 + 撤退と帰り道に十分な日数。これを超えたら無限ループとみなす
  const maxSteps = Math.ceil((scenario.goalDays + 100) / scenario.stepDays);
  try {
    s = createState(structuredClone(scenario), seed);
    bot.setup?.(s);
    let steps = 0;
    while (s.outcome === 'playing') {
      if (steps++ > maxSteps) {
        failures.push(`無限ループ: ${maxSteps}刻みを超えても終わらない`);
        break;
      }
      bot.act(s);
      step(s);
      for (const m of ledgerMismatch(s, LEDGER_TOLERANCE)) failures.push(`物資の合計が合わない(${currentDay(s)}日目): ${m.res} ずれ ${m.diff}`);
      failures.push(...headcountProblems(s));
      if (failures.length) break;
    }
  } catch (e) {
    failures.push(`例外: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  const r = s ? evaluate(s) : null;
  const dropCarriers = s ? s.convoys.filter((c) => c.dropped).reduce((n, c) => n + c.carriers, 0) : 0;
  const row: RunRow = {
    game,
    scenario: scenario.id,
    bot: bot.name,
    seed,
    outcome: s?.outcome ?? 'error',
    stars: r?.stars ?? 0,
    score: r ? Math.round(r.score * 10) / 10 : 0,
    maxScore: r?.maxScore ?? 0,
    days: s ? currentDay(s) : 0,
    starvedNodes: s?.stats.starvedNode ? 1 : 0,
    hungerDays: s ? s.stats.hungerSteps * scenario.stepDays : 0,
    surplus: r ? Math.round(r.surplus * 10) / 10 : 0,
    injured: (s?.army.dropped ?? 0) + dropCarriers,
    villageBurden: r ? Math.round(r.villageBurden * 10) / 10 : 0,
    troopsHome: r?.troopsHome ?? 0,
    carriersHome: r?.carriersHome ?? 0,
  };
  return { row, failures };
}
