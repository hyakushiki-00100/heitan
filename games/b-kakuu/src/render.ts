import { armyPosition, convoyPosition, frontDaysLeft, type MapNode, type NodeKind, type SimState } from '@hyoro/core';
import { decorFor } from './decor';
import { drawNodeIcon, drawPackHorse, drawPorter, type NodeIcon } from './icons';
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

/** 絵の種類がデータに無いときの、拠点の種類ごとの絵 */
const KIND_ICON: Record<NodeKind, NodeIcon> = { depot: 'kura', village: 'mura', camp: 'kawara', pass: 'toge', front: 'jin' };
function iconOf(state: SimState, n: MapNode): NodeIcon {
  return decorFor(state.scenario.id)?.icons[n.id] ?? KIND_ICON[n.kind];
}
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

/** 拠点の絵の大きさ(1 で幅48)。低い地図では小さくする(setScale で決める) */
let K = 1.1;
/** 拠点の占める半径の目安(線の札・移動中の印をよける距離に使う) */
let NODE_R = 24;
function setScale(v: View): void {
  // 地図の大きさに合わせる(低い・狭い地図では小さく、PC の広い地図では大きく)
  K = Math.max(0.85, Math.min(1.8, v.h / 420, v.w / 600));
  NODE_R = 24 * K;
}

/** 拠点の絵のまわりの位置(中心 p からの距離) */
function geo(p: { x: number; y: number }) {
  const top = p.y - 24 * K;
  const ground = p.y + 12 * K;
  const plateY = ground + 9;
  return {
    top,
    ground,
    /** 名前 */
    nameY: top - 9,
    /** 米の量の札 */
    plateY,
    /** 札の下の1行(あと何日・撤退用) */
    belowY: plateY + 17,
    /** 待機中の隊(足元の位置) */
    idle: { x: p.x + 26 * K + 9 * K, y: ground + 2 },
    halfW: 25 * K,
  };
}

/** 画面座標にある拠点のID(絵・名前・米の札の範囲)。無ければ null。 */
export function hitNode(state: SimState, v: View, x: number, y: number): string | null {
  setScale(v);
  for (const n of state.scenario.map.nodes) {
    const p = toScreen(v, n);
    const g = geo(p);
    if (Math.abs(x - p.x) <= g.halfW + 4 && y >= g.top - 8 && y <= g.plateY + 10) return n.id;
  }
  return null;
}

/** 画面座標にある「拠点で待機中の隊」の絵の、拠点のID。無ければ null */
export function hitIdleGroup(state: SimState, v: View, x: number, y: number): string | null {
  setScale(v);
  for (const n of state.scenario.map.nodes) {
    if (!state.convoys.some((c) => !c.dropped && !c.move && c.at === n.id)) continue;
    const g = geo(toScreen(v, n));
    if (Math.abs(x - g.idle.x - 4) <= 18 * K && y >= g.idle.y - 34 * K - 12 && y <= g.idle.y + 6) return n.id;
  }
  return null;
}

export function daysLeftColor(d: number): string {
  if (d < 2) return C.bad;
  if (d < 5) return C.warn;
  return C.ok;
}

