import { armyPosition, convoyPosition, frontDaysLeft, type MapNode, type NodeKind, type SimState } from '@hyoro/core';
import { drawBackground } from './washi';

const C = {
  paper: '#f4efe4',
  /** 文字の縁取り(地図の絵の上でも読めるように) */
  halo: 'rgba(247,241,227,0.92)',
  /** 道(国絵図の朱線) */
  road: '#b4583c',
  ink: '#2b2620',
  ink2: '#5f564a',
  accent: '#8a3b2a',
  ok: '#2f5f2d',
  warn: '#9a6512',
  bad: '#a3322a',
  node: '#fbf6ea',
  army: '#7c2619',
};

/** 拠点の丸の中に薄く書く字(拠点の種類) */
const KIND_GLYPH: Record<NodeKind, string> = { depot: '蔵', village: '里', camp: '営', pass: '峠', front: '陣' };
const SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';

/** 縁取りした文字 */
function inkText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, font: string, halo = 3.5): void {
  ctx.font = font;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = C.halo;
  ctx.lineWidth = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export interface View {
  w: number;
  h: number;
  /** 左右・上下の余白(上下は拠点名と下の文字が入るだけ。低い画面では地図を潰さないよう小さくする) */
  padX: number;
  padY: number;
}

export interface Highlight {
  selectedConvoyId: string | null;
  routeNodes: string[] | null;
  /** 撤退路(保持中だけ表示) */
  retreatNodes: string[] | null;
  /** 撤退路の途中の拠点に置いておくべき米 */
  stops: { id: string; required: number; have: number }[];
  /** 隊を選んで行き先を待っているとき、その隊のいる拠点(ほかの拠点に「押せる」印を付ける) */
  pickFrom: string | null;
  /** 詳しく見ている拠点 */
  selectedNodeId: string | null;
}

export function toScreen(v: View, n: { x: number; y: number }): { x: number; y: number } {
  return { x: v.padX + (n.x / 100) * (v.w - 2 * v.padX), y: v.padY + (n.y / 100) * (v.h - 2 * v.padY) };
}

/** 拠点の丸の半径。低い地図では小さくする(setScale で決める) */
let NODE_R = 22;
function setScale(v: View): void {
  NODE_R = v.h < 300 ? 17 : 22;
}
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
  setScale(v);
  for (const n of state.scenario.map.nodes) {
    const p = toScreen(v, n);
    if (Math.hypot(p.x - x, p.y - y) <= NODE_R + 10) return n.id;
  }
  return null;
}

