import {
  armyDaysToHome,
  candidateRoutes,
  createState,
  currentDay,
  daysLeft,
  dispatch,
  eatenOver,
  evaluate,
  maxLoad,
  nodeConsumptionPerDay,
  retreatPlan,
  setRetreatRoute,
  step,
  tripPreview,
  type Scenario,
  type SimState,
} from '@hyoro/core';
import { loadJson, saveJson } from '@hyoro/platform';
import scenarioJson from '../data/scenario-01.json';
import { setupGlossary, t } from './glossary';
import { daysLeftColor, draw, fmt, hitNode, type View } from './render';

const scenario = scenarioJson as unknown as Scenario;
/** 1刻み(半日)を何ミリ秒で進めるか(×1のとき) */
const STEP_MS = 1200;
const SPEEDS = [1, 2, 4];
const EPS = 1e-9;

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
/** 選んでいる道の候補番号(candidateRoutes の何番目か) */
let routeIdx = 0;
let dispatchedOnce = false;
let seed = 0;

/** URL の ?seed= があればそれを使い、なければ遊ぶたびに変える */
function pickSeed(): number {
  const q = new URLSearchParams(location.search).get('seed');
  const n = q === null ? NaN : Number(q);
  if (Number.isInteger(n) && n >= 0) return n >>> 0;
  return (Math.random() * 2 ** 32) >>> 0;
}
/** 指図パネルを作り直す必要があるかの判定用。同じなら作り直さない(スライダー操作を妨げないため) */
let orderKey = '';

function reset(): void {
  seed = pickSeed();
  state = createState(structuredClone(scenario), seed);
  running = false;
  acc = 0;
  selected = null;
  dest = null;
  dispatchedOnce = false;
  orderKey = '';
  bestLine = null;
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
  return state.convoys.find((c) => c.id === selected && !c.dropped) ?? null;
}

function routeOptions() {
  const c = selectedConvoy();
  if (!c || c.move || !dest) return [];
  return candidateRoutes(state.scenario.map, c.at, dest, 3);
}

function currentRoute() {
  const opts = routeOptions();
  return opts[Math.min(routeIdx, opts.length - 1)] ?? null;
}

/** 道の説明(経由地と危険) */
function routeLabel(nodes: string[], days: number): string {
  const mid = nodes.slice(1, -1).map(nodeName);
  const via = mid.length ? `${mid.join('・')}経由` : '直行';
  const risks = state.scenario.map.links.filter(
    (l) => l.risk && nodes.some((n, i) => i + 1 < nodes.length && ((l.a === n && l.b === nodes[i + 1]) || (l.b === n && l.a === nodes[i + 1]))),
  );
  return `${via} ${fmt(days)}日${risks.length ? ' ⚠' + risks.map((l) => l.risk!.label).join('・') : ''}`;
}

/** 危険がすべて起きても届く(食料が尽きない)最小の積み荷。積める上限で足りなければ null */
function safeLoad(nodes: string[], max: number): number | null {
  const c = selectedConvoy()!;
  const ok = (l: number) => (tripPreview(state, c, nodes, l)?.arriveWorst ?? -1) >= 0;
  if (!ok(max)) return null;
  let lo = 0;
  let hi = max;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 2) / 2; // 0.5刻みに切り上げ
}

function setDest(id: string): void {
  const c = selectedConvoy();
  if (!c || c.move || id === c.at) return;
  dest = id;
  routeIdx = 0;
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
      const phaseBefore = state.army.phase;
      const troopsBefore = state.army.troops;
      step(state);
      // 指図が要りそうな出来事があったら止める
      const arrived = state.convoys.some((c) => movingBefore.has(c.id) && !c.move);
      const armyEvent = state.army.phase !== phaseBefore || state.army.troops !== troopsBefore;
      if ((arrived || armyEvent) && $<HTMLInputElement>('chk-autopause').checked) {
        running = false;
        acc = 0;
      }
      if (state.outcome !== 'playing') running = false;
      renderPanel();
    }
  }
  // 一時停止中も acc を保つので、止めた位置のまま描ける
  const alpha = state.outcome === 'playing' ? Math.min(1, acc / interval) : 0;
  const r = currentRoute();
  const holding = state.army.phase === 'hold';
  const plan = holding ? retreatPlan(state) : null;
  draw(ctx, state, view(), alpha, {
    selectedConvoyId: selected,
    routeNodes: r?.nodes ?? null,
    retreatNodes: plan?.route.nodes ?? null,
    stops: plan?.stops ?? [],
  });
  requestAnimationFrame(tick);
}

