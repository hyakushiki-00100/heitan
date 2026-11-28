/**
 * 拠点と運搬隊の絵(素材画像は使わず、すべてプログラムで描く。CLAUDE.md §1 初期費用0)。
 * 拠点の絵は、中心 (x, y) のまわり 幅48×高さ36(k=1 のとき)に収める。地面は y+12、屋根の上は y-24
 */

export type NodeIcon = 'kura' | 'mura' | 'shuku' | 'kawara' | 'ura' | 'toge' | 'seki' | 'toride' | 'jin' | 'shiro' | 'mori' | 'no';
export const NODE_ICONS: NodeIcon[] = ['kura', 'mura', 'shuku', 'kawara', 'ura', 'toge', 'seki', 'toride', 'jin', 'shiro', 'mori', 'no'];

const P = {
  ink: '#2b2620',
  wall: '#f7f1e3',
  roof: '#3d3732',
  tile: '#56504a',
  wood: '#8a5a34',
  woodDark: '#5e3c22',
  thatch: '#b9924f',
  thatchDark: '#8c6a33',
  red: '#a3322a',
  water: '#6f97a3',
  green: '#5d7a4a',
  skin: '#e6c39a',
  cloth: '#34405a',
  bale: '#cfae6c',
  horse: '#8b5e3c',
  shadow: 'rgba(43,38,32,0.18)',
};

type Ctx = CanvasRenderingContext2D;

function poly(ctx: Ctx, pts: number[], fill: string | null, stroke: string | null = P.ink, lw = 1.2): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string | null, stroke: string | null = P.ink, lw = 1.2): void {
  poly(ctx, [x, y, x + w, y, x + w, y + h, x, y + h], fill, stroke, lw);
}

