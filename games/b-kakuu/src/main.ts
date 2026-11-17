import {
  createState,
  currentDay,
  daysLeft,
  dailyConsumption,
  dispatch,
  eatenOver,
  maxLoad,
  shortestRoute,
  step,
  type Scenario,
  type SimState,
} from '@hyoro/core';
import scenarioJson from '../data/scenario-01.json';
import { daysLeftColor, draw, fmt, hitNode, type View } from './render';

const scenario = scenarioJson as unknown as Scenario;
/** 1刻み(半日)を何ミリ秒で進めるか(×1のとき) */
const STEP_MS = 1200;
const SPEEDS = [1, 2, 4];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map');
const ctx = canvas.getContext('2d')!;

let state: SimState;
let running = false;
let speedIdx = 0;
let acc = 0;
let last = performance.now();
let selected: string | null = null;
let dest: string | null = null;
let load = 0;
let dispatchedOnce = false;
/** 指図パネルを作り直す必要があるかの判定用。同じなら作り直さない(スライダー操作を妨げないため) */
let orderKey = '';

function reset(): void {
  state = createState(structuredClone(scenario));
  running = false;
  acc = 0;
  selected = null;
  dest = null;
  dispatchedOnce = false;
  $('result').hidden = true;
  renderPanel();
}

function view(): View {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height, pad: Math.max(48, Math.min(r.width, r.height) * 0.1) };
}

function resize(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function nodeName(id: string): string {
  return state.scenario.map.nodes.find((n) => n.id === id)?.name ?? id;
}

function selectedConvoy() {
  return state.convoys.find((c) => c.id === selected) ?? null;
}

function currentRoute() {
  const c = selectedConvoy();
  if (!c || c.move || !dest) return null;
  return shortestRoute(state.scenario.map, c.at, dest);
}

function setDest(id: string): void {
  const c = selectedConvoy();
  if (!c || c.move || id === c.at) return;
  dest = id;
  load = Math.min(maxLoad(c, state.scenario.carrierCapacity), state.rice[c.at] ?? 0);
  renderPanel();
  // スマホでは出発ボタンが画面外に出やすいので、見える位置までスクロールする
  document.getElementById('btn-go')?.scrollIntoView({ block: 'nearest' });
}

// ---- 進行 ----
function tick(now: number): void {
  const dt = Math.min(now - last, 250);
  last = now;
  const interval = STEP_MS / SPEEDS[speedIdx]!;
  if (running && state.outcome === 'playing') {
    acc += dt;
    while (acc >= interval && running) {
      acc -= interval;
      const movingBefore = new Set(state.convoys.filter((c) => c.move).map((c) => c.id));
      step(state);
      const arrived = state.convoys.some((c) => movingBefore.has(c.id) && !c.move);
      if (arrived && $<HTMLInputElement>('chk-autopause').checked) {
        running = false;
        acc = 0;
      }
      if (state.outcome !== 'playing') running = false;
      renderPanel();
    }
  }
  const alpha = running ? Math.min(1, acc / interval) : 0;
  const r = currentRoute();
  draw(ctx, state, view(), alpha, { selectedConvoyId: selected, routeNodes: r?.nodes ?? null });
  requestAnimationFrame(tick);
}

// ---- パネル ----
function renderPanel(): void {
  const sc = state.scenario;
  const day = currentDay(state);
  const front = sc.frontId;
  const left = daysLeft(state.rice[front] ?? 0, dailyConsumption(sc, front));
  $('clock').innerHTML =
    `第 <b>${fmt(day)}</b> 日 / 目標 ${sc.goalDays}日 ・ ${nodeName(front)} ` +
    `<b style="color:${daysLeftColor(left ?? 99)}">あと${(left ?? 0).toFixed(1)}日</b>`;
  $('btn-play').textContent = running ? '❚❚ 止める' : '▶ 進める';
  ($('btn-play') as HTMLButtonElement).disabled = state.outcome !== 'playing';
  $('btn-speed').textContent = `×${SPEEDS[speedIdx]}`;

  $('hint').innerHTML = !dispatchedOnce
    ? '運搬隊を選び、行き先に<b>前線の陣</b>を選んで出発させてください。<br>人足も道中で米を食べます。<b>遠いほど、届く量が減ります。</b>'
    : !running && state.convoys.some((c) => c.move)
      ? '▶ で時を進めます。'
      : '陣に着いた隊は、帰り道の分の米を持たせないと戻れません。';

  const box = $('convoys');
  box.innerHTML = '';
  state.convoys.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'convoy' + (c.id === selected ? ' selected' : '');
    const where = c.move ? `${nodeName(c.move.route[c.move.route.length - 1]!)}へ移動中・米${fmt(c.cargo)}` : `${nodeName(c.at)}で待機`;
    b.innerHTML = `<span>${i + 1}. ${c.name}(人足${c.carriers})</span><span class="st">${where}</span>`;
    b.onclick = () => {
      selected = c.id === selected ? null : c.id;
      dest = null;
      renderPanel();
    };
    box.appendChild(b);
  });

  if (currentOrderKey() !== orderKey) renderOrder();

  const log = $('log');
  log.innerHTML = '';
  for (const e of [...state.log].reverse().slice(0, 30)) {
    const li = document.createElement('li');
    li.textContent = `${fmt(e.step * sc.stepDays)}日 ${e.text}`;
    log.appendChild(li);
  }

  if (state.outcome !== 'playing') showResult();
}

