export type NodeKind = 'depot' | 'village' | 'pass' | 'camp' | 'front';

export interface MapNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** 描画用座標(0〜100)。シミュレーションでは使わない */
  x: number;
  y: number;
}

/** 道の危険。通り抜けるたびに chance の確率で、積み荷の loss の割合を失う */
export interface LinkRisk {
  /** 画面とログに出す名前(例: 川越え) */
  label: string;
  /** 1回通るごとに起きる確率(0〜1) */
  chance: number;
  /** 起きたときに失う積み荷の割合(0〜1) */
  loss: number;
}

export interface MapLink {
  a: string;
  b: string;
  /** 1人が歩いて何日かかるか */
  days: number;
  /** 危険(省略は安全な道) */
  risk?: LinkRisk;
  /** 襲撃(省略は襲撃のない道) */
  raid?: LinkRaid;
}

/**
 * 襲撃(野伏せりなど)。運搬隊がその道にいる間、半日ごとに chancePerDay×半日 の確率で襲われ、
 * 積み荷の loss の割合を失う。長い道に長くいるほど狙われやすい(通るたびに1回だけの LinkRisk とはここが違う)
 */
export interface LinkRaid {
  label: string;
  /** 1日あたりの確率(半日なら半分) */
  chancePerDay: number;
  /** 襲われたときに失う積み荷の割合(0〜1) */
  loss: number;
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
    if (l.risk) {
      const r = l.risk;
      if (!(r.chance >= 0 && r.chance <= 1)) throw new Error(`危険の確率は0〜1: ${l.a}-${l.b}`);
      if (!(r.loss >= 0 && r.loss <= 1)) throw new Error(`危険で失う割合は0〜1: ${l.a}-${l.b}`);
      if (!r.label) throw new Error(`危険に名前がない: ${l.a}-${l.b}`);
    }
    if (l.raid) {
      const r = l.raid;
      if (!(r.chancePerDay >= 0 && r.chancePerDay <= 2)) throw new Error(`襲撃の確率は1日あたり0〜2: ${l.a}-${l.b}`);
      if (!(r.loss >= 0 && r.loss <= 1)) throw new Error(`襲撃で失う割合は0〜1: ${l.a}-${l.b}`);
      if (!r.label) throw new Error(`襲撃に名前がない: ${l.a}-${l.b}`);
    }
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
