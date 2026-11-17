import type { Scenario } from './sim';

/** 拠点で毎日消費される量(0なら消費なし) */
export function dailyConsumption(scenario: Scenario, nodeId: string): number {
  return scenario.nodes[nodeId]?.consumptionPerDay ?? 0;
}

/** あと何日もつか。消費がない拠点は null。 */
export function daysLeft(rice: number, consumptionPerDay: number): number | null {
  if (consumptionPerDay <= 0) return null;
  return rice / consumptionPerDay;
}
