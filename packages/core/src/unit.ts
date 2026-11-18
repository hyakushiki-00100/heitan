/** 移動の状態。運搬隊と軍勢で共通。 */
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

/** 運搬隊。人足の集まりで、運んでいる米を自分たちでも食べる。 */
export interface Convoy {
  id: string;
  name: string;
  /** 人足の数 */
  carriers: number;
  /** 今いる拠点(移動中は最後に通った拠点) */
  at: string;
  /** 積んでいる米(人足が道中で食べるのはこの米) */
  cargo: number;
  /** 積んでいる米以外の物資(物資ID → 量) */
  goods: Record<string, number>;
  /** 移動中なら状態、止まっていれば null */
  move: Move | null;
  /** 道中で食料が尽きて離脱した(もう動かせない) */
  dropped: boolean;
  /** 自動で動くか(ルールカードに従う)。手動の隊は false */
  auto: boolean;
}

export type ArmyPhase = 'hold' | 'retreat' | 'home' | 'gone';

/** 前線の軍勢。保持中は拠点の米を食べ、撤退中は持っている米を食べる。 */
export interface Army {
  /** 今の兵数 */
  troops: number;
  /** 最初の兵数 */
  troopsTotal: number;
  /** 兵1人が1日に食べる米 */
  ration: number;
  /** 兵1人が撤退時に持てる米 */
  capacityPer: number;
  at: string;
  /** 撤退中に持っている米 */
  cargo: number;
  /** 撤退中に持っている米以外の物資 */
  goods: Record<string, number>;
  /** 塩・味噌などが足りずに「体を壊す」端数(1たまるごとに1人離脱) */
  healthDebt: number;
  move: Move | null;
  /** 撤退路(陣→蔵のノード列)。保持中はプレイヤーが選び直せる */
  retreatNodes: string[];
  /** hold=陣を保持 / retreat=撤退中 / home=蔵に戻った / gone=全員離脱 */
  phase: ArmyPhase;
  /** 離脱した兵の数 */
  dropped: number;
}

/** 1回の出発で運べる上限 */
export function maxLoad(convoy: Convoy, carrierCapacity: number): number {
  return convoy.carriers * carrierCapacity;
}

/** 運搬隊が days 日歩く間に食べる量 */
export function eatenOver(convoy: Convoy, carrierRation: number, days: number): number {
  return convoy.carriers * carrierRation * days;
}

/** 軍勢が撤退時に持てる上限(米と物資の合計) */
export function armyCapacity(army: Army): number {
  return army.troops * army.capacityPer;
}
