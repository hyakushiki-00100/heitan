/**
 * 和紙の絵図風の背景(紙の質感・山・川・海・林・田・湿地・題箋・方位)。
 * 素材画像は使わず、すべてプログラムで描く(CLAUDE.md §1 初期費用0)。
 * 背景は動かないので、大きさとシナリオが変わったときだけ描き直し、画面外のキャンバスに取っておく
 */
import { Rng } from '@hyoro/core';
import { decorFor, type Corner, type MapDecor, type Pt } from './decor';

export const PAPER = {
  base: '#efe5cf',
  light: '#f6efdf',
  fiber: '120,92,58',
  ink: '43,38,32',
  mountain: '62,72,58',
  water: '96,128,138',
  tree: '66,92,58',
  field: '128,150,82',
  seal: '#a8382a',
};

interface Box {
  w: number;
  h: number;
  pad: number;
}

/** 地図の 0〜100 を画面の座標に(render.ts の toScreen と同じ式) */
const sp = (v: Box, x: number, y: number) => ({ x: v.pad + (x / 100) * (v.w - 2 * v.pad), y: v.pad + (y / 100) * (v.h - 2 * v.pad) });

/** 文字列から決まった数(乱数の種に使う) */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** 紙の質感(繊維・点・しみ)。広い面には周りを焼けたように暗くする */
export function paintPaper(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, vignette: boolean): void {
  const rng = new Rng(seed);
  const r = () => rng.next();
  ctx.fillStyle = PAPER.base;
  ctx.fillRect(0, 0, w, h);
  // ところどころ明るい・暗いむら
  const blots = Math.max(4, Math.round((w * h) / 60000));
  for (let i = 0; i < blots; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = (0.15 + r() * 0.3) * Math.max(w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const light = r() < 0.5;
    g.addColorStop(0, light ? 'rgba(255,250,236,0.35)' : `rgba(${PAPER.fiber},0.06)`);
    g.addColorStop(1, 'rgba(255,250,236,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // 繊維
  const fibers = Math.min(5000, Math.round((w * h) / 500));
  ctx.lineCap = 'round';
  for (let i = 0; i < fibers; i++) {
    const x = r() * w;
    const y = r() * h;
    const len = 3 + r() * 14;
    const ang = r() * Math.PI * 2;
    const bend = (r() - 0.5) * len * 0.6;
    ctx.strokeStyle = `rgba(${PAPER.fiber},${0.03 + r() * 0.08})`;
    ctx.lineWidth = 0.4 + r() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;
    ctx.quadraticCurveTo((x + ex) / 2 - Math.sin(ang) * bend, (y + ey) / 2 + Math.cos(ang) * bend, ex, ey);
    ctx.stroke();
  }
  // 細かい点
  const dots = Math.min(2500, Math.round((w * h) / 1400));
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = `rgba(${PAPER.fiber},${0.06 + r() * 0.14})`;
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 0.3 + r() * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  if (vignette) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    g.addColorStop(0, 'rgba(120,86,44,0)');
    g.addColorStop(1, 'rgba(120,86,44,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

/** 点の列をなめらかに結ぶ道筋(中点を通る2次曲線) */
function smoothPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], closed: boolean): void {
  ctx.beginPath();
  if (pts.length < 2) return;
  if (closed) {
    const last = pts[pts.length - 1]!;
    ctx.moveTo((last.x + pts[0]!.x) / 2, (last.y + pts[0]!.y) / 2);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    ctx.closePath();
    return;
  }
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  const end = pts[pts.length - 1]!;
  ctx.lineTo(end.x, end.y);
}

function drawSea(ctx: CanvasRenderingContext2D, v: Box, poly: Pt[], k: number): void {
  const pts = poly.map(([x, y]) => sp(v, x, y));
  ctx.save();
  smoothPath(ctx, pts, true);
  ctx.fillStyle = `rgba(${PAPER.water},0.2)`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${PAPER.ink},0.45)`;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.clip();
  // 波の模様(重ねた弧)
  const step = 16 * k;
  ctx.strokeStyle = `rgba(${PAPER.water},0.45)`;
  ctx.lineWidth = 0.9;
  for (let row = 0, y = 0; y < v.h + step; row++, y += step * 0.6) {
    for (let x = (row % 2) * step * 0.5; x < v.w + step; x += step) {
      ctx.beginPath();
      ctx.arc(x, y + step * 0.5, step * 0.42, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRiver(ctx: CanvasRenderingContext2D, v: Box, r: { width: number; points: Pt[] }, k: number): void {
  const pts = r.points.map(([x, y]) => sp(v, x, y));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  smoothPath(ctx, pts, false);
  ctx.strokeStyle = `rgba(${PAPER.water},0.32)`;
  ctx.lineWidth = r.width * k + 4;
  ctx.stroke();
  ctx.strokeStyle = `rgba(${PAPER.water},0.42)`;
  ctx.lineWidth = r.width * k;
  ctx.stroke();
  // 流れの筋
  ctx.setLineDash([10 * k, 14 * k]);
  ctx.strokeStyle = 'rgba(246,239,223,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** 墨で描いた山。後ろに小さな山を1つ重ねて、連なって見せる */
function drawMountain(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rng: Rng): void {
  const hump = (cx: number, h: number, wd: number, a: number) => {
    const peakX = cx + (rng.next() - 0.5) * wd * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx - wd / 2, y);
    ctx.quadraticCurveTo(cx - wd * 0.18, y - h * 0.85, peakX, y - h);
    ctx.quadraticCurveTo(cx + wd * 0.2, y - h * 0.8, cx + wd / 2, y);
    const g = ctx.createLinearGradient(0, y - h, 0, y);
    g.addColorStop(0, `rgba(${PAPER.mountain},${0.42 * a})`);
    g.addColorStop(1, `rgba(${PAPER.mountain},0)`);
    ctx.fillStyle = g;
    ctx.fill();
    // 稜線だけを墨で引く(麓は線を引かず、ぼかす)
    ctx.beginPath();
    ctx.moveTo(cx - wd / 2, y);
    ctx.quadraticCurveTo(cx - wd * 0.18, y - h * 0.85, peakX, y - h);
    ctx.quadraticCurveTo(cx + wd * 0.2, y - h * 0.8, cx + wd / 2, y);
    ctx.strokeStyle = `rgba(${PAPER.ink},${0.7 * a})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 山肌のしわ
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = `rgba(${PAPER.ink},${0.32 * a})`;
    for (let i = 0; i < 3; i++) {
      const t = 0.25 + i * 0.22;
      ctx.beginPath();
      ctx.moveTo(peakX + (rng.next() - 0.3) * wd * 0.08, y - h * (0.9 - t * 0.2));
      ctx.lineTo(peakX + (t - 0.1) * wd * 0.35, y - h * (0.55 - t * 0.5));
      ctx.stroke();
    }
  };
  const h = 30 * s;
  hump(x - h * 0.55, h * 0.7, h * 1.4, 0.55);
  hump(x, h, h * 1.7, 1);
}

function drawForest(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, k: number, rng: Rng): void {
  const trees: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * 14 * k;
    trees.push({ x: x + Math.cos(a) * d * 1.4, y: y + Math.sin(a) * d * 0.8 });
  }
  trees.sort((a, b) => a.y - b.y);
  for (const t of trees) {
    const r = (3.2 + rng.next() * 1.6) * k;
    ctx.strokeStyle = `rgba(${PAPER.ink},0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(t.x, t.y + r * 1.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${PAPER.tree},0.42)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${PAPER.ink},0.45)`;
    ctx.stroke();
  }
}

