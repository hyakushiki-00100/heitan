import { findLink, neighbors, type GameMap } from './map';

export interface Route {
  /** 出発ノードから到着ノードまでのID列(両端を含む) */
  nodes: string[];
  /** 合計日数 */
  days: number;
}

/** 日数が最短の経路(ダイクストラ法)。到達できなければ null。 */
export function shortestRoute(map: GameMap, from: string, to: string): Route | null {
  if (from === to) return { nodes: [from], days: 0 };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();

  for (;;) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        cur = id;
      }
    }
    if (cur === null) return null;
    if (cur === to) break;
    done.add(cur);
    for (const nb of neighbors(map, cur)) {
      const link = findLink(map, cur, nb);
      if (!link) continue;
      const nd = best + link.days;
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd);
        prev.set(nb, cur);
      }
    }
  }

  const nodes = [to];
  while (nodes[0] !== from) {
    const p = prev.get(nodes[0]!);
    if (p === undefined) return null;
    nodes.unshift(p);
  }
  return { nodes, days: dist.get(to)! };
}