function line(ctx: Ctx, pts: number[], color = P.ink, lw = 1.2): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function ground(ctx: Ctx, w: number, y = 12): void {
  ctx.beginPath();
  ctx.ellipse(0, y, w, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.shadow;
  ctx.fill();
}

/** 瓦屋根(台形)。棟の両端を少し反らせる */
function tileRoof(ctx: Ctx, x0: number, x1: number, yEave: number, yRidge: number, inset: number): void {
  poly(ctx, [x0, yEave, x1, yEave, x1 - inset, yRidge, x0 + inset, yRidge], P.roof);
  line(ctx, [x0 + inset - 2, yRidge - 1.2, x1 - inset + 2, yRidge - 1.2], P.ink, 2.2);
  // 瓦の筋
  for (let x = x0 + 4; x < x1 - 2; x += 4) line(ctx, [x, yEave - 0.5, x + ((x0 + x1) / 2 - x) * 0.12, yRidge + 1], P.tile, 0.8);
}

/** 茅葺きの屋根(寄棟) */
function thatchRoof(ctx: Ctx, x0: number, x1: number, yEave: number, yTop: number): void {
  const mid = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  poly(ctx, [x0, yEave, x1, yEave, mid + half * 0.35, yTop, mid - half * 0.35, yTop], P.thatch);
  for (let i = 1; i < 5; i++) {
    const y = yTop + ((yEave - yTop) * i) / 5;
    const t = i / 5;
    line(ctx, [mid - half * (0.35 + 0.65 * t) + 1, y, mid + half * (0.35 + 0.65 * t) - 1, y], P.thatchDark, 0.7);
  }
  line(ctx, [mid - half * 0.35, yTop, mid + half * 0.35, yTop], P.thatchDark, 2);
}

function house(ctx: Ctx, cx: number, groundY: number, w: number, h: number): void {
  rect(ctx, cx - w / 2, groundY - h, w, h, P.wall);
  rect(ctx, cx - 2, groundY - h * 0.7, 4, h * 0.7, P.woodDark, P.ink, 0.8);
  thatchRoof(ctx, cx - w / 2 - 3, cx + w / 2 + 3, groundY - h + 1, groundY - h - w * 0.55);
}

function pine(ctx: Ctx, x: number, y: number, s: number): void {
  line(ctx, [x, y, x, y - 9 * s], P.woodDark, 1.4);
  for (const [dy, w] of [
    [-9, 6],
    [-6, 8],
    [-3, 9],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(x, y + dy * s, w * s * 0.6, 2.2 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = P.green;
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
}

function waves(ctx: Ctx, x0: number, x1: number, y: number): void {
  ctx.strokeStyle = P.water;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let x = x0; x < x1; x += 6) {
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 1.5, y - 2.5, x + 3, y);
    ctx.quadraticCurveTo(x + 4.5, y + 2.5, x + 6, y);
  }
  ctx.stroke();
}

/** 幟(のぼり)。color の旗に、字があれば書く */
function nobori(ctx: Ctx, x: number, yBase: number, h: number, color: string, ch?: string): void {
  line(ctx, [x, yBase, x, yBase - h], P.woodDark, 1.3);
  line(ctx, [x, yBase - h + 1, x + 7, yBase - h + 1], P.woodDark, 1);
  rect(ctx, x + 0.5, yBase - h + 1.5, 6.5, h * 0.62, color, P.ink, 0.8);
  if (ch) {
    ctx.fillStyle = color === P.wall ? P.ink : P.wall;
    ctx.font = 'bold 6.5px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x + 3.75, yBase - h + 1.5 + h * 0.31);
  }
}

const DRAW: Record<NodeIcon, (ctx: Ctx) => void> = {
  // 蔵: 白壁・瓦屋根・海鼠壁の腰・戸前
  kura: (ctx) => {
    ground(ctx, 22);
    rect(ctx, -15, 2, 30, 10, P.roof);
    for (let x = -13; x < 14; x += 5) line(ctx, [x, 3, x + 4, 11], P.wall, 0.9);
    for (let x = -13; x < 14; x += 5) line(ctx, [x + 4, 3, x, 11], P.wall, 0.9);
    rect(ctx, -15, -12, 30, 14, P.wall);
    rect(ctx, -9, -8, 4, 4, P.roof, P.ink, 0.8);
    rect(ctx, -4, -6, 9, 18, P.woodDark);
    line(ctx, [0.5, -6, 0.5, 12], P.ink, 0.8);
    tileRoof(ctx, -20, 20, -12, -22, 6);
  },
  // 村: 茅葺きの家が2軒と木
  mura: (ctx) => {
    ground(ctx, 23);
    pine(ctx, 15, 6, 1.1);
    house(ctx, 7, 9, 14, 8);
    house(ctx, -7, 12, 20, 11);
  },
  // 宿場: 2階建ての旅籠と提灯、隣に茅葺き
  shuku: (ctx) => {
    ground(ctx, 23);
    house(ctx, 13, 12, 12, 9);
    rect(ctx, -18, -2, 24, 14, P.wall);
    for (let x = -15; x < 6; x += 4) line(ctx, [x, 2, x, 12], P.wood, 0.9);
    tileRoof(ctx, -21, 9, -1, -6, 2);
    rect(ctx, -16, -14, 20, 9, P.wall);
    for (let x = -14; x < 4; x += 3) line(ctx, [x, -12, x, -7], P.wood, 0.8);
    tileRoof(ctx, -19, 7, -14, -21, 4);
    // 提灯
    line(ctx, [7, -3, 7, 0], P.ink, 0.8);
    ctx.beginPath();
    ctx.ellipse(7, 3, 2.4, 3.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = P.red;
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  },
  // 河原: 川岸の陣小屋(幕舎)と石
  kawara: (ctx) => {
    ground(ctx, 22);
    waves(ctx, -20, 20, 12);
    for (const [x, y, r] of [
      [-16, 7, 2.5],
      [15, 8, 2],
      [11, 6, 1.6],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#b8ad9a';
      ctx.fill();
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    poly(ctx, [-14, 7, 2, 7, -6, -12], P.wall);
    line(ctx, [-6, -12, -6, 7], P.ink, 0.9);
    poly(ctx, [-1, 7, 14, 7, 6.5, -8], '#e9dfcb');
    line(ctx, [6.5, -8, 6.5, 7], P.ink, 0.9);
    line(ctx, [-6, -12, -6, -16], P.woodDark, 1.2);
  },
  // 浦: 舟と漁師小屋、波
  ura: (ctx) => {
    ground(ctx, 22);
    house(ctx, -9, 6, 14, 8);
    waves(ctx, -20, 20, 11);
    // 舟
    ctx.beginPath();
    ctx.moveTo(1, 6);
    ctx.lineTo(19, 6);
    ctx.quadraticCurveTo(17, 11, 10, 11);
    ctx.lineTo(4, 11);
    ctx.quadraticCurveTo(1, 9, 1, 6);
    ctx.closePath();
    ctx.fillStyle = P.wood;
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    line(ctx, [11, 6, 11, -14], P.woodDark, 1.3);
    poly(ctx, [11.5, -13, 18, -11, 18, 2, 11.5, 2], P.wall, P.ink, 0.8);
  },
  // 峠: 山の背に茶屋と松
  toge: (ctx) => {
    ground(ctx, 22);
    ctx.beginPath();
    ctx.moveTo(-22, 12);
    ctx.quadraticCurveTo(-8, -20, 2, -20);
    ctx.quadraticCurveTo(12, -20, 22, 12);
    ctx.closePath();
    ctx.fillStyle = '#c8c0a8';
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 九十九折りの道
    line(ctx, [-4, 12, 6, 6, -4, 0, 4, -6], P.red, 1.1);
    pine(ctx, -12, 6, 0.9);
    house(ctx, 10, 2, 10, 6);
  },
  // 関所: 冠木門と柵
  seki: (ctx) => {
    ground(ctx, 23);
    for (const x of [-20, -16, -12, 12, 16, 20]) line(ctx, [x, 12, x, -1], P.wood, 1.6);
    line(ctx, [-21, 2, -9, 2], P.woodDark, 1.4);
    line(ctx, [9, 2, 21, 2], P.woodDark, 1.4);
    line(ctx, [-21, 8, -9, 8], P.woodDark, 1.4);
    line(ctx, [9, 8, 21, 8], P.woodDark, 1.4);
    rect(ctx, -9, -10, 3, 22, P.woodDark);
    rect(ctx, 6, -10, 3, 22, P.woodDark);
    rect(ctx, -12, -11, 24, 3, P.wood);
    tileRoof(ctx, -13, 13, -12, -19, 3);
  },
  // 砦: 尖った丸太の柵と物見櫓
  toride: (ctx) => {
    ground(ctx, 23);
    // 櫓
    line(ctx, [-2, 6, 1, -12], P.woodDark, 1.4);
    line(ctx, [12, 6, 9, -12], P.woodDark, 1.4);
    line(ctx, [-1, 0, 11, -6], P.woodDark, 0.9);
    line(ctx, [11, 0, -1, -6], P.woodDark, 0.9);
    rect(ctx, -2, -16, 14, 4, P.wood);
    poly(ctx, [-4, -16, 14, -16, 10, -22, 0, -22], P.roof);
    // 柵
    for (let x = -21; x <= 21; x += 4) poly(ctx, [x - 1.6, 12, x + 1.6, 12, x + 1.6, 0, x, -3, x - 1.6, 0], P.wood, P.ink, 0.8);
    line(ctx, [-22, 5, 22, 5], P.woodDark, 1.2);
  },
  // 陣: 陣幕(白地に黒の段と紋)と幟
  jin: (ctx) => {
    ground(ctx, 24);
    nobori(ctx, -15, 4, 26, P.red);
    nobori(ctx, 12, 4, 28, P.wall);
    nobori(ctx, -2, 2, 30, P.red);
    rect(ctx, -22, -4, 44, 16, P.wall);
    rect(ctx, -22, -1, 44, 3, P.ink, null);
    rect(ctx, -22, 6, 44, 3, P.ink, null);
    // 紋(丸に一文字)
    ctx.beginPath();
    ctx.arc(0, 4, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = P.wall;
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    line(ctx, [-3, 4, 3, 4], P.ink, 1.8);
    // 幕を張る杭
    for (const x of [-22, -11, 11, 22]) line(ctx, [x, -6, x, 13], P.woodDark, 1.2);
  },
  // 城: 石垣の上に白壁の天守(2重の屋根)
  shiro: (ctx) => {
    ground(ctx, 24);
    poly(ctx, [-20, 12, 20, 12, 15, -1, -15, -1], '#a9a196');
    for (const [x0, y0] of [
      [-16, 9],
      [-6, 9],
      [4, 9],
      [-11, 4],
      [-1, 4],
      [9, 4],
    ] as const)
      line(ctx, [x0, y0, x0 + 8, y0], P.ink, 0.6);
    rect(ctx, -11, -9, 22, 8, P.wall);
    rect(ctx, -3, -7, 6, 6, P.roof, P.ink, 0.8);
    tileRoof(ctx, -15, 15, -9, -14, 3);
    rect(ctx, -7, -20, 14, 6, P.wall);
    tileRoof(ctx, -10, 10, -20, -25, 3);
    // 鯱
    line(ctx, [-6, -26, -7, -29], P.ink, 1.4);
    line(ctx, [6, -26, 7, -29], P.ink, 1.4);
  },
  // 森: 松が4本
  mori: (ctx) => {
    ground(ctx, 22);
    pine(ctx, -12, 10, 1.2);
    pine(ctx, 10, 10, 1.3);
    pine(ctx, -1, 4, 1.5);
    pine(ctx, 18, 12, 0.9);
  },
  // 野: 草むらと小さな田
  no: (ctx) => {
    ground(ctx, 20);
    for (let i = 0; i < 3; i++) rect(ctx, -16 + i * 9, 4, 8, 6, 'rgba(128,150,82,0.35)', 'rgba(93,122,74,0.9)', 0.8);
    for (const x of [-14, 12, 18]) {
      line(ctx, [x, 0, x - 2, -6], P.green, 1.2);
      line(ctx, [x, 0, x + 1, -7], P.green, 1.2);
      line(ctx, [x, 0, x + 3, -5], P.green, 1.2);
    }
  },
};

/** 拠点の絵。(x, y) は拠点の中心、k は大きさ(1 で幅48)。market なら「市」の幟を添える */
export function drawNodeIcon(ctx: Ctx, icon: NodeIcon, x: number, y: number, k: number, market: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  DRAW[icon](ctx);
  if (market) nobori(ctx, -25, 12, 22, P.wall, '市');
  ctx.restore();
}

/**
 * 運搬隊の人足(陣笠をかぶり、米俵を背負った足軽)。(x, y) は足元、k は大きさ(1 で高さ約26)。
 * face は向き(1=右、-1=左)
 */
export function drawPorter(ctx: Ctx, x: number, y: number, k: number, face: 1 | -1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k * face, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 2.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.shadow;
  ctx.fill();
  // 脚(歩く形)
  line(ctx, [0, -9, -3.5, 0], P.ink, 2.2);
  line(ctx, [0, -9, 3.5, -0.5], P.ink, 2.2);
  // 背の俵(後ろ側=左)
  ctx.beginPath();
  ctx.roundRect(-10, -21, 8, 11, 3);
  ctx.fillStyle = P.bale;
  ctx.fill();
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  line(ctx, [-10, -17.5, -2, -17.5], P.thatchDark, 0.8);
  line(ctx, [-10, -13.5, -2, -13.5], P.thatchDark, 0.8);
  // 胴
  poly(ctx, [-3.5, -18, 3.5, -18, 3, -9, -3, -9], P.cloth, P.ink, 1);
  line(ctx, [-3.2, -11.5, 3.2, -11.5], P.red, 1.2);
  // 腕(俵の縄を握る)
  line(ctx, [2.5, -16.5, 1, -13, -2.5, -15], P.ink, 1.6);
  // 頭と陣笠
  ctx.beginPath();
  ctx.arc(0.5, -20.5, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = P.skin;
  ctx.fill();
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  poly(ctx, [-6, -21.5, 7, -21.5, 0.5, -27], P.roof, P.ink, 0.9);
  ctx.beginPath();
  ctx.arc(0.5, -23.5, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = P.red;
  ctx.fill();
  ctx.restore();
}

/** 荷を積んだ馬(馬の隊)。(x, y) は足元、face は向き */
export function drawPackHorse(ctx: Ctx, x: number, y: number, k: number, face: 1 | -1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k * face, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 2.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.shadow;
  ctx.fill();
  for (const lx of [-7, -4, 5, 8]) line(ctx, [lx, -9, lx + (lx % 2 ? 1 : -1), 0], P.woodDark, 1.8);
  // 胴・首・頭
  ctx.beginPath();
  ctx.ellipse(0, -11, 10, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = P.horse;
  ctx.fill();
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  poly(ctx, [7, -13, 10, -21, 15, -20, 15.5, -17.5, 11, -16, 10, -10], P.horse, P.ink, 1);
  line(ctx, [-10, -12, -13, -6], P.ink, 1.4);
  // 荷(俵2つ)
  ctx.beginPath();
  ctx.roundRect(-8, -21, 7, 9, 2.5);
  ctx.roundRect(-1, -21, 7, 9, 2.5);
  ctx.fillStyle = P.bale;
  ctx.fill();
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
}