// ---- パネル ----
function renderClock(): void {
  const sc = state.scenario;
  const day = currentDay(state);
  const a = state.army;
  let html = `第 <b>${fmt(day)}</b> 日 ・ `;
  if (a.phase === 'hold') {
    const left = daysLeft(state.rice[a.at] ?? 0, nodeConsumptionPerDay(state, a.at)) ?? 0;
    html +=
      `撤退開始まで ${fmt(Math.max(0, sc.goalDays - day))}日 ・ ${nodeName(a.at)} ` +
      `<b style="color:${daysLeftColor(left)}">${t('あと何日分', `あと${left.toFixed(1)}日分`)}</b>`;
  } else if (a.phase === 'retreat') {
    html += `<b>撤退中</b> 兵${a.troops}人・米${fmt(a.cargo)} ・ 蔵まで あと${fmt(armyDaysToHome(state) ?? 0)}日`;
  } else if (a.phase === 'home') {
    html += `軍勢は蔵に戻った(兵${a.troops}人)`;
  } else {
    html += '軍勢は散り散りになった';
  }
  $('clock').innerHTML = html;
  $('seed').innerHTML = t('シード', `シード ${seed}`);
}

function renderRetreat(): void {
  const a = state.army;
  const box = $('retreat');
  if (a.phase !== 'hold') {
    const lost = a.dropped > 0 ? `<br><span class="bad">${t('離脱')}した兵: ${a.dropped}人</span>` : '';
    box.innerHTML =
      a.phase === 'retreat'
        ? `兵${a.troops}人が蔵へ撤退中。持っている米 ${fmt(a.cargo)}。${lost}`
        : `兵${a.troops}/${a.troopsTotal}人が帰還。${lost}`;
    return;
  }
  const p = retreatPlan(state);
  const sc = state.scenario;
  const opts = candidateRoutes(sc.map, sc.frontId, sc.depotId, 3);
  const cur = p.route.nodes.join('>');
  const rows = [
    '<div>撤退路を選ぶ:</div><div class="dests">' +
      opts
        .map(
          (r, i) =>
            `<button type="button" data-retreat="${i}" class="${r.nodes.join('>') === cur ? 'selected' : ''}">${routeLabel(r.nodes, r.days)}</button>`,
        )
        .join('') +
      '</div>',
    `<div>兵${a.troops}人 × ${a.ration} × ${p.route.days}日 = <b class="num">${fmt(p.need)}</b> 要る。兵が持てるのは <b class="num">${fmt(p.capacity)}</b> まで</div>`,
    `<div>${nodeName(a.at)}から持ち出す: ${fmt(p.fromFront)}(撤退の日に陣に残っている分から)</div>`,
  ];
  for (const s of p.stops) {
    if (s.required <= 0) continue;
    const ok = s.have + EPS >= s.required;
    rows.push(
      `<div>${nodeName(s.id)}に${t('置き米')}: <b class="num">${fmt(s.required)}</b> ` +
        `<span class="${ok ? 'good' : 'bad'}">(今 ${fmt(s.have)}${ok ? ' ✓' : ''})</span></div>`,
    );
  }
  for (const r of p.risks) {
    rows.push(
      `<div class="bad">⚠ ${nodeName(r.a)}→${nodeName(r.b)}の${r.risk.label}: ${Math.round(r.risk.chance * 100)}%の確率で、持っている米の${Math.round(r.risk.loss * 100)}%を失う(この見積もりには入っていません)</div>`,
    );
  }
  rows.push(`<div class="note">兵は要る分しか受け取りません。多く置いた米は残り、${t('余剰')}として減点されます。</div>`);
  box.innerHTML = rows.join('');
  box.querySelectorAll<HTMLButtonElement>('[data-retreat]').forEach((b) => {
    b.onclick = () => {
      const r = opts[Number(b.dataset.retreat)];
      if (r && setRetreatRoute(state, r.nodes).ok) renderPanel();
    };
  });
}

function renderHint(): void {
  const a = state.army;
  const day = currentDay(state);
  const goal = state.scenario.goalDays;
  let hint: string;
  if (!dispatchedOnce) {
    hint =
      `${t('運搬隊')}を選び、行き先に<b>前線の${t('陣')}</b>を選んで出発させてください。<br>${t('人足')}も道中で米を食べます。<b>遠いほど、届く量が減ります。</b>`;
  } else if (a.phase === 'retreat') {
    hint = `${t('撤退')}中です。蔵の外に残った${t('運搬隊')}は<b>帰還に数えません</b>。${t('帰り分')}を持たせて蔵へ戻してください。`;
  } else if (a.phase === 'hold' && day >= goal - 6) {
    hint = `${fmt(goal)}日目に${t('撤退')}が始まります。<b>撤退路の拠点に${t('置き米')}をし</b>、陣にいる${t('運搬隊')}は早めに蔵へ戻してください。`;
  } else if (!running && state.convoys.some((c) => c.move)) {
    hint = '▶ で時を進めます。';
  } else {
    hint = `陣に着いた隊は、${t('帰り分')}の米を持たせないと戻れません。途中の拠点で${t('中継')}することもできます。`;
  }
  $('hint').innerHTML = hint;
}

