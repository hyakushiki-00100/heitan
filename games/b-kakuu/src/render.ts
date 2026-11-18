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
/** 待機中の印を拠点のまわりに置く角度(度。0=右、90=下) */
const IDLE_ANGLES = [30, 90, 150, 210, 330, 0, 180, 60, 120];

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
    ctx.fillText(`米${fmt(rice)}`, p.x, p.y);
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
      if (idleHere) below = Math.max(below, p.y + NODE_R + 12 + 10 + 12);
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
    if (!a.move) p = { x: p.x - NODE_R - 4 - w / 2, y: p.y - 4 };
    else p = avoidNodes(state, v, p, NODE_R + 6 + w / 2);
    ctx.fillStyle = C.bad;
    ctx.fillRect(p.x - w / 2, p.y - 10, w, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, p.x, p.y + 0.5);
  }

  // 運搬隊
  const idleCount = new Map<string, number>();
  state.convoys.forEach((c, i) => {
    if (c.dropped) return;
    let p = toScreen(v, convoyPosition(state, c, alpha));
    if (!c.move) {
      const k = idleCount.get(c.at) ?? 0;
      idleCount.set(c.at, k + 1);
      // 拠点名は真上にあるので、上側(270度付近)を避けて並べる
      const ang = (IDLE_ANGLES[k % IDLE_ANGLES.length]! * Math.PI) / 180;
      p = { x: p.x + Math.cos(ang) * (NODE_R + 12), y: p.y + Math.sin(ang) * (NODE_R + 12) };
    } else {
      p = avoidNodes(state, v, p);
      // 同じ場所を進む隊は重ならないよう縦にずらす
      const key = `${Math.round(p.x / 8)},${Math.round(p.y / 8)}`;
      const k = idleCount.get(key) ?? 0;
      idleCount.set(key, k + 1);
      p = { x: p.x, y: p.y + k * 22 };
    }
    const sel = c.id === hl.selectedConvoyId;
    ctx.fillStyle = c.move ? C.accent : C.ink2;
    ctx.strokeStyle = sel ? C.ink : C.paper;
    ctx.lineWidth = sel ? 3 : 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(String(i + 1), p.x, p.y + 0.5);
    if (c.move) {
      ctx.fillStyle = C.ink;
      ctx.font = '11px serif';
      ctx.textAlign = 'left';
      ctx.fillText(`米${fmt(c.cargo)}`, p.x + 14, p.y);
      ctx.textAlign = 'center';
    }
  });
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
