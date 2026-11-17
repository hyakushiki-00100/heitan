import { convoyPosition, daysLeft, dailyConsumption, type MapNode, type SimState } from '@hyoro/core';

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
}

export function toScreen(v: View, n: { x: number; y: number }): { x: number; y: number } {
  return { x: v.pad + (n.x / 100) * (v.w - 2 * v.pad), y: v.pad + (n.y / 100) * (v.h - 2 * v.pad) };
}

const NODE_R = 20;

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
    ctx.strokeStyle = hot ? C.accent : C.line;
    ctx.lineWidth = hot ? 5 : 3;
    ctx.setLineDash(hot ? [] : [8, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const label = `${l.days}日`;
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = C.paper;
    ctx.fillRect(mx - tw / 2, my - 8, tw, 16);
    ctx.fillStyle = hot ? C.accent : C.ink2;
    ctx.fillText(label, mx, my);
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
    const left = daysLeft(rice, dailyConsumption(sc, n.id));
    if (left !== null) {
      ctx.font = 'bold 13px serif';
      ctx.fillStyle = daysLeftColor(left);
      ctx.fillText(`あと${left.toFixed(1)}日`, p.x, p.y + NODE_R + 12);
    }
  }

  // 運搬隊
  const idleCount = new Map<string, number>();
  state.convoys.forEach((c, i) => {
    let p = toScreen(v, convoyPosition(state, c, alpha));
    if (!c.move) {
      const k = idleCount.get(c.at) ?? 0;
      idleCount.set(c.at, k + 1);
      const ang = Math.PI * 0.25 + k * (Math.PI / 3);
      p = { x: p.x + Math.cos(ang) * (NODE_R + 12), y: p.y + Math.sin(ang) * (NODE_R + 12) };
    } else {
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