function renderPanel(): void {
  renderClock();
  $('btn-play').textContent = running ? '❚❚ 止める' : '▶ 進める';
  ($('btn-play') as HTMLButtonElement).disabled = state.outcome !== 'playing';
  $('btn-speed').textContent = `×${SPEEDS[speedIdx]}`;
  renderHint();
  renderRetreat();

  const box = $('convoys');
  box.innerHTML = '';
  state.convoys.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'convoy' + (c.id === selected ? ' selected' : '');
    b.disabled = c.dropped;
    const where = c.dropped
      ? '離脱'
      : c.move
        ? `${nodeName(c.move.route[c.move.route.length - 1]!)}へ移動中・米${fmt(c.cargo)}`
        : `${nodeName(c.at)}で待機`;
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
  for (const e of [...state.log].reverse().slice(0, 40)) {
    const li = document.createElement('li');
    li.textContent = `${fmt(e.step * state.scenario.stepDays)}日 ${e.text}`;
    log.appendChild(li);
  }

  if (state.outcome !== 'playing') showResult();
}

function previewHtml(nodes: string[]): string {
  const sc = state.scenario;
  const c = selectedConvoy()!;
  const p = tripPreview(state, c, nodes, load)!;
  const lines = [
    `道: ${nodes.map(nodeName).join(' → ')}(${fmt(p.route.days)}日)`,
    `人足${c.carriers}人 × ${sc.carrierRation} × ${fmt(p.route.days)}日 = 道中で <b class="num">${fmt(p.eat)}</b> 食べる`,
  ];
  if (p.arrive + EPS < 0) {
    lines.push(`<span class="bad">道中で食料が尽き、人足が${t('離脱')}します(積み荷も失われます)。</span>`);
  } else if (!p.risks.length) {
    lines.push(`出発 <b class="num">${fmt(load)}</b> → 到着 <b class="num">${fmt(Math.max(0, p.arrive))}</b>`);
  } else {
    const r = p.risks.map((x) => `${x.risk.label}(${Math.round(x.risk.chance * 100)}%で荷の${Math.round(x.risk.loss * 100)}%を失う)`).join('・');
    lines.push(`出発 <b class="num">${fmt(load)}</b> → 無事なら <b class="num">${fmt(Math.max(0, p.arrive))}</b>`);
    lines.push(
      p.arriveWorst + EPS >= 0
        ? `<span class="warn">⚠ ${r}。起きれば到着 <b class="num">${fmt(p.arriveWorst)}</b></span>`
        : `<span class="bad">⚠ ${r}。起きると道中で食料が尽き、人足が離脱します。</span>`,
    );
  }
  return lines.join('<br>');
}

