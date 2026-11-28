/**
 * 遠征(作り直しの試作)の画面。説明は出さず、押せば分かることを目指す。
 * 大事な数字は「あと何日分」の1つ。選択肢のボタンには、結果の見込みを短く書く
 */
import {
  createExpedition,
  exCache,
  exCapacity,
  exChoose,
  exDaysLeft,
  exEatPerDay,
  exMove,
  exNext,
  exNodeTitle,
  exPlanPreview,
  exResult,
  exSendHome,
  exStart,
  type ExNodeType,
  type ExState,
} from '@hyoro/core';
import { drawNodeIcon, drawPorter, type NodeIcon } from '../icons';
import { paintPaper } from '../washi';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map');
const ctx = canvas.getContext('2d')!;

const ICON: Record<ExNodeType, NodeIcon> = {
  kura: 'kura',
  shiro: 'shiro',
  mura: 'mura',
  mori: 'mori',
  kawa: 'kawara',
  shuku: 'shuku',
  nobuse: 'toride',
  toge: 'toge',
  no: 'no',
};

/** URL の ?seed= があればその地図、なければ遊ぶたびに変える */
function pickSeed(): number {
  const q = Number(new URLSearchParams(location.search).get('seed'));
  return Number.isInteger(q) && q > 0 ? q : 1 + Math.floor(Math.random() * 99999);
}

let seed = pickSeed();
let s: ExState = createExpedition(seed);
let plannedPorters = 6;
let toast = '';
let logSeen = 0;

function newGame(sameMap: boolean): void {
  if (!sameMap) seed = 1 + Math.floor(Math.random() * 99999);
  s = createExpedition(seed);
  toast = '';
  logSeen = 0;
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  history.replaceState(null, '', url);
  render();
}

// ---- 地図 ----
interface Box {
  w: number;
  h: number;
}
let paper: { key: string; c: HTMLCanvasElement } | null = null;

