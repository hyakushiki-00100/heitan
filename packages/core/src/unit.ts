/** 運搬隊。人足の集まりで、運んでいる米を自分たちでも食べる。 */
export interface Convoy {
  id: string;
  name: string;
  /** 人足の数 */
  carriers: number;
  /** 今いる拠点(移動中は最後に出発した拠点) */
  at: string;
  /** 積んでいる米 */
  cargo: number;
  /** 移動中なら状態、止まっていれば null */
  move: Move | null;
}

export interface Move {
  /** 出発〜到着のノードID列 */
  route: string[];
  /** 今歩いている区間の番号(route[leg] → route[leg+1]) */
  leg: number;
  /** この区間の残り刻み数 */
  stepsLeft: number;
  /** この区間の全刻み数(描画の補間用) */
  legSteps: number;
}

/** 1回の出発で運べる上限 */
export function maxLoad(convoy: Convoy, carrierCapacity: number): number {
  return convoy.carriers * carrierCapacity;
}

/** 運搬隊が days 日歩く間に食べる量 */
export function eatenOver(convoy: Convoy, carrierRation: number, days: number): number {
  return convoy.carriers * carrierRation * days;
}