function drawField(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  const c = 9 * k;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.08);
  ctx.fillStyle = `rgba(${PAPER.field},0.18)`;
  ctx.strokeStyle = `rgba(${PAPER.field},0.55)`;
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillRect((i - 1.5) * c, (j - 1) * c * 0.75, c - 1.5, c * 0.75 - 1.5);
      ctx.strokeRect((i - 1.5) * c, (j - 1) * c * 0.75, c - 1.5, c * 0.75 - 1.5);
    }
  }
  ctx.restore();
}

function drawMarsh(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  ctx.strokeStyle = `rgba(${PAPER.water},0.6)`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 9 * k + i * 2 * k, y + i * 3.5 * k);
    ctx.lineTo(x + 9 * k - i * 2 * k, y + i * 3.5 * k);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(${PAPER.tree},0.75)`;
  for (const dx of [-5, 0, 5]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * k, y);
    ctx.lineTo(x + (dx - 1.5) * k, y - 7 * k);
    ctx.moveTo(x + dx * k, y);
    ctx.lineTo(x + (dx + 2) * k, y - 5 * k);
    ctx.stroke();
  }
}

function cornerAt(v: Box, c: Corner, bw: number, bh: number, m: number): { x: number; y: number } {
  return { x: c[1] === 'l' ? m : v.w - m - bw, y: c[0] === 't' ? m : v.h - m - bh };
}

/** 題箋(縦書きの題)と、その下の朱の印 */
function drawTitle(ctx: CanvasRenderingContext2D, v: Box, d: MapDecor, k: number): void {
  const fs = Math.round(Math.max(11, Math.min(16, 14 * k)));
  const bw = fs + 12;
  const bh = d.title.length * (fs + 2) + 14;
  const m = 14;
  const { x, y } = cornerAt(v, d.titleCorner, bw, bh + bw, m);
  ctx.fillStyle = 'rgba(250,245,232,0.92)';
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = `rgba(${PAPER.ink},0.75)`;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x, y, bw, bh);
  ctx.strokeRect(x + 3, y + 3, bw - 6, bh - 6);
  ctx.fillStyle = `rgb(${PAPER.ink})`;
  ctx.font = `bold ${fs}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [...d.title].forEach((ch, i) => ctx.fillText(ch, x + bw / 2, y + 7 + (fs + 2) * (i + 0.5)));
  // 朱の印(落款風)
  const s = bw - 6;
  const sx = x + 3;
  const sy = y + bh + 6;
  ctx.fillStyle = PAPER.seal;
  ctx.fillRect(sx, sy, s, s);
  ctx.fillStyle = PAPER.light;
  ctx.font = `bold ${Math.round(s * 0.4)}px serif`;
  ctx.fillText('兵', sx + s / 2, sy + s * 0.3);
  ctx.fillText('糧', sx + s / 2, sy + s * 0.72);
}

