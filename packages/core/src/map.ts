export type NodeKind = 'depot' | 'village' | 'pass' | 'camp' | 'front';

export interface MapNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** 描画用座標(0〜100)。シミュレーションでは使わない */
  x: number;
  y: number;
}

export interface MapLink {
  a: string;
  b: string;
  /** 1人が歩いて何日かかるか */
  days: number;
}

export interface GameMap {
  nodes: MapNode[];
  links: MapLink[];
}

/** 地図データの整合性を検査する。問題があれば Error を投げる。 */
export function validateMap(map: GameMap): void {
  const ids = new Set<string>();
  for (const n of map.nodes) {
    if (ids.has(n.id)) throw new Error(`ノードIDが重複: ${n.id}`);
    ids.add(n.id);
  }
  const seen = new Set<string>();
  for (const l of map.links) {
    if (!ids.has(l.a) || !ids.has(l.b)) throw new Error(`存在しないノードへのリンク: ${l.a}-${l.b}`);
    if (l.a === l.b) throw new Error(`自己リンク: ${l.a}`);
    if (!(l.days > 0)) throw new Error(`日数は正の数: ${l.a}-${l.b}`);
    const key = [l.a, l.b].sort().join('|');
    if (seen.has(key)) throw new Error(`リンクが重複: ${key}`);
    seen.add(key);
  }
}

/** 2ノード間のリンクを返す(向きは問わない)。無ければ undefined。 */
export function findLink(map: GameMap, a: string, b: string): MapLink | undefined {
  return map.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

/** 隣接ノードID一覧 */
export function neighbors(map: GameMap, id: string): string[] {
  const out: string[] = [];
  for (const l of map.links) {
    if (l.a === id) out.push(l.b);
    else if (l.b === id) out.push(l.a);
  }
  return out;
}
