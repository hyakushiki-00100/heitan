import { armyPosition, convoyPosition, frontDaysLeft, goodsOf, type MapNode, type SimState } from '@hyoro/core';

const C = {
  paper: '#f4efe4',
  line: '#b9ad96',
  ink: '#2b2620',
  ink2: '#6b6256',
  accent: '#8a3b2a',
  ok: '#3d6b3a',
  warn: '#b07a1c',
  bad: '#a3322a',
  node: '#fffaf0',
};

export interface View {
  w: number;
  h: number;
  pad: number;
}

export interface Highlight {
  selectedConvoyId: string | null;
  routeNodes: string[] | null;
  /** 撤退路(保持中だけ表示) */
  retreatNodes: string[] | null;
  /** 撤退路の途中の拠点に置いておくべき米 */
  stops: { id: string; required: number; have: number }[];
}

export function toScreen(v: View, n: { x: number; y: number }): { x: number; y: number } {
  return { x: v.pad + (n.x / 100) * (v.w - 2 * v.pad), y: v.pad + (n.y / 100) * (v.h - 2 * v.pad) };
}

const NODE_R = 20;
/**
 * 待機中の印を拠点のまわりに置く角度(度。0=右、90=下)。拠点名は真上にあるので上側を避ける。
 * 真横(0・180度)は拠点の中の「米○○」の文字にかかるので、内側の輪では使わない。
 * 5つを超えたら、外側の輪に半分ずらした角度で並べる
 */
const IDLE_ANGLES = [30, 90, 150, 210, 330];
const IDLE_RING_GAP = 22;

/** 拠点で待機している隊の印の、拠点の中心からの位置(k 番目) */
function idleOffset(k: number): { x: number; y: number } {
  const ring = Math.floor(k / IDLE_ANGLES.length);
  const deg = IDLE_ANGLES[k % IDLE_ANGLES.length]! + ring * 30;
  const r = NODE_R + 12 + ring * IDLE_RING_GAP;
  return { x: Math.cos((deg * Math.PI) / 180) * r, y: Math.sin((deg * Math.PI) / 180) * r };
}

/** 画面座標にある拠点のID。無ければ null。 */
export function hitNode(state: SimState, v: View, x: number, y: number): string | null {
  for (const n of state.scenario.map.nodes) {
    const p = toScreen(v, n);
    if (Math.hypot(p.x - x, p.y - y) <= NODE_R + 10) return n.id;
  }
  return null;
}

export function daysLeftColor(d: number): string {
  if (d < 2) return C.bad;
  if (d < 5) return C.warn;
  return C.ok;
}

/** 移動中の印が拠点の丸や文字に重ならないよう、近すぎる場合は丸の外へ押し出す */
function avoidNodes(state: SimState, v: View, p: { x: number; y: number }, min = NODE_R + 14): { x: number; y: number } {
  for (const n of state.scenario.map.nodes) {
    const c = toScreen(v, n);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    if (d < 0.5) return { x: c.x + min, y: c.y };
    return { x: c.x + (dx / d) * min, y: c.y + (dy / d) * min };
  }
  return p;
}