/** 画面座標にある、拠点で待機中の運搬隊の印のID。無ければ null */
export function hitConvoy(state: SimState, v: View, x: number, y: number): string | null {
  setScale(v);
  const count = new Map<string, number>();
  for (const c of state.convoys) {
    if (c.dropped || c.move) continue;
    const k = count.get(c.at) ?? 0;
    count.set(c.at, k + 1);
    const base = toScreen(v, state.scenario.map.nodes.find((n) => n.id === c.at)!);
    const o = idleOffset(k);
    if (Math.hypot(base.x + o.x - x, base.y + o.y - y) <= 14) return c.id;
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
  setScale(v);
  drawBackground(ctx, v, sc.id);

  // 道
  const onRoute = new Set<string>();
  if (hl.routeNodes) {
    for (let i = 0; i + 1 < hl.routeNodes.length; i++) onRoute.add([hl.routeNodes[i], hl.routeNodes[i + 1]].sort().join('|'));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  // 先に線をすべて引き、日数の札はあとで上に重ねる(札が別の道の線に隠れないように)
  for (const hotPass of [false, true]) {
    for (const l of sc.map.links) {
      const hot = onRoute.has([l.a, l.b].sort().join('|'));
      if (hot !== hotPass) continue;
      const a = toScreen(v, byId.get(l.a)!);
      const b = toScreen(v, byId.get(l.b)!);
      const danger = !!(l.risk || l.raid);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (hot) {
        // 選んだ道: 紙色の縁の上に太い墨の線
        ctx.strokeStyle = C.halo;
        ctx.lineWidth = 10;
        ctx.stroke();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 5;
        ctx.setLineDash(danger ? [12, 6] : []);
        ctx.stroke();
      } else {
        // 朱の道。筆のかすれに見えるよう、細い線を少しずらして重ねる
        ctx.strokeStyle = danger ? C.warn : C.road;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 3;
        ctx.setLineDash(danger ? [9, 6] : []);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.setLineDash(danger ? [9, 6] : [22, 3, 9, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x + 1.5, a.y + 1.5);
        ctx.lineTo(b.x + 1.5, b.y + 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([]);
    }
  }
  // 日数の札は、拠点の丸・名前・下の文字・待機中の隊の印に重ならない位置を、道に沿って探して置く
  const obstacles = nodeObstacles(ctx, state, v, hl);
  if (state.army.phase !== 'gone') {
    const ab = armyBanner(ctx, state, v, alpha);
    obstacles.push({ x: ab.p.x - ab.w / 2 - 4, y: ab.p.y - 13, w: ab.w + 6, h: 28 });
  }
  const placed: Rect[] = [];
  for (const l of sc.map.links) {
    const a = toScreen(v, byId.get(l.a)!);
    const b = toScreen(v, byId.get(l.b)!);
    const hot = onRoute.has([l.a, l.b].sort().join('|'));
    // 狭い画面では危険の名前を省く(拠点の文字と重なるため。名前は道の選択と用語集で見られる)
    const mark = l.risk ? (v.w < 600 ? '⚠' : ` ⚠${l.risk.label}`) : l.raid ? (v.w < 600 ? '⚔' : ` ⚔${l.raid.label}`) : '';
    const label = `${l.days}日${mark}`;
    ctx.font = `${hot ? 'bold ' : ''}13px ${SERIF}`;
    const tw = ctx.measureText(label).width + 10;
    const { x: mx, y: my } = labelSpot(a, b, tw, 18, [...obstacles, ...placed]);
    placed.push({ x: mx - tw / 2, y: my - 9, w: tw, h: 18 });
    // 短冊(紙の札)
    ctx.fillStyle = C.node;
    ctx.strokeStyle = hot ? C.ink : l.risk || l.raid ? C.warn : 'rgba(43,38,32,0.35)';
    ctx.lineWidth = hot ? 1.5 : 1;
    ctx.beginPath();
    ctx.rect(mx - tw / 2, my - 9, tw, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hot ? C.ink : l.risk || l.raid ? C.warn : C.ink2;
    ctx.fillText(label, mx, my + 0.5);
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

  // 拠点(数字は1つだけ。物資・市の詳しい量は拠点を押すと出る)
  const small = v.h < 300;
  for (const n of sc.map.nodes) {
    const p = toScreen(v, n);
    if (hl.pickFrom && n.id !== hl.pickFrom) {
      // 行き先に選べる拠点: 朱の点線の輪
      ctx.strokeStyle = C.bad;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, NODE_R + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (n.id === hl.selectedNodeId) {
      ctx.strokeStyle = C.bad;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, NODE_R + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawNodeShape(ctx, n, p);
    const name = state.markets[n.id] ? `${n.name}・市` : n.name;
    inkText(ctx, name, p.x, p.y - NODE_R - (n.kind === 'depot' ? 17 : 11), C.ink, `bold ${small ? 14 : 15}px ${SERIF}`, 4);
    const rice = state.rice[n.id] ?? 0;
    // 丸(四角)の中に収まるよう、100以上は小数を出さない。小さい丸では「米」を省く
    ctx.font = `bold ${small ? 12 : 13}px ${SERIF}`;
    ctx.fillStyle = C.ink;
    const num = rice >= 100 ? String(Math.round(rice)) : fmt(rice);
    ctx.fillText(small ? num : `米${num}`, p.x, p.y + 0.5);
    // 丸の下は1行だけ: 陣なら「あと何日」、撤退前なら撤退路の置き米
    const below = p.y + NODE_R + 11;
    const left = frontDaysLeft(state, n.id).days;
    const stop = hl.stops.find((x) => x.id === n.id && x.required > 0);
    if (left !== null) {
      inkText(ctx, `あと${left.toFixed(1)}日`, p.x, below, daysLeftColor(left), `bold 14px ${SERIF}`, 4);
    } else if (stop) {
      const ok = stop.have + 1e-9 >= stop.required;
      inkText(ctx, `撤退用 ${fmt(stop.have)}/${fmt(stop.required)}`, p.x, below, ok ? C.ok : C.bad, `bold 13px ${SERIF}`, 4);
    }
  }

  // 軍勢
  const a = state.army;
  if (a.phase !== 'gone') {
    const { p, w, label } = armyBanner(ctx, state, v, alpha);
    // 旗印: 臙脂の旗に白い字。左端に竿
    ctx.fillStyle = C.army;
    ctx.strokeStyle = C.halo;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(p.x - w / 2, p.y - 10, w, 20);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - w / 2 - 1, p.y - 13);
    ctx.lineTo(p.x - w / 2 - 1, p.y + 15);
    ctx.stroke();
    ctx.fillStyle = '#fbf3e4';
    ctx.fillText(label, p.x + 1, p.y + 0.5);
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

/** 運搬隊の印。label は隊番号か「6隊」。動いている隊は墨、待機中は紙色。cargoText があれば右に書く */
function drawConvoyMark(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  label: string,
  moving: boolean,
  selected: boolean,
  cargoText: string | null,
): void {
  ctx.font = 'bold 12px sans-serif';
  const w = Math.max(20, ctx.measureText(label).width + 10);
  const shape = () => {
    ctx.beginPath();
    if (w <= 20) ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    else ctx.roundRect(p.x - w / 2, p.y - 10, w, 20, 10);
  };
  if (selected) {
    // 選んだ隊は朱の輪で囲む
    ctx.strokeStyle = C.bad;
    ctx.lineWidth = 6;
    shape();
    ctx.stroke();
  }
  ctx.fillStyle = moving ? C.ink : C.node;
  ctx.strokeStyle = moving ? C.halo : C.ink;
  ctx.lineWidth = moving ? 2 : 1.5;
  shape();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = moving ? '#fbf3e4' : C.ink;
  ctx.fillText(label, p.x, p.y + 0.5);
  if (cargoText) {
    ctx.textAlign = 'left';
    inkText(ctx, cargoText, p.x + w / 2 + 4, p.y, C.ink, `bold 12px ${SERIF}`, 3.5);
    ctx.textAlign = 'center';
  }
}

/** 拠点の形。蔵は屋根付きの四角、陣は陣幕の輪、ほかは丸。中に種類の字を薄く書く */
function drawNodeShape(ctx: CanvasRenderingContext2D, n: MapNode, p: { x: number; y: number }): void {
  const R = NODE_R;
  ctx.fillStyle = C.node;
  ctx.strokeStyle = C.ink;
  if (n.kind === 'depot') {
    // 屋根
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.moveTo(p.x - R - 6, p.y - R + 1);
    ctx.lineTo(p.x + R + 6, p.y - R + 1);
    ctx.lineTo(p.x + R - 3, p.y - R - 8);
    ctx.lineTo(p.x - R + 3, p.y - R - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.node;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.rect(p.x - R, p.y - R + 1, R * 2, R * 2 - 1);
    ctx.fill();
    ctx.stroke();
  } else if (n.kind === 'front') {
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.fill();
    // 陣幕: 墨と白の段だら
    ctx.lineWidth = 5;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = C.node;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.bad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R + 3.5, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.fill();
    // 筆で2度なぞったような輪
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(p.x + 0.8, p.y + 0.6, R - 1.5, 0.3, Math.PI * 1.7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.font = `bold 26px ${SERIF}`;
  ctx.fillStyle = n.kind === 'front' ? 'rgba(163,50,42,0.16)' : 'rgba(43,38,32,0.11)';
  ctx.fillText(KIND_GLYPH[n.kind], p.x, p.y + 1);
}

/** 軍勢の旗の位置・幅・文字 */
function armyBanner(ctx: CanvasRenderingContext2D, state: SimState, v: View, alpha: number): { p: { x: number; y: number }; w: number; label: string } {
  const a = state.army;
  let p = toScreen(v, armyPosition(state, alpha));
  const label = a.move ? `兵${a.troops} 米${fmt(a.cargo)}` : `兵${a.troops}`;
  ctx.font = `bold 13px ${SERIF}`;
  const w = ctx.measureText(label).width + 14;
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
  return { p, w, label };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 札を置く位置。道の真ん中から順に、両側へ少しずつずらして、ほかの物と重なりの少ない所を選ぶ。
 * 短い道では線の上のどこも拠点にかかることがあるので、線の脇(左右)にずらした位置も候補にする
 */
function labelSpot(a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number, obs: Rect[]): { x: number; y: number } {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  // 線の脇へずらす量: 札の幅・高さのうち、線と直角の向きに要る長さ+少し
  const side = (Math.abs(nx) * w + Math.abs(ny) * h) / 2 + 3;
  const cands: { t: number; o: number; pen: number }[] = [];
  for (const t of [0.5, 0.43, 0.57, 0.36, 0.64, 0.3, 0.7, 0.24, 0.76]) cands.push({ t, o: 0, pen: Math.abs(t - 0.5) * 20 });
  for (const t of [0.5, 0.42, 0.58, 0.34, 0.66]) for (const o of [side, -side]) cands.push({ t, o, pen: 10 + Math.abs(t - 0.5) * 20 });
  let best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let bestCost = Infinity;
  for (const c of cands) {
    const p = { x: a.x + (b.x - a.x) * c.t + nx * c.o, y: a.y + (b.y - a.y) * c.t + ny * c.o };
    const r = { x: p.x - w / 2, y: p.y - h / 2, w, h };
    // 重なりが同じなら、真ん中・線の上を選ぶ
    const hit = obs.reduce((n, o) => n + overlap(r, o), 0);
    const cost = hit + c.pen;
    if (cost < bestCost) {
      bestCost = cost;
      best = p;
    }
    if (hit === 0) break;
  }
  return best;
}

/** 拠点のまわりで、日数の札を置きたくない範囲(丸・名前・下の文字・待機中の隊の印) */
function nodeObstacles(ctx: CanvasRenderingContext2D, state: SimState, v: View, hl: Highlight): Rect[] {
  const out: Rect[] = [];
  const idle = new Map<string, number>();
  for (const c of state.convoys) if (!c.dropped && !c.move) idle.set(c.at, (idle.get(c.at) ?? 0) + 1);
  for (const n of state.scenario.map.nodes) {
    const p = toScreen(v, n);
    const R = NODE_R + 3;
    out.push({ x: p.x - R, y: p.y - R - (n.kind === 'depot' ? 9 : 0), w: R * 2, h: R * 2 + (n.kind === 'depot' ? 9 : 0) });
    ctx.font = `bold 15px ${SERIF}`;
    const nw = ctx.measureText(state.markets[n.id] ? `${n.name}・市` : n.name).width + 6;
    const ny = p.y - NODE_R - (n.kind === 'depot' ? 17 : 11);
    out.push({ x: p.x - nw / 2, y: ny - 9, w: nw, h: 18 });
    // 丸の下の1行(あと何日・撤退用)
    if (frontDaysLeft(state, n.id).days !== null || hl.stops.some((x) => x.id === n.id && x.required > 0)) {
      out.push({ x: p.x - 45, y: p.y + NODE_R + 3, w: 90, h: 16 });
    }
    for (let k = 0; k < (idle.get(n.id) ?? 0); k++) {
      const o = idleOffset(k);
      out.push({ x: p.x + o.x - 11, y: p.y + o.y - 11, w: 22, h: 22 });
    }
  }
  return out;
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