function previewHtml(carriers: number, via: string, days: number, eat: number): string {
  const sc = state.scenario;
  const arrive = load - eat;
  return (
    `道: ${via}(${days}日)<br>` +
    `人足${carriers}人 × ${sc.carrierRation} × ${days}日 = 道中で <b class="num">${fmt(eat)}</b> 食べる<br>` +
    (arrive >= 0
      ? `出発 <b class="num">${fmt(load)}</b> → 到着 <b class="num">${fmt(arrive)}</b>`
      : `<span class="bad">道中で食料が尽きます。引き返し、積み荷は失われます。</span>`)
  );
}

function currentOrderKey(): string {
  const c = selectedConvoy();
  return [selected, dest, c?.at, !!c?.move, c ? state.rice[c.at] : '', state.outcome].join('|');
}

function renderOrder(): void {
  orderKey = currentOrderKey();
  const sec = $('order');
  const body = $('order-body');
  const c = selectedConvoy();
  if (!c || state.outcome !== 'playing') {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  if (c.move) {
    body.innerHTML = `<p class="preview">${c.name}は移動中です。着くまで指図できません。</p>`;
    return;
  }
  const sc = state.scenario;
  const parts: string[] = [`<div>${nodeName(c.at)}から、行き先を選ぶ(地図の拠点をクリックしても選べます)</div><div class="dests">`];
  for (const n of sc.map.nodes) {
    if (n.id === c.at) continue;
    parts.push(`<button type="button" data-dest="${n.id}" class="${n.id === dest ? 'selected' : ''}">${n.name}</button>`);
  }
  parts.push('</div>');

  const route = currentRoute();
  if (route && dest) {
    const cap = maxLoad(c, sc.carrierCapacity);
    const have = state.rice[c.at] ?? 0;
    const max = Math.min(cap, have);
    load = Math.min(load, max);
    const eat = eatenOver(c, sc.carrierRation, route.days);
    const via = route.nodes.map(nodeName).join(' → ');
    parts.push(
      `<div class="row">積む米 <input id="load" type="range" min="0" max="${max}" step="0.5" value="${load}" /> <b id="load-val" class="num">${fmt(load)}</b></div>`,
      `<div class="row"><button type="button" id="load-full">満載(${fmt(max)})</button>` +
        `<button type="button" id="load-back" ${eat > max ? 'disabled' : ''}>帰り分だけ(${fmt(eat)})</button></div>`,
      `<div id="preview" class="preview">${previewHtml(c.carriers, via, route.days, eat)}</div>`,
      `<button type="button" id="btn-go" class="primary">出発させる</button>`,
    );
  }
  body.innerHTML = parts.join('');

  body.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => (b.onclick = () => setDest(b.dataset.dest!)));
  const range = body.querySelector<HTMLInputElement>('#load');
  if (range && route) {
    // 要素を作り直さず、数字と予告だけ書き換える(作り直すとドラッグが途切れる)
    range.oninput = () => {
      load = Number(range.value);
      $('load-val').textContent = fmt(load);
      $('preview').innerHTML = previewHtml(
        c.carriers,
        route.nodes.map(nodeName).join(' → '),
        route.days,
        eatenOver(c, sc.carrierRation, route.days),
      );
    };
  }
  const full = body.querySelector<HTMLButtonElement>('#load-full');
  if (full && route) full.onclick = () => ((load = Math.min(maxLoad(c, sc.carrierCapacity), state.rice[c.at] ?? 0)), renderOrder());
  const back = body.querySelector<HTMLButtonElement>('#load-back');
  if (back && route) back.onclick = () => ((load = eatenOver(c, sc.carrierRation, route.days)), renderOrder());
  const go = body.querySelector<HTMLButtonElement>('#btn-go');
  if (go && dest) {
    go.onclick = () => {
      const r = dispatch(state, c.id, dest!, load);
      if (!r.ok) {
        alert(r.error);
        return;
      }
      dispatchedOnce = true;
      selected = null;
      dest = null;
      renderPanel();
    };
  }
}

function showResult(): void {
  const sc = state.scenario;
  const won = state.outcome === 'won';
  const delivered = state.rice[sc.frontId] ?? 0;
  $('result-text').textContent = won
    ? `${sc.goalDays}日間、${nodeName(sc.frontId)}を保ちました。\n蔵に残った米: ${fmt(state.rice[sc.depotId] ?? 0)}\n陣に残った米: ${fmt(delivered)}`
    : `第${fmt(currentDay(state))}日、${nodeName(sc.frontId)}の兵糧が尽きました。\n遠征は失敗です。`;
  $('result').hidden = false;
}

// ---- 入力 ----
$('btn-play').onclick = () => {
  running = !running;
  acc = 0;
  renderPanel();
};
$('btn-speed').onclick = () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  renderPanel();
};
$('btn-retry').onclick = reset;
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const id = hitNode(state, view(), e.clientX - r.left, e.clientY - r.top);
  if (!id) return;
  const c = selectedConvoy();
  if (c && !c.move && id !== c.at) {
    setDest(id);
    return;
  }
  // 隊を選んでいなければ、その拠点で待機中の最初の隊を選ぶ
  const idle = state.convoys.find((x) => !x.move && x.at === id);
  if (idle) {
    selected = idle.id;
    dest = null;
    renderPanel();
  }
});
window.addEventListener('resize', resize);

reset();
resize();
requestAnimationFrame(tick);
