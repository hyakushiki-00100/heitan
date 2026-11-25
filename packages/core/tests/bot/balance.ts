/** balance.csv の行の集計と、調整候補の判定(CLAUDE.md §9-3)。集計はすべてここで行う */
import type { RunRow } from './runner';

export const CSV_COLUMNS: (keyof RunRow)[] = [
  'game', 'scenario', 'bot', 'seed', 'outcome', 'stars', 'score', 'maxScore', 'days',
  'starvedNodes', 'hungerDays', 'surplus', 'injured', 'villageBurden', 'troopsHome', 'carriersHome',
];

export function toCsv(rows: RunRow[]): string {
  const esc = (v: unknown) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface BotSummary {
  bot: string;
  medianStars: number;
  meanStars: number;
  minStars: number;
  maxStars: number;
  meanScore: number;
  meanSurplus: number;
  lostRate: number;
}

export interface ScenarioReport {
  game: string;
  scenario: string;
  bots: BotSummary[];
  /** 調整候補の理由(空なら候補ではない) */
  flags: string[];
}

/**
 * 調整候補の判定(数値の基準はここで決めている。CLAUDE.md の文言を次のように読んだ)
 * - naive でも★2以上: naive の★の中央値が 2 以上
 * - preset-rules の最良でも★1が取れない: rules:… のうち★の平均が最も高いボットでも、中央値が 1 未満
 * - シードで大きくぶれる: naive か最良の rules で、★の最大と最小の差が 2 以上
 * - 余剰の減点が効いていない: idle 以外のすべてのボットで、余剰の平均が満点の 1% 未満
 */
export function judge(rows: RunRow[]): ScenarioReport[] {
  const keys = [...new Set(rows.map((r) => `${r.game}|${r.scenario}`))];
  return keys.map((k) => {
    const [game, scenario] = k.split('|') as [string, string];
    const mine = rows.filter((r) => r.game === game && r.scenario === scenario);
    const bots = [...new Set(mine.map((r) => r.bot))].map((bot): BotSummary => {
      const rs = mine.filter((r) => r.bot === bot);
      const stars = rs.map((r) => r.stars);
      return {
        bot,
        medianStars: median(stars),
        meanStars: mean(stars),
        minStars: Math.min(...stars),
        maxStars: Math.max(...stars),
        meanScore: mean(rs.map((r) => r.score)),
        meanSurplus: mean(rs.map((r) => r.surplus)),
        lostRate: rs.filter((r) => r.outcome === 'lost').length / rs.length,
      };
    });
    const flags: string[] = [];
    const maxScore = mine[0]?.maxScore ?? 0;
    const nv = bots.find((b) => b.bot === 'naive');
    const rules = bots.filter((b) => b.bot.startsWith('rules:'));
    const best = rules.reduce<BotSummary | null>((a, b) => (!a || b.meanStars > a.meanStars ? b : a), null);
    // 練習の遠征(ID が t- で始まる)は、わざとやさしく作り、カードの無いものもある。
    // 「やさしすぎる」「カードで勝てない」は調べない(手順どおりに遊べば勝てることは各作品の tutorial.test.ts で確かめる)
    const practice = scenario.startsWith('t-');
    if (!practice && nv && nv.medianStars >= 2) flags.push(`naive でも★${nv.medianStars}(中央値)が取れる`);
    if (!practice && best && best.medianStars < 1) flags.push(`ルールカードの最良(${best.bot})でも★の中央値が${best.medianStars}`);
    for (const b of [nv, best]) {
      if (b && b.maxStars - b.minStars >= 2) flags.push(`${b.bot} の★がシードで ${b.minStars}〜${b.maxStars} とぶれる`);
    }
    const nonIdle = bots.filter((b) => b.bot !== 'idle');
    if (nonIdle.length && nonIdle.every((b) => b.meanSurplus < maxScore * 0.01)) flags.push('どのボットでも余剰がほぼ0(余剰の減点が効いていない)');
    return { game, scenario, bots, flags };
  });
}