function currentOrderKey(): string {
  const c = selectedConvoy();
  return [selected, dest, routeIdx, c?.at, !!c?.move, c ? state.rice[c.at] : '', state.outcome].join('|');
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
  const opts = routeOptions();
  let safe: number | null = null;
  if (route && dest) {
    const cap = maxLoad(c, sc.carrierCapacity);
    const have = state.rice[c.at] ?? 0;
    const max = Math.min(cap, have);
    load = Math.min(load, max);
    const eat = eatenOver(c, sc.carrierRation, route.days);
    // 危険が起きると「帰り分」では足りなくなる道だけ、備えの分を出す
    // (危険が最後の区間にあるなら、荷を失っても食料は尽きないので要らない)
    const risky = tripPreview(state, c, route.nodes, 0)!.risks.length > 0;
    const safeNeed = risky ? safeLoad(route.nodes, cap) : null;
    const needsBuffer = risky && (safeNeed === null || safeNeed > eat + EPS);
    safe = needsBuffer && safeNeed !== null && safeNeed <= max + EPS ? safeNeed : null;
    parts.push(
      '<div>道を選ぶ:</div><div class="dests">' +
        opts
          .map(
            (r, i) =>
              `<button type="button" data-route="${i}" class="${r === route ? 'selected' : ''}">${routeLabel(r.nodes, r.days)}</button>`,
          )
          .join('') +
        '</div>',
      `<div class="row">積む米 <input id="load" type="range" min="0" max="${max}" step="0.5" value="${load}" /> <b id="load-val" class="num">${fmt(load)}</b></div>`,
      `<div class="row"><button type="button" id="load-full">満載(${fmt(max)})</button>` +
        `<button type="button" id="load-back" ${eat > max + EPS ? 'disabled' : ''}>帰り分だけ(${fmt(eat)})</button>` +
        (needsBuffer
          ? `<button type="button" id="load-safe" ${safe === null ? 'disabled' : ''}>荷を失っても尽きない分${safeNeed === null ? '' : `(${fmt(safeNeed)})`}</button>`
          : '') +
        '</div>',
      `<div id="preview" class="preview">${previewHtml(route.nodes)}</div>`,
      `<button type="button" id="btn-go" class="primary">出発させる</button>`,
    );
  }
  body.innerHTML = parts.join('');

  body.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => (b.onclick = () => setDest(b.dataset.dest!)));
  body.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(
    (b) =>
      (b.onclick = () => {
        routeIdx = Number(b.dataset.route);
        renderOrder();
      }),
  );
  if (!route || !dest) return;
  const eat = eatenOver(c, sc.carrierRation, route.days);
  const range = body.querySelector<HTMLInputElement>('#load');
  if (range) {
    // 要素を作り直さず、数字と予告だけ書き換える(作り直すとドラッグが途切れる)
    range.oninput = () => {
      load = Number(range.value);
      $('load-val').textContent = fmt(load);
      $('preview').innerHTML = previewHtml(route.nodes);
    };
  }
  $('load-full').onclick = () => {
    load = Math.min(maxLoad(c, sc.carrierCapacity), state.rice[c.at] ?? 0);
    renderOrder();
  };
  $('load-back').onclick = () => {
    load = eat;
    renderOrder();
  };
  const safeBtn = body.querySelector<HTMLButtonElement>('#load-safe');
  if (safeBtn && safe !== null) {
    const v = safe;
    safeBtn.onclick = () => {
      load = v;
      renderOrder();
    };
  }
  $('btn-go').onclick = () => {
    if (load + EPS < eat && !confirm('道中で食料が尽き、人足が離脱します。それでも出発させますか?')) return;
    const r = dispatch(state, c.id, dest!, load, route.nodes);
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

const isBest = (v: unknown): v is { score: number; seed: number } =>
  typeof v === 'object' && v !== null && Number.isFinite((v as { score?: unknown }).score) && Number.isFinite((v as { seed?: unknown }).seed);

/**
 * 最高得点の記録と、その結果の文言。showResult は何度も呼ばれるので、
 * 遠征ごとに1回だけ記録し(null の間は未記録)、文言を使い回す。
 */
let bestLine: string | null = null;

function recordBest(held: boolean, score: number): string {
  const key = `best:${state.scenario.id}`;
  const prev = loadJson<{ score: number; seed: number } | null>(key, null, (v): v is { score: number; seed: number } => isBest(v));
  if (held && (!prev || score > prev.score)) {
    return saveJson(key, { score, seed }) ? '最高得点を更新しました' : '(この環境では最高得点を保存できません)';
  }
  return prev ? `これまでの最高: ${fmt(prev.score)}(シード ${prev.seed})` : '';
}

function showResult(): void {
  const sc = state.scenario;
  const r = evaluate(state);
  if (bestLine === null) bestLine = recordBest(r.held, r.score);
  const scoring = sc.scoring ?? { perPerson: 10, perSurplus: 1 };
  let text: string;
  if (!r.held) {
    text = `第${fmt(currentDay(state))}日、${nodeName(sc.frontId)}の兵糧が尽きました。\n遠征は失敗です。`;
  } else {
    const where = r.surplusByNode.map((x) => `${nodeName(x.id)} ${fmt(x.rice)}`).join('、');
    text = [
      `${sc.goalDays}日間${nodeName(sc.frontId)}を保ち、撤退しました。`,
      '',
      `帰還: 兵 ${r.troopsHome}/${r.troopsTotal}人 ・ 人足 ${r.carriersHome}/${r.carriersTotal}人`,
      `  → +${(r.troopsHome + r.carriersHome) * scoring.perPerson}点(1人${scoring.perPerson}点)`,
      `余剰(蔵の外に残した米): ${fmt(r.surplus)}${where ? `(${where})` : ''}`,
      `  → −${fmt(r.surplus * scoring.perSurplus)}点(村への負担)`,
      '',
      `得点 ${fmt(r.score)} / 満点 ${(r.troopsTotal + r.carriersTotal) * scoring.perPerson}`,
      bestLine,
    ].join('\n');
  }
  $('result-text').textContent = text;
  $('result').hidden = false;
}

// ---- 入力 ----
$('btn-play').onclick = () => {
  running = !running;
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
  const idle = state.convoys.find((x) => !x.move && !x.dropped && x.at === id);
  if (idle) {
    selected = idle.id;
    dest = null;
    renderPanel();
  }
});
window.addEventListener('resize', resize);

setupGlossary($('tip'), $<HTMLDialogElement>('glossary'), $('btn-glossary'));
reset();
resize();
requestAnimationFrame(tick);