function size(): Box {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function resize(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function pos(b: Box, id: number): { x: number; y: number } {
  const n = s.map.nodes[id]!;
  const px = Math.max(34, b.w * 0.07);
  const py = Math.max(30, b.h * 0.12);
  return { x: px + (n.col / (s.map.cols - 1)) * (b.w - 2 * px), y: py + n.y * (b.h - 2 * py) };
}

function iconScale(b: Box): number {
  return Math.max(0.6, Math.min(1.4, b.h / 360, b.w / 640));
}

function draw(): void {
  const b = size();
  if (b.w < 2 || b.h < 2) return;
  const dpr = ctx.getTransform().a || 1;
  const key = `${b.w}|${b.h}|${dpr}`;
  if (!paper || paper.key !== key) {
    const c = document.createElement('canvas');
    c.width = Math.round(b.w * dpr);
    c.height = Math.round(b.h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintPaper(g, b.w, b.h, 11, true);
    paper = { key, c };
  }
  ctx.drawImage(paper.c, 0, 0, b.w, b.h);
  const k = iconScale(b);
  const next = new Set(exNext(s));
  const onPath = new Set<string>();
  for (let i = 0; i + 1 < s.path.length; i++) onPath.add(`${s.path[i]}>${s.path[i + 1]}`);
  // 道
  ctx.lineCap = 'round';
  for (const [a, c] of s.map.edges) {
    const p = pos(b, a);
    const q = pos(b, c);
    const walked = onPath.has(`${a}>${c}`);
    const canGo = s.phase === 'out' && a === s.at && next.has(c);
    ctx.strokeStyle = walked ? '#2b2620' : canGo ? '#a3322a' : 'rgba(180,88,60,0.45)';
    ctx.lineWidth = walked ? 4 : canGo ? 3 : 2;
    ctx.setLineDash(walked || canGo ? [] : [6, 5]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 拠点
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of s.map.nodes) {
    const p = pos(b, n.id);
    if (next.has(n.id)) {
      ctx.strokeStyle = '#a3322a';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 5 * k, 30 * k, 26 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const seen = n.col <= s.map.nodes[s.at]!.col + 1 || s.phase !== 'out';
    ctx.globalAlpha = seen ? 1 : 0.55;
    drawNodeIcon(ctx, ICON[n.type], p.x, p.y, k, false);
    ctx.globalAlpha = 1;
    label(exNodeTitle(n.type), p.x, p.y + 20 * k, '#2b2620', `bold ${Math.round(12 + k * 2)}px serif`);
    const c = s.cache[n.id] ?? 0;
    if (c > 0) badge(`置${c}`, p.x + 22 * k, p.y - 22 * k, '#2f5f2d');
  }
  // 軍勢(今いる拠点の左下に足軽)
  const p = pos(b, s.at);
  drawPorter(ctx, p.x - 36 * k, p.y + 12 * k, k * 0.95, 1);
  drawPorter(ctx, p.x - 28 * k, p.y + 10 * k, k * 0.95, 1);
}

function label(t: string, x: number, y: number, color: string, font: string): void {
  ctx.font = font;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(247,241,227,0.95)';
  ctx.lineWidth = 4;
  ctx.strokeText(t, x, y);
  ctx.fillStyle = color;
  ctx.fillText(t, x, y);
}

function badge(t: string, x: number, y: number, color: string): void {
  ctx.font = 'bold 12px sans-serif';
  const w = ctx.measureText(t).width + 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 9, w, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(t, x, y + 0.5);
}

/** 地図を押したら、その拠点へ進む */
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const b = size();
  const k = iconScale(b);
  for (const id of exNext(s)) {
    const p = pos(b, id);
    if (Math.hypot(e.clientX - r.left - p.x, e.clientY - r.top - p.y) < 34 * k) {
      move(id);
      return;
    }
  }
});

// ---- 操作 ----
function move(id: number): void {
  exMove(s, id);
  render();
}

function choose(id: string): void {
  exChoose(s, id);
  render();
}

// ---- 上の帯・右の札 ----
function daysColor(d: number): string {
  return d < 2 ? '#a3322a' : d < 4 ? '#9a6512' : '#2f5f2d';
}

function render(): void {
  // 新しい出来事の記録だけを、短く出す
  if (s.log.length > logSeen) {
    toast = s.log.slice(logSeen).join(' / ');
    logSeen = s.log.length;
  }
  const plan = s.phase === 'plan';
  const food = plan ? exPlanPreview(s, plannedPorters).food : s.food;
  const cap = plan ? food : exCapacity(s);
  const eat = plan ? exPlanPreview(s, plannedPorters).eat : exEatPerDay(s);
  const days = eat > 0 ? food / eat : Infinity;
  $('hud-days').innerHTML = `あと<b style="color:${daysColor(days)}">${Number.isFinite(days) ? days.toFixed(1) : '-'}</b>日分`;
  $('hud-food-text').textContent = `米 ${food}/${cap} ・ 1日 −${eat}`;
  $('hud-food-bar').style.width = `${cap > 0 ? Math.round((100 * food) / cap) : 0}%`;
  $('hud-food-bar').style.background = daysColor(days);
  $('hud-units').textContent = plan ? `兵${s.troops} 荷駄${plannedPorters}` : `兵${s.troops} 荷駄${s.porters}`;
  $('hud-phase').textContent = { plan: '軍議', out: `行き ${s.day}日目`, siege: `城攻め ${s.day}日目`, back: `帰り ${s.day}日目`, done: '終わり' }[s.phase];
  $('toast').textContent = toast;
  $('toast').hidden = !toast;
  $('panel').innerHTML = panelHtml();
  bind();
  draw();
}

const btn = (id: string, label: string, effect = '', cls = '', disabled = false) =>
  `<button type="button" class="choice ${cls}" data-act="${id}" ${disabled ? 'disabled' : ''}><span class="lb">${label}</span>${effect ? `<span class="ef">${effect}</span>` : ''}</button>`;

function panelHtml(): string {
  if (s.phase === 'plan') {
    const p = exPlanPreview(s, plannedPorters);
    return (
      '<p class="title">荷駄をいくつ連れていく?</p>' +
      `<div class="stepper">${btn('p-', '−', '', 'small', plannedPorters <= s.rules.minPorters)}<b>${plannedPorters}</b>${btn('p+', '+', '', 'small', plannedPorters >= s.rules.maxPorters)}</div>` +
      `<p class="note">多いほど米を運べるが、荷駄も食べる(米${p.food}・1日−${p.eat}・${p.days.toFixed(1)}日分)</p>` +
      btn('start', '出陣', '', 'primary')
    );
  }
  if (s.phase === 'done') {
    const r = exResult(s);
    const stars = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
    return (
      `<p class="stars">${stars}</p>` +
      `<ul class="res"><li>${r.taken ? '落城 +' + s.rules.scoreTaken : '落城せず'}</li>` +
      `<li>帰還 ${r.home}/${r.total}隊 +${r.home * s.rules.scorePerSquad}</li>` +
      (r.burden ? `<li>村の負担 −${r.burden}</li>` : '') +
      (r.waste ? `<li>置き残し −${r.waste}</li>` : '') +
      `<li><b>${r.score}</b> / ${r.maxScore}</li></ul>` +
      btn('again', 'もう一度', '同じ地図', 'primary') +
      btn('new', '別の地図')
    );
  }
  if (s.pending) {
    const ev = s.pending;
    return `<p class="title">${ev.title}</p>` + ev.choices.map((c) => btn('c:' + c.id, c.label, c.effect, '', !!c.disabled)).join('');
  }
  const parts: string[] = [];
  const nx = exNext(s);
  if (s.phase === 'out') {
    parts.push('<p class="title">どこへ進む?</p>');
    for (const id of nx) {
      const n = s.map.nodes[id]!;
      // 同じ名前の行き先が並ぶことがあるので、地図の上・中・下を添える
      const where = nx.length > 1 ? (n.y < 0.4 ? '上の道・' : n.y > 0.6 ? '下の道・' : '中の道・') : '';
      parts.push(btn('go:' + id, `→ ${exNodeTitle(n.type)}`, `${where}${n.type === 'toge' ? '2日' : '1日'}`));
    }
    if (s.at !== 0) {
      const amt = Math.min(10, s.food);
      parts.push(
        '<div class="row">' +
          btn('cache', `米を置く ${amt}`, '帰りに拾う', 'small', amt <= 0) +
          btn('home', '荷駄を帰す', `1日−${s.rules.porterEat}・運べる−${s.rules.carry}`, 'small', s.porters <= 0) +
          '</div>',
      );
    }
  } else if (s.phase === 'back') {
    for (const id of nx) parts.push(btn('go:' + id, `→ ${exNodeTitle(s.map.nodes[id]!.type)}`, (s.cache[id] ?? 0) > 0 ? `置き米${s.cache[id]}` : '', 'primary'));
    parts.push('<div class="row">' + btn('home', '荷駄を帰す', `1日−${s.rules.porterEat}`, 'small', s.porters <= 0) + '</div>');
  }
  return parts.join('');
}

function bind(): void {
  document.querySelectorAll<HTMLButtonElement>('#panel [data-act]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.act!;
      if (a === 'p-') plannedPorters = Math.max(s.rules.minPorters, plannedPorters - 1);
      else if (a === 'p+') plannedPorters = Math.min(s.rules.maxPorters, plannedPorters + 1);
      else if (a === 'start') exStart(s, plannedPorters);
      else if (a === 'again') return newGame(true);
      else if (a === 'new') return newGame(false);
      else if (a === 'cache') exCache(s, 10);
      else if (a === 'home') exSendHome(s);
      else if (a.startsWith('go:')) return move(Number(a.slice(3)));
      else if (a.startsWith('c:')) return choose(a.slice(2));
      render();
    };
  });
}

new ResizeObserver(() => resize()).observe($('map-wrap'));
newGame(true);
