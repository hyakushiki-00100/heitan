import type { SimState } from './sim';

export interface Scoring {
  /** 帰還した1人あたりの得点 */
  perPerson: number;
  /** 余剰の米1あたりの減点 */
  perSurplus: number;
}

export const DEFAULT_SCORING: Scoring = { perPerson: 10, perSurplus: 1 };

export interface ExpeditionResult {
  /** 目標日数まで陣を保てたか */
  held: boolean;
  troopsHome: number;
  troopsTotal: number;
  carriersHome: number;
  carriersTotal: number;
  /** 蔵以外に残った米(村への負担・米価の上昇) */
  surplus: number;
  surplusByNode: { id: string; rice: number }[];
  score: number;
}

/** 遠征の評価。遠征中に呼んでも、その時点の値を返す。 */
export function evaluate(state: SimState): ExpeditionResult {
  const sc = state.scenario;
  const scoring = sc.scoring ?? DEFAULT_SCORING;
  const held = state.outcome !== 'lost';
  const troopsHome = state.army.phase === 'home' ? state.army.troops : 0;
  let carriersTotal = 0;
  let carriersHome = 0;
  let surplus = 0;
  for (const c of state.convoys) {
    carriersTotal += c.carriers;
    if (!c.dropped && !c.move && c.at === sc.depotId) carriersHome += c.carriers;
    surplus += c.cargo;
  }
  const surplusByNode: { id: string; rice: number }[] = [];
  for (const n of sc.map.nodes) {
    if (n.id === sc.depotId) continue;
    const r = state.rice[n.id] ?? 0;
    if (r > 0) surplusByNode.push({ id: n.id, rice: r });
    surplus += r;
  }
  const score = held ? (troopsHome + carriersHome) * scoring.perPerson - surplus * scoring.perSurplus : 0;
  return {
    held,
    troopsHome,
    troopsTotal: state.army.troopsTotal,
    carriersHome,
    carriersTotal,
    surplus,
    surplusByNode,
    score,
  };
}