/** 移動中の印が拠点の丸や文字に重ならないよう、近すぎる場合は丸の外へ押し出す */
function avoidNodes(state: SimState, v: View, p: { x: number; y: number }, min = NODE_R + 16): { x: number; y: number } {
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
  // 撤退路(保持中は薄く示す。日数の札の下に敷く)
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

  // 拠点(絵と、米の量の札が1つ。物資・市の詳しい量は拠点を押すと出る)
  for (const n of sc.map.nodes) {
    const p = toScreen(v, n);
    const g = geo(p);
    const ring = (dash: boolean) => {
      ctx.strokeStyle = C.bad;
      ctx.lineWidth = dash ? 2 : 3;
      ctx.setLineDash(dash ? [4, 4] : []);
      ctx.beginPath();
      ctx.ellipse(p.x, (g.top + g.plateY) / 2, g.halfW + 8, (g.plateY - g.top) / 2 + 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // 行き先に選べる拠点は朱の点線、詳しく見ている拠点は朱の線で囲む
    if (hl.pickFrom && n.id !== hl.pickFrom) ring(true);
    if (n.id === hl.selectedNodeId) ring(false);
    drawNodeIcon(ctx, iconOf(state, n), p.x, p.y, K, !!state.markets[n.id]);
    const name = state.markets[n.id] ? `${n.name}・市` : n.name;
    inkText(ctx, name, p.x, g.nameY, C.ink, `bold ${K < 1 ? 14 : 15}px ${SERIF}`, 4);
    // 米の量の札(100以上は小数を出さない)
    const rice = state.rice[n.id] ?? 0;
    const label = `米${rice >= 100 ? Math.round(rice) : fmt(rice)}`;
    ctx.font = `bold 13px ${SERIF}`;
    const pw = ctx.measureText(label).width + 10;
    ctx.fillStyle = C.node;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(p.x - pw / 2, g.plateY - 8, pw, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.fillText(label, p.x, g.plateY + 0.5);
    // 札の下は1行だけ: 陣なら「あと何日」、撤退前なら撤退路の置き米
    const left = frontDaysLeft(state, n.id).days;
    const stop = hl.stops.find((x) => x.id === n.id && x.required > 0);
    if (left !== null) {
      inkText(ctx, `あと${left.toFixed(1)}日`, p.x, g.belowY, daysLeftColor(left), `bold 14px ${SERIF}`, 4);
    } else if (stop) {
      const ok = stop.have + 1e-9 >= stop.required;
      inkText(ctx, `撤退用 ${fmt(stop.have)}/${fmt(stop.required)}`, p.x, g.belowY, ok ? C.ok : C.bad, `bold 13px ${SERIF}`, 4);
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
  // 拠点で待機中の隊は、拠点ごとに1つの絵(人足を最大3人並べ、隊の数を添える)。
  // 移動中の隊は、同じ場所を一緒に進むものを1つの絵にまとめる
  for (const n of sc.map.nodes) {
    const cs = state.convoys.filter((c) => !c.dropped && !c.move && c.at === n.id);
    if (!cs.length) continue;
    const g = geo(toScreen(v, n));
    const sel = cs.some((c) => c.id === hl.selectedConvoyId);
    const label = cs.length === 1 ? String(state.convoys.indexOf(cs[0]!) + 1) : `${cs.length}隊`;
    drawConvoyGroup(ctx, g.idle, cs.map((c) => c.horses > 0), 1, label, sel, null);
  }
  const groups = new Map<string, { p: { x: number; y: number }; idx: number[] }>();
  state.convoys.forEach((c, i) => {
    if (c.dropped || !c.move) return;
    const p = avoidNodes(state, v, toScreen(v, convoyPosition(state, c, alpha)));
    const key = `${Math.round(p.x / 10)},${Math.round(p.y / 10)}`;
    const g = groups.get(key) ?? { p, idx: [] };
    g.idx.push(i);
    groups.set(key, g);
  });
  for (const g of groups.values()) {
    const cs = g.idx.map((i) => state.convoys[i]!);
    // 積荷の数字は、拠点の近く(中心から60px以内)では出さない(拠点の文字に重なるため。数字は札で見られる)
    const nearNode = sc.map.nodes.some((n) => {
      const q = toScreen(v, n);
      return Math.hypot(q.x - g.p.x, q.y - g.p.y) < 60;
    });
    const cargo = cs.reduce((t, c) => t + c.cargo, 0);
    const label = cs.length === 1 ? String(g.idx[0]! + 1) : `${cs.length}隊`;
    const sel = cs.some((c) => c.id === hl.selectedConvoyId);
    // 向き: 行き先が右なら右向き
    const to = byId.get(cs[0]!.move!.route[cs[0]!.move!.route.length - 1]!)!;
    const face = toScreen(v, to).x >= g.p.x ? 1 : -1;
    // 絵の足元は道の線より少し下(道の線が胴のあたりを通るように)
    drawConvoyGroup(ctx, { x: g.p.x, y: g.p.y + 10 }, cs.map((c) => c.horses > 0), face, label, sel, nearNode ? null : `米${fmt(cargo)}`);
  }
}

/**
 * 運搬隊の絵。horses は隊ごとに馬の隊かどうか。人足(または馬)を最大3つ少しずつずらして並べ、
 * 右上に隊番号か「5隊」の札を付ける。選んだ隊を含むなら、足元を朱の輪で囲む
 */
function drawConvoyGroup(
  ctx: CanvasRenderingContext2D,
  feet: { x: number; y: number },
  horses: boolean[],
  face: 1 | -1,
  label: string,
  selected: boolean,
  cargoText: string | null,
): void {
  const k = K * 0.85;
  const n = Math.min(3, horses.length);
  if (selected) {
    ctx.strokeStyle = C.bad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(feet.x + (n - 1) * 3, feet.y, 13 + (n - 1) * 4, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 奥(右上)から手前(左下)へ描く
  for (let i = n - 1; i >= 0; i--) {
    const x = feet.x + i * 7 * face;
    const y = feet.y - i * 2;
    if (horses[i]) drawPackHorse(ctx, x, y, k * 0.95, face);
    else drawPorter(ctx, x, y, k, face);
  }
  // 隊番号の札(頭の上)
  ctx.font = 'bold 12px sans-serif';
  const bw = Math.max(17, ctx.measureText(label).width + 8);
  const bx = feet.x + (n - 1) * 3.5 * face;
  const by = feet.y - (n - 1) * 2 - 28 * k - 10;
  ctx.fillStyle = selected ? C.bad : C.node;
  ctx.strokeStyle = selected ? C.bad : C.ink;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.roundRect(bx - bw / 2, by - 8.5, bw, 17, 8.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = selected ? '#fff' : C.ink;
  ctx.fillText(label, bx, by + 0.5);
  if (cargoText) {
    ctx.textAlign = face === 1 ? 'left' : 'right';
    inkText(ctx, cargoText, bx + (bw / 2 + 4) * face, by, C.ink, `bold 12px ${SERIF}`, 3.5);
    ctx.textAlign = 'center';
  }
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
    // 拠点の絵の左に置く(待機中の隊の絵は右に出る)
    p = { x: p.x - 25 * K - 6 - w / 2, y: p.y - 4 };
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

/** 拠点のまわりで、日数の札を置きたくない範囲(絵・名前・米の札・下の文字・待機中の隊の絵) */
function nodeObstacles(ctx: CanvasRenderingContext2D, state: SimState, v: View, hl: Highlight): Rect[] {
  const out: Rect[] = [];
  for (const n of state.scenario.map.nodes) {
    const p = toScreen(v, n);
    const g = geo(p);
    // 市の幟は絵の左に出るので、その分も含める
    const mk = state.markets[n.id] ? 9 * K : 0;
    out.push({ x: p.x - g.halfW - mk, y: g.top, w: g.halfW * 2 + mk, h: g.plateY + 8 - g.top });
    ctx.font = `bold 15px ${SERIF}`;
    const nw = ctx.measureText(state.markets[n.id] ? `${n.name}・市` : n.name).width + 6;
    out.push({ x: p.x - nw / 2, y: g.nameY - 9, w: nw, h: 18 });
    if (frontDaysLeft(state, n.id).days !== null || hl.stops.some((x) => x.id === n.id && x.required > 0)) {
      out.push({ x: p.x - 45, y: g.belowY - 8, w: 90, h: 16 });
    }
    if (state.convoys.some((c) => !c.dropped && !c.move && c.at === n.id)) {
      out.push({ x: g.idle.x - 10 * K, y: g.idle.y - 34 * K - 12, w: 36 * K, h: 34 * K + 14 });
    }
  }
  return out;
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
