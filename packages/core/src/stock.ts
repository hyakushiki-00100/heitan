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
