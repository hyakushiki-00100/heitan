import type { SimState } from './sim';

export interface Scoring {
  /** 帰還した1人あたりの得点 */
  perPerson: number;
  /** 余剰の米1あたりの減点 */
  perSurplus: number;
}

export const DEFAULT_SCORING: Scoring = { perPerson: 10, perSurplus: 1 };

/**
 * ★の基準(仮。1-7 で見直す)。得点が満点のこの割合以上で★1・★2・★3。陣を保てなければ★0。
 * シナリオの starThresholds で変えられる
 */
export const DEFAULT_STAR_THRESHOLDS: readonly [number, number, number] = [0.6, 0.8, 0.95];

export interface ExpeditionResult {
  /** 目標日数まで陣を保てたか */
  held: boolean;
  troopsHome: number;
  troopsTotal: number;
  carriersHome: number;
  carriersTotal: number;
  /** 蔵以外に残った米と物資の合計(村への負担・米価の上昇) */
  surplus: number;
  /** 拠点ごとの余剰(米と物資の合計) */
  surplusByNode: { id: string; amount: number }[];
  /** 市で払った額(村への負担のうち、買った分) */
  purchaseBurden: number;
  /** 村への負担の合計(余剰の減点 + 市で払った額) */
  villageBurden: number;
  score: number;
  /** 満点(全員帰還・余剰0) */
  maxScore: number;
  /** ★の数(0〜3) */
  stars: number;
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
    surplus += c.cargo + Object.values(c.goods).reduce((a, b) => a + b, 0);
  }
  const surplusByNode: { id: string; amount: number }[] = [];
  for (const n of sc.map.nodes) {
    if (n.id === sc.depotId) continue;
    let r = state.rice[n.id] ?? 0;
    for (const g of Object.values(state.goods)) r += g[n.id] ?? 0;
    if (r > 0) surplusByNode.push({ id: n.id, amount: r });
    surplus += r;
  }
  // 村の運び手が届ける途中の米も、蔵の外に残った米として数える
  for (const o of state.orders) surplus += o.rice;
  const purchaseBurden = state.purchaseBurden;
  const villageBurden = surplus * scoring.perSurplus + purchaseBurden;
  const score = held ? (troopsHome + carriersHome) * scoring.perPerson - villageBurden : 0;
  const maxScore = (state.army.troopsTotal + carriersTotal) * scoring.perPerson;
  const th = sc.starThresholds ?? DEFAULT_STAR_THRESHOLDS;
  const ratio = maxScore > 0 ? score / maxScore : 0;
  const stars = !held ? 0 : ratio >= th[2] ? 3 : ratio >= th[1] ? 2 : ratio >= th[0] ? 1 : 0;
  return {
    held,
    troopsHome,
    troopsTotal: state.army.troopsTotal,
    carriersHome,
    carriersTotal,
    surplus,
    surplusByNode,
    purchaseBurden,
    villageBurden,
    score,
    maxScore,
    stars,
  };
}
