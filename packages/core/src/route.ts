import { findLink, neighbors, type GameMap, type LinkRaid, type LinkRisk } from './map';

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

/** ノード列が、隣どうしリンクでつながった重複のない道かを調べ、Route にする。不正なら null。 */
export function routeFromNodes(map: GameMap, nodes: string[]): Route | null {
  if (nodes.length < 2) return null;
  if (new Set(nodes).size !== nodes.length) return null;
  let days = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const link = findLink(map, nodes[i]!, nodes[i + 1]!);
    if (!link) return null;
    days += link.days;
  }
  return { nodes, days };
}

/**
 * from から to への道の候補を、日数の短い順に最大 limit 本返す(同じ拠点を2度通らない道だけ)。
 * 深さ優先で全部の道を数えるので、拠点が数十を超える地図では遅くなる(今の地図は5拠点)。
 * 日数が同じ道は、通るノードIDの並びで順番を決める(結果が毎回同じになるように)。
 */
export function candidateRoutes(map: GameMap, from: string, to: string, limit = 3): Route[] {
  if (from === to) return [];
  const out: Route[] = [];
  const path = [from];
  const visit = (cur: string, days: number) => {
    if (cur === to) {
      out.push({ nodes: [...path], days });
      return;
    }
    for (const nb of neighbors(map, cur)) {
      if (path.includes(nb)) continue;
      path.push(nb);
      visit(nb, days + findLink(map, cur, nb)!.days);
      path.pop();
    }
  };
  visit(from, 0);
  out.sort((a, b) => a.days - b.days || a.nodes.length - b.nodes.length || a.nodes.join('>').localeCompare(b.nodes.join('>')));
  return out.slice(0, limit);
}

/** 道に含まれる危険な区間 */
export function routeRisks(map: GameMap, nodes: string[]): { a: string; b: string; risk: LinkRisk }[] {
  const out: { a: string; b: string; risk: LinkRisk }[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const link = findLink(map, nodes[i]!, nodes[i + 1]!);
    if (link?.risk) out.push({ a: nodes[i]!, b: nodes[i + 1]!, risk: link.risk });
  }
  return out;
}

/** 道に含まれる襲撃のある区間(days はその区間の日数) */
export function routeRaids(map: GameMap, nodes: string[]): { a: string; b: string; days: number; raid: LinkRaid }[] {
  const out: { a: string; b: string; days: number; raid: LinkRaid }[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const link = findLink(map, nodes[i]!, nodes[i + 1]!);
    if (link?.raid) out.push({ a: nodes[i]!, b: nodes[i + 1]!, days: link.days, raid: link.raid });
  }
  return out;
}