function drawCompass(ctx: CanvasRenderingContext2D, v: Box, c: Corner, k: number): void {
  const r = Math.max(11, Math.min(16, 14 * k));
  const m = 16;
  const { x, y } = cornerAt(v, c, r * 2, r * 2 + 12, m);
  const cx = x + r;
  const cy = y + 12 + r;
  ctx.strokeStyle = `rgba(${PAPER.ink},0.7)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.stroke();
  // 北を指す針
  ctx.fillStyle = PAPER.seal;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.25, cy);
  ctx.lineTo(cx - r * 0.25, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(${PAPER.ink},0.75)`;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.lineTo(cx + r * 0.25, cy);
  ctx.lineTo(cx - r * 0.25, cy);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 11px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgb(${PAPER.ink})`;
  ctx.fillText('北', cx, y + 5);
}

/** 絵図の枠(二重線) */
function drawFrame(ctx: CanvasRenderingContext2D, v: Box): void {
  ctx.strokeStyle = `rgba(${PAPER.ink},0.55)`;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(5, 5, v.w - 10, v.h - 10);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(9, 9, v.w - 18, v.h - 18);
}

/** 背景をすべて描く(ctx は CSS ピクセルで描ける状態にしておく) */
export function paintBackground(ctx: CanvasRenderingContext2D, v: Box, scenarioId: string): void {
  paintPaper(ctx, v.w, v.h, hash(scenarioId), true);
  const d = decorFor(scenarioId);
  if (d) {
    // 大きさの目安(狭い画面では飾りも小さく)
    const k = Math.max(0.6, Math.min(1.3, Math.min(v.w, v.h) / 520));
    const rng = new Rng(hash(scenarioId + ':decor'));
    if (d.sea) drawSea(ctx, v, d.sea, k);
    for (const r of d.rivers) drawRiver(ctx, v, r, k);
    for (const f of d.fields) {
      const p = sp(v, f[0], f[1]);
      drawField(ctx, p.x, p.y, k);
    }
    for (const m of d.marsh) {
      const p = sp(v, m[0], m[1]);
      drawMarsh(ctx, p.x, p.y, k);
    }
    for (const m of [...d.mountains].sort((a, b) => a[1] - b[1])) {
      const p = sp(v, m[0], m[1]);
      drawMountain(ctx, p.x, p.y, m[2] * k, rng);
    }
    for (const f of d.forests) {
      const p = sp(v, f[0], f[1]);
      drawForest(ctx, p.x, p.y, f[2], k, rng);
    }
    drawFrame(ctx, v);
    drawTitle(ctx, v, d, k);
    drawCompass(ctx, v, d.compassCorner, k);
  } else {
    drawFrame(ctx, v);
  }
}

let cache: { key: string; canvas: HTMLCanvasElement } | null = null;

/** 背景を描く。大きさ・画素の細かさ・シナリオが同じなら、取っておいた絵を貼るだけ */
export function drawBackground(ctx: CanvasRenderingContext2D, v: Box, scenarioId: string): void {
  const dpr = ctx.getTransform().a || 1;
  const key = `${scenarioId}|${v.w}|${v.h}|${v.pad}|${dpr}`;
  if (!cache || cache.key !== key) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.w * dpr));
    c.height = Math.max(1, Math.round(v.h * dpr));
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBackground(g, v, scenarioId);
    cache = { key, canvas: c };
  }
  ctx.drawImage(cache.canvas, 0, 0, v.w, v.h);
}

/** ページの地に敷く紙の模様(小さな絵を作って繰り返す)。CSS の background-image に使う */
export function paperTileUrl(): string {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return '';
  paintPaper(g, 256, 256, 7, false);
  return c.toDataURL('image/png');
}
