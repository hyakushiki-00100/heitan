import type { SimState } from './sim';

/** 拠点で毎日消費される量(陣を保持している軍勢の分を含む)。0なら消費なし */
export function nodeConsumptionPerDay(state: SimState, nodeId: string): number {
  const base = state.scenario.nodes[nodeId]?.consumptionPerDay ?? 0;
  const a = state.army;
  const army = a.phase === 'hold' && a.at === nodeId ? a.troops * a.ration : 0;
  return base + army;
}

/** あと何日もつか。消費がない拠点は null。 */
export function daysLeft(rice: number, consumptionPerDay: number): number | null {
  if (consumptionPerDay <= 0) return null;
  return rice / consumptionPerDay;
}

/**
 * 陣など、軍勢が保持している拠点が「あと何日もつか」を、米と物資ごとに出す。
 * 米と cook の物資(薪)は尽きると陣を保てないので、その最小を days として返す(limiting はその名前)。
 * health の物資(塩・味噌)は尽きてもすぐには困らないので、days には含めず health に別に出す
 */
export function frontDaysLeft(
  state: SimState,
  nodeId: string,
): { days: number | null; limiting: string; health: { name: string; days: number | null }[] } {
  const riceDays = daysLeft(state.rice[nodeId] ?? 0, nodeConsumptionPerDay(state, nodeId));
  let days = riceDays;
  let limiting = '米';
  const holding = state.army.phase === 'hold' && state.army.at === nodeId;
  const health: { name: string; days: number | null }[] = [];
  for (const g of state.scenario.goods ?? []) {
    if (g.kind === 'fodder') continue; // 飼い葉は兵が使わない
    const perDay = holding ? state.army.troops * g.perTroopPerDay : 0;
    const d = daysLeft(state.goods[g.id]![nodeId] ?? 0, perDay);
    if (g.kind === 'health') {
      health.push({ name: g.name, days: d });
      continue;
    }
    if (d !== null && (days === null || d < days)) {
      days = d;
      limiting = g.name;
    }
  }
  return { days, limiting, health };
}