export function draw(ctx: CanvasRenderingContext2D, state: SimState, v: View, alpha: number, hl: Highlight): void {
  const sc = state.scenario;
  const byId = new Map<string, MapNode>(sc.map.nodes.map((n) => [n.id, n]));
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, v.w, v.h);

  // 道
  const onRoute = new Set<string>();
  if (hl.routeNodes) {
    for (let i = 0; i + 1 < hl.routeNodes.length; i++) onRoute.add([hl.routeNodes[i], hl.routeNodes[i + 1]].sort().join('|'));
  }
  ctx.font = '12px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of sc.map.links) {
    const a = toScreen(v, byId.get(l.a)!);
    const b = toScreen(v, byId.get(l.b)!);
    const hot = onRoute.has([l.a, l.b].sort().join('|'));
    ctx.strokeStyle = hot ? C.accent : l.risk ? C.warn : C.line;
    ctx.lineWidth = hot ? 5 : 3;
    ctx.setLineDash(hot ? [] : [8, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // 狭い画面では危険の名前を省く(拠点の文字と重なるため。名前は道の選択と用語集で見られる)
    const label = l.risk ? (v.w < 600 ? `${l.days}日⚠` : `${l.days}日 ⚠${l.risk.label}`) : `${l.days}日`;
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = C.paper;
    ctx.fillRect(mx - tw / 2, my - 8, tw, 16);
    ctx.fillStyle = hot ? C.accent : l.risk ? C.warn : C.ink2;
    ctx.fillText(label, mx, my);
  }

  // 撤退路(保持中は薄く示す)
  if (hl.retreatNodes) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = C.bad;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    hl.retreatNodes.forEach((id, i) => {
      const p = toScreen(v, byId.get(id)!);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // 拠点
  for (const n of sc.map.nodes) {
    const p = toScreen(v, n);
    ctx.fillStyle = C.node;
    ctx.strokeStyle = n.kind === 'front' ? C.accent : C.ink;
    ctx.lineWidth = n.kind === 'front' || n.kind === 'depot' ? 3 : 1.5;
    ctx.beginPath();
    if (n.kind === 'depot') ctx.rect(p.x - NODE_R, p.y - NODE_R, NODE_R * 2, NODE_R * 2);
    else ctx.arc(p.x, p.y, NODE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = C.ink;
    ctx.font = 'bold 14px serif';
    ctx.fillText(n.name, p.x, p.y - NODE_R - 12);
    const rice = state.rice[n.id] ?? 0;
    ctx.font = '12px serif';
    // 円(四角)の中に収まるよう、100以上は小数を出さない
    ctx.fillText(`米${rice >= 100 ? Math.round(rice) : fmt(rice)}`, p.x, p.y);
    // 円の下に行を積む: あと何日 → 撤退用の置き米 → 物資の量
    let below = p.y + NODE_R + 12;
    const left = frontDaysLeft(state, n.id).days;
    if (left !== null) {
      ctx.font = 'bold 13px serif';
      ctx.fillStyle = daysLeftColor(left);
      ctx.fillText(`あと${left.toFixed(1)}日`, p.x, below);
      below += 15;
    }
    const stop = hl.stops.find((x) => x.id === n.id);
    if (stop && stop.required > 0) {
      const ok = stop.have + 1e-9 >= stop.required;
      ctx.font = 'bold 12px serif';
      ctx.fillStyle = ok ? C.ok : C.bad;
      ctx.fillText(`撤退用 ${fmt(stop.have)}/${fmt(stop.required)}`, p.x, below);
      below += 15;
    }
    const goodsText = goodsOf(sc)
      .map((g) => ({ g, v: state.goods[g.id]![n.id] ?? 0 }))
      .filter((x) => x.v > 1e-9)
      .map((x) => `${x.g.name}${fmt(x.v)}`)
      .join(' ');
    if (goodsText) {
      // 待機中の隊の印(拠点の周り、半径 NODE_R+12 に置く)と重ならないよう、その外側に書く
      const idleHere = state.convoys.some((c) => !c.move && !c.dropped && c.at === n.id);
      if (idleHere) {
        const n2 = state.convoys.filter((c) => !c.move && !c.dropped && c.at === n.id).length;
        const rings = Math.ceil(n2 / IDLE_ANGLES.length);
        below = Math.max(below, p.y + NODE_R + 12 + (rings - 1) * IDLE_RING_GAP + 10 + 12);
      }
      ctx.font = '11px serif';
      ctx.fillStyle = C.ink2;
      ctx.fillText(goodsText, p.x, below);
    }
  }

  // 軍勢
  const a = state.army;
  if (a.phase !== 'gone') {
    let p = toScreen(v, armyPosition(state, alpha));
    const label = a.move ? `兵${a.troops} 米${fmt(a.cargo)}` : `兵${a.troops}`;
    ctx.font = 'bold 12px serif';
    const w = ctx.measureText(label).width + 12;
    // 札は横長なので、半分の幅ぶん余分に離す
    if (!a.move) {
      // 拠点の左に置く。待機中の隊の印が周りにあるなら、印と重ならないよう拠点名の上に置く
      const crowded = state.convoys.some((c) => !c.move && !c.dropped && c.at === a.at);
      p = crowded ? { x: p.x, y: p.y - NODE_R - 34 } : { x: p.x - NODE_R - 4 - w / 2, y: p.y - 4 };
    } else {
      // 移動中は、同じ道を進む運搬隊の印と重ならないよう、道の線より上にずらす
      p = avoidNodes(state, v, p, NODE_R + 6 + w / 2);
      p = { x: p.x, y: p.y - 24 };
    }
    ctx.fillStyle = C.bad;
    ctx.fillRect(p.x - w / 2, p.y - 10, w, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, p.x, p.y + 0.5);
  }

  // 運搬隊
  // 待機中の隊は拠点のまわりに1つずつ並べる。移動中の隊は、同じ場所を一緒に進むものを1つの印にまとめる
  // (狭い画面で7隊が重なると、どう並べても拠点の文字や軍勢の札に重なるため)
  const idleCount = new Map<string, number>();
  const groups = new Map<string, { p: { x: number; y: number }; idx: number[] }>();
  state.convoys.forEach((c, i) => {
    if (c.dropped) return;
    if (!c.move) {
      const k = idleCount.get(c.at) ?? 0;
      idleCount.set(c.at, k + 1);
      const base = toScreen(v, convoyPosition(state, c, alpha));
      const off = idleOffset(k);
      drawConvoyMark(ctx, { x: base.x + off.x, y: base.y + off.y }, String(i + 1), false, c.id === hl.selectedConvoyId, null);
      return;
    }
    const p = avoidNodes(state, v, toScreen(v, convoyPosition(state, c, alpha)));
    const key = `${Math.round(p.x / 10)},${Math.round(p.y / 10)}`;
    const g = groups.get(key) ?? { p, idx: [] };
    g.idx.push(i);
    groups.set(key, g);
  });
  for (const g of groups.values()) {
    const cs = g.idx.map((i) => state.convoys[i]!);
    // 積荷の数字は、拠点の近く(中心から60px以内)では出さない(拠点の「あと○日」などの文字に重なるため。数字は右のパネルで見られる)
    const nearNode = sc.map.nodes.some((n) => {
      const q = toScreen(v, n);
      return Math.hypot(q.x - g.p.x, q.y - g.p.y) < 60;
    });
    const cargo = cs.reduce((t, c) => t + c.cargo, 0);
    const label = cs.length === 1 ? String(g.idx[0]! + 1) : `${cs.length}隊`;
    const sel = cs.some((c) => c.id === hl.selectedConvoyId);
    drawConvoyMark(ctx, g.p, label, true, sel, nearNode ? null : `米${fmt(cargo)}`);
  }
}

/** 運搬隊の印。label は隊番号か「6隊」。cargoText があれば右に書く */
function drawConvoyMark(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  label: string,
  moving: boolean,
  selected: boolean,
  cargoText: string | null,
): void {
  ctx.font = 'bold 11px sans-serif';
  const w = Math.max(20, ctx.measureText(label).width + 10);
  ctx.fillStyle = moving ? C.accent : C.ink2;
  ctx.strokeStyle = selected ? C.ink : C.paper;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.beginPath();
  if (w <= 20) ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
  else ctx.roundRect(p.x - w / 2, p.y - 10, w, 20, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillText(label, p.x, p.y + 0.5);
  if (cargoText) {
    ctx.fillStyle = C.ink;
    ctx.font = '11px serif';
    ctx.textAlign = 'left';
    ctx.fillText(cargoText, p.x + w / 2 + 4, p.y);
    ctx.textAlign = 'center';
  }
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
