import {
  armyDaysToHome,
  candidateRoutes,
  createState,
  currentDay,
  daysLeft,
  buyLocal,
  convoyCapacity,
  decodeShare,
  encodeShare,
  dispatch,
  evaluate,
  fodderGood,
  frontDaysLeft,
  goodsOf,
  marketPrice,
  nodeAmounts,
  purchaseCost,
  retreatPlan,
  relayNode,
  setAuto,
  setAutoRoute,
  setCardActive,
  setRetreatRoute,
  stepWithRules,
  type CardId,
  tripPreview,
  type Scenario,
  type SimState,
} from '@hyoro/core';
import { loadJson, saveJson } from '@hyoro/platform';
import scenario01 from '../data/scenario-01.json';
import scenario02 from '../data/scenario-02.json';
import scenario03 from '../data/scenario-03.json';
import { setupGlossary, t } from './glossary';
import { daysLeftColor, draw, fmt, hitIdleGroup, hitNode, type View } from './render';
import { paperTileUrl } from './washi';

const SCENARIOS = [scenario01, scenario02, scenario03] as unknown as Scenario[];

/** URL の ?s= で選んだシナリオ。なければ1本目 */
function pickScenario(): Scenario {
  const q = new URLSearchParams(location.search).get('s');
  return SCENARIOS.find((x) => x.id === q) ?? SCENARIOS[0]!;
}
let scenario = pickScenario();
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
/** 積む米 */
let load = 0;
/** 積む米以外の物資(物資ID → 量) */
let goodsLoad: Record<string, number> = {};
/** 選んでいる道の候補番号(candidateRoutes の何番目か) */
let routeIdx = 0;
let dispatchedOnce = false;
let seed = 0;

/** 札(シート)に出している中身。null なら札は閉じていて、地図が画面いっぱい */
type Pane = 'order' | 'node' | 'convoys' | 'retreat' | 'cards' | 'log' | 'menu';
let pane: Pane | null = null;
/** 拠点の札で見ている拠点 */
let nodeSel: string | null = null;
/** 閉じた説明の文。文が変わったらまた出す */
let hintClosed = '';
/** 今出している説明の文 */
let hintNow = '';
const PANE_TITLE: Record<Pane, string> = {
  order: '指図',
  node: '拠点',
  convoys: '運搬隊',
  retreat: '撤退の備え',
  cards: 'ルールカードと自動便',
  log: '報告',
  menu: 'メニュー',
};

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
  pane = null;
  nodeSel = null;
  hintClosed = '';
  bestLine = null;
  $('result-share').dataset.code = '';
  $('result').hidden = true;
  renderPanel();
}

function view(): View {
  const r = canvas.getBoundingClientRect();
  // 上下の余白は拠点名と丸の下の1行が入るだけにする(低い画面で地図が潰れないように)
  const padY = Math.max(36, Math.min(60, r.height * 0.13));
  const padX = Math.max(40, Math.min(80, r.width * 0.08));
  return { w: r.width, h: r.height, padX, padY };
}

function resize(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** 手動の隊を選んで行き先を待っているなら、その隊のいる拠点 */
function pickingFrom(): string | null {
  const c = selectedConvoy();
  return c && !c.move && !c.auto && !dest && state.outcome === 'playing' ? c.at : null;
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
  const onRoute = state.scenario.map.links.filter((l) =>
    nodes.some((n, i) => i + 1 < nodes.length && ((l.a === n && l.b === nodes[i + 1]) || (l.b === n && l.a === nodes[i + 1]))),
  );
  const risks = onRoute.filter((l) => l.risk).map((l) => '⚠' + l.risk!.label);
  const raids = onRoute.filter((l) => l.raid).map((l) => '⚔' + l.raid!.label);
  const marks = [...risks, ...raids];
  return `${via} ${fmt(days)}日${marks.length ? ' ' + marks.join(' ') : ''}`;
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
  goodsLoad = {};
  load = Math.min(convoyCapacity(state, c), state.rice[c.at] ?? 0);
  // 物資のあるシナリオで、陣か撤退路の置き場所へ運ぶなら、最初から陣の割合で積む(薪の積み忘れを防ぐ)
  const sc = state.scenario;
  const isStop = state.army.phase === 'hold' && retreatPlan(state).stops.some((x) => x.id === id && x.required > 0);
  const route = currentRoute();
  if (goodsOf(sc).length && route && (id === sc.frontId || isStop)) {
    const m = mixLoad(route.nodes);
    load = m.rice;
    goodsLoad = m.goods;
  } else if (route && c.horses > 0) {
    // 馬の隊は、ほかの行き先でも往路の飼い葉を積んでおく(積まないと満載のとき荷を捨てることになる)
    const fg = fodderGood(sc);
    const need = tripPreview(state, c, route.nodes, 0)!.fodderNeed;
    if (fg && (state.goods[fg.id]![c.at] ?? 0) + EPS >= need) {
      goodsLoad = { [fg.id]: Math.ceil(need * 2) / 2 };
      load = Math.min(convoyCapacity(state, c) - goodsLoad[fg.id]!, state.rice[c.at] ?? 0);
    }
  }
  renderPanel();
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
      // 一時停止の判断は手動の隊だけ(自動の隊が着くたびに止まると進まないため)
      const movingBefore = new Set(state.convoys.filter((c) => c.move && !c.auto).map((c) => c.id));
      const phaseBefore = state.army.phase;
      const troopsBefore = state.army.troops;
      stepWithRules(state);
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
    pickFrom: pickingFrom(),
    selectedNodeId: pane === 'node' ? nodeSel : null,
  });
  requestAnimationFrame(tick);
}

// ---- パネル ----
/** 米と物資の量の説明(例: 米50・薪10)。物資のないシナリオでは米だけ */
function amountsText(rice: number, goods: Record<string, number>): string {
  const parts = [`米${fmt(rice)}`];
  for (const g of goodsOf(state.scenario)) if ((goods[g.id] ?? 0) > EPS) parts.push(`${g.name}${fmt(goods[g.id]!)}`);
  return parts.join('・');
}

/** 合計 w を、撤退の割合で米と物資に分けた説明 */
function splitText(w: number, shares: Record<string, number>): string {
  if (!goodsOf(state.scenario).length) return '';
  const goods: Record<string, number> = {};
  for (const g of goodsOf(state.scenario)) goods[g.id] = w * (shares[g.id] ?? 0);
  return `(${amountsText(w * (shares.rice ?? 0), goods)})`;
}

function renderClock(): void {
  const sc = state.scenario;
  const day = currentDay(state);
  const a = state.army;
  let html = `第 <b>${fmt(day)}</b> 日 ・ `;
  if (a.phase === 'hold') {
    const d = frontDaysLeft(state, a.at);
    const left = d.days ?? 0;
    const by = goodsOf(sc).length ? `(${d.limiting})` : '';
    html +=
      `撤退まで ${fmt(Math.max(0, sc.goalDays - day))}日 ・ 陣 ` +
      `<b style="color:${daysLeftColor(left)}">${t('あと何日分', `あと${left.toFixed(1)}日分${by}`)}</b>`;
    for (const h of d.health) {
      // 米・薪より先に尽きるときだけ出す(同じ日数なら出さない。0.05日は浮動小数の誤差よけ)
      if (h.days !== null && h.days < left - 0.05) html += ` ・ <span style="color:${daysLeftColor(h.days)}">${h.name} あと${h.days.toFixed(1)}日</span>`;
    }
  } else if (a.phase === 'retreat') {
    html += `<b>撤退中</b> 兵${a.troops}人 ・ 蔵まで あと${fmt(armyDaysToHome(state) ?? 0)}日`;
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
        ? `兵${a.troops}人が蔵へ撤退中。持っている ${amountsText(a.cargo, a.goods)}。${lost}`
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
    goodsOf(sc).length
      ? `<div>兵${a.troops}人 × ${p.route.days}日 = <b class="num">${fmt(p.need)}</b> 要る${splitText(p.need, p.shares)}。兵が持てるのは合計 <b class="num">${fmt(p.capacity)}</b> まで</div>`
      : `<div>兵${a.troops}人 × ${a.ration} × ${p.route.days}日 = <b class="num">${fmt(p.need)}</b> 要る。兵が持てるのは <b class="num">${fmt(p.capacity)}</b> まで</div>`,
    `<div>${nodeName(a.at)}から持ち出す: ${fmt(p.fromFront)}${splitText(p.fromFront, p.shares)}(撤退の日に陣に残っている分から)</div>`,
  ];
  for (const s of p.stops) {
    if (s.required <= 0) continue;
    const ok = s.have + EPS >= s.required;
    const now = goodsOf(sc).length ? (() => {
      const am = nodeAmounts(state, s.id);
      const rice = am.rice ?? 0;
      delete am.rice;
      return amountsText(rice, am);
    })() : fmt(s.have);
    rows.push(
      `<div>${nodeName(s.id)}に${t('置き米')}: <b class="num">${fmt(s.required)}</b>${splitText(s.required, p.shares)} ` +
        `<span class="${ok ? 'good' : 'bad'}">(今 ${now}${ok ? ' ✓' : ''})</span></div>`,
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

/** 拠点の札: 在庫・あと何日・置き米・市・ここにいる隊 */
function renderNode(): void {
  const box = $('node-body');
  const id = nodeSel;
  if (!id) {
    box.innerHTML = '';
    return;
  }
  const sc = state.scenario;
  const am = nodeAmounts(state, id);
  const rice = am.rice ?? 0;
  delete am.rice;
  const rows: string[] = [`<p class="order-head"><b>${nodeName(id)}</b></p>`, `<div class="stock">${amountsText(rice, am)}</div>`];
  const d = frontDaysLeft(state, id);
  if (d.days !== null) {
    rows.push(`<div class="stock">${t('あと何日分')}: <b style="color:${daysLeftColor(d.days)}">${d.days.toFixed(1)}日</b>${goodsOf(sc).length ? `(${d.limiting}で決まる)` : ''}</div>`);
    for (const h of d.health) if (h.days !== null) rows.push(`<div class="stock">${h.name}: あと${h.days.toFixed(1)}日</div>`);
  }
  if (state.army.phase === 'hold') {
    const stop = retreatPlan(state).stops.find((x) => x.id === id && x.required > 0);
    if (stop) {
      const ok = stop.have + EPS >= stop.required;
      rows.push(`<div class="stock">撤退用の${t('置き米')}: <span class="${ok ? 'good' : 'bad'}">${fmt(stop.have)}/${fmt(stop.required)}${ok ? ' ✓' : ''}</span></div>`);
    }
  }
  const m = state.markets[id];
  if (m) {
    const price = marketPrice(state, id)!;
    const btn = (n: number) => {
      const amt = Math.min(n, m.left);
      const ok = amt > EPS && state.outcome === 'playing';
      return `<button type="button" data-buy="${amt}" ${ok ? '' : 'disabled'}>${fmt(amt)}買う(負担${ok ? fmt(purchaseCost(state, id, amt)) : '-'})</button>`;
    };
    rows.push(
      `<h3>${t('市')}</h3>`,
      `<div class="stock">残り 米${fmt(m.left)} ・ ${t('米価')} ${price.toFixed(2)}</div>`,
      `<div class="row wrap">${btn(10)}${btn(25)}</div>`,
      `<div class="note">買った米はここに置かれ、運搬隊が運びます。払った額は村への負担として減点。買うほど米価が上がります。</div>`,
    );
  }
  for (const o of state.orders) {
    if (o.from !== id && o.to !== id) continue;
    const left = (o.arriveStep - state.step) * sc.stepDays;
    rows.push(`<div class="note">${nodeName(o.from)}の村人が${nodeName(o.to)}へ米${fmt(o.rice)}を運んでいる(あと${fmt(left)}日)</div>`);
  }
  const here = state.convoys.filter((c) => !c.dropped && !c.move && c.at === id);
  if (here.length) {
    rows.push(
      '<h3>ここにいる運搬隊</h3><div class="dests">' +
        here.map((c) => `<button type="button" data-pick="${c.id}">${state.convoys.indexOf(c) + 1}. ${c.name}${c.auto ? '(自動)' : ''}</button>`).join('') +
        '</div>',
    );
  }
  box.innerHTML = rows.join('');
  box.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
    b.onclick = () => {
      const r = buyLocal(state, id, Number(b.dataset.buy));
      if (!r.ok) alert(r.error);
      renderPanel();
    };
  });
  box.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => (b.onclick = () => selectConvoy(b.dataset.pick!)));
}

/** 隊を選び、指図の札を開く */
function selectConvoy(id: string): void {
  selected = id;
  dest = null;
  pane = 'order';
  renderPanel();
}

/** 札を開く・閉じる(同じものを押したら閉じる) */
function openPane(p: Pane | null): void {
  pane = pane === p ? null : p;
  if (pane !== 'order') {
    selected = null;
    dest = null;
  }
  renderPanel();
}

/** ルールカードと自動便の欄 */
function renderCards(): void {
  const box = $('cards');
  const sc = state.scenario;
  const cards = sc.cards ?? [];
  const relay = relayNode(state);
  const autoCount = state.convoys.filter((c) => c.auto && !c.dropped).length;
  const alive = state.convoys.filter((c) => !c.dropped).length;
  const opts = candidateRoutes(sc.map, sc.depotId, sc.frontId, 3);
  const cur = state.autoRoute.join('>');
  const rows = [
    `<div class="row"><button type="button" id="btn-all-auto">${autoCount === alive ? '全隊を手動に' : '全隊を自動に'}</button>` +
      `<span class="note">自動の隊: ${autoCount}/${alive}</span></div>`,
    '<div>自動便の道:</div><div class="dests">' +
      opts
        .map(
          (r, i) =>
            `<button type="button" data-autoroute="${i}" class="${r.nodes.join('>') === cur ? 'selected' : ''}">${routeLabel(r.nodes, r.days)}</button>`,
        )
        .join('') +
      '</div>',
  ];
  for (const card of cards) {
    const on = state.activeCards.includes(card.id);
    const extra = card.id === 'chukei' ? `(今の中継地: ${relay ? nodeName(relay) : 'なし'})` : '';
    rows.push(
      `<button type="button" class="card${on ? ' on' : ''}" data-card="${card.id}" aria-pressed="${on}">` +
        `<span class="card-name">${on ? '◉' : '○'} ${card.name}</span><span class="card-text">${card.text}${extra}</span></button>`,
    );
  }
  box.innerHTML = rows.join('');
  $('btn-all-auto').onclick = () => {
    const on = autoCount !== alive;
    for (const c of state.convoys) setAuto(state, c.id, on);
    renderPanel();
  };
  box.querySelectorAll<HTMLButtonElement>('[data-autoroute]').forEach((b) => {
    b.onclick = () => {
      const r = opts[Number(b.dataset.autoroute)];
      if (r && setAutoRoute(state, r.nodes)) renderPanel();
    };
  });
  box.querySelectorAll<HTMLButtonElement>('[data-card]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.card as CardId;
      setCardActive(state, id, !state.activeCards.includes(id));
      renderPanel();
    };
  });
}

function renderHint(): void {
  const a = state.army;
  const day = currentDay(state);
  const goal = state.scenario.goalDays;
  let hint: string;
  // 自動の隊だけで動かした場合も、最初の説明は済んだものとする
  if (state.convoys.some((c) => c.move)) dispatchedOnce = true;
  const c = selectedConvoy();
  if (pickingFrom()) {
    hint = '行き先の拠点(点線の輪)を押してください。';
  } else if (c && dest) {
    hint = '積む量を決めて「出発」を押してください。';
  } else if (!dispatchedOnce) {
    hint = `蔵の横の足軽(${t('運搬隊')})を押し、行き先に<b>前線の${t('陣')}</b>を押してください。運ぶ人も道中で米を食べます。<b>遠いほど届く量が減ります。</b>`;
  } else if (a.phase === 'retreat') {
    hint = `${t('撤退')}中です。蔵の外に残った隊は帰還に数えません。${t('帰り分')}を持たせて蔵へ戻してください。`;
  } else if (a.phase === 'hold' && day >= goal - 6) {
    hint = `${fmt(goal)}日目に${t('撤退')}が始まります。「撤退」の札で、撤退路に置く米を確かめてください。`;
  } else if (!running && state.convoys.some((x) => x.move)) {
    hint = '▶ で時を進めます。';
  } else {
    hint = '';
  }
  const box = $('hint');
  hintNow = hint;
  $('hint-text').innerHTML = hint;
  // 札が開いている間は出さない(札に同じことが書いてあり、低い画面では地図が狭くなるため)
  box.hidden = !hint || hint === hintClosed || state.outcome !== 'playing' || pane !== null;
}

function renderPanel(): void {
  renderClock();
  $('btn-play').textContent = running ? '❚❚ 止める' : '▶ 進める';
  ($('btn-play') as HTMLButtonElement).disabled = state.outcome !== 'playing';
  $('btn-speed').textContent = `×${SPEEDS[speedIdx]}`;
  if (pane === 'order' && !selectedConvoy()) pane = null;
  // 札の開閉。開け閉めで地図の大きさが変わるので、描き直しの大きさは ResizeObserver で合わせる
  $('sheet').hidden = pane === null;
  $('sheet-title').textContent = pane ? PANE_TITLE[pane] : '';
  document.querySelectorAll<HTMLElement>('[data-pane]').forEach((el) => (el.hidden = el.dataset.pane !== pane));
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === pane));
  // 撤退前に置き米が足りない拠点があれば、「撤退」の札を目立たせる
  const short = state.army.phase === 'hold' && currentDay(state) >= state.scenario.goalDays - 6 && retreatPlan(state).stops.some((x) => x.required > 0 && x.have + EPS < x.required);
  document.querySelector('[data-tab="retreat"]')!.classList.toggle('alert', short);
  renderHint();
  renderRetreat();
  renderCards();
  renderNode();

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
        ? `${nodeName(c.move.route[c.move.route.length - 1]!)}へ移動中・${amountsText(c.cargo, c.goods)}`
        : `${nodeName(c.at)}で待機`;
    const autoTag = c.auto && !c.dropped ? '<span class="auto-tag">自動</span>' : '';
    const who = c.horses > 0 ? `人足${c.carriers}・馬${c.horses}` : `人足${c.carriers}`;
    b.innerHTML = `<span>${i + 1}. ${c.name}(${who})${autoTag}</span><span class="st">${where}</span>`;
    b.onclick = () => selectConvoy(c.id);
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
  const c = selectedConvoy()!;
  const p = tripPreview(state, c, nodes, load)!;
  const ration = p.route.days > 0 ? p.eat / (c.carriers * p.route.days) : 0;
  const goodsTotal = Object.values(goodsLoad).reduce((x, y) => x + y, 0);
  // 物資は道中で減らない。危険がすべて起きたときは、通る危険ごとに (1 - 失う割合) が掛かる
  const keep = p.risks.reduce((k, x) => k * (1 - x.risk.loss), 1) * p.raids.reduce((k, x) => k * (1 - x.raid.loss), 1);
  // 到着する物資: 飼い葉は馬が道中で食べる分を引く(ほかの物資は減らない)
  const fgId = fodderGood(state.scenario)?.id;
  const arriveGoods = Object.fromEntries(
    Object.entries(goodsLoad).map(([k, v]) => [k, k === fgId ? Math.max(0, v - p.fodderNeed) : v]),
  );
  const scaled = (f: number) => Object.fromEntries(Object.entries(arriveGoods).map(([k, v]) => [k, v * f]));
  // 大事な「着く量」を先に、短く書く。計算の内訳は小さな字で最後に
  const lines: string[] = [];
  const eatNote = `<span class="note">道中で人足が米${fmt(p.eat)}を食べる(${c.carriers}人×${fmt(ration)}×${fmt(p.route.days)}日)</span>`;
  const fg = fodderGood(state.scenario);
  if (fg && c.horses > 0) {
    const have = goodsLoad[fg.id] ?? 0;
    const carriersCap = c.carriers * state.scenario.carrierCapacity;
    if (have + EPS < p.fodderNeed && load + goodsTotal > carriersCap + EPS) {
      // 荷を捨てるので、満載で届くような到着量は出さない
      lines.push(
        `<span class="bad">${t(fg.name)}が足りない(要る${fmt(p.fodderNeed)}・積んだ${fmt(have)})。道中で馬が運べなくなり、${carriersCap}を超える荷を捨てます。</span>`,
        eatNote,
      );
      return lines.join('<br>');
    }
    lines.push(`<span class="note">馬が道中で${fg.name}${fmt(p.fodderNeed)}を食べる(積んだ${fmt(have)})</span>`);
  }
  if (p.arrive + EPS < 0) {
    lines.unshift(`<span class="bad">道中で食料が尽き、人足が${t('離脱')}します(荷も失う)。</span>`);
  } else if (!p.risks.length && !p.raids.length) {
    lines.unshift(`到着 <b class="num">${amountsText(Math.max(0, p.arrive), arriveGoods)}</b>`);
  } else {
    const r = [
      ...p.risks.map((x) => `${x.risk.label} ${Math.round(x.risk.chance * 100)}%で荷の${Math.round(x.risk.loss * 100)}%を失う`),
      ...p.raids.map((x) => `${x.raid.label} 1日${Math.round(x.raid.chancePerDay * 100)}%で襲われ荷の${Math.round(x.raid.loss * 100)}%を失う(何度も)`),
    ].join('・');
    lines.unshift(
      `無事なら到着 <b class="num">${amountsText(Math.max(0, p.arrive), arriveGoods)}</b>`,
      p.arriveWorst + EPS >= 0
        ? `<span class="warn">⚠ ${r} → ${p.raids.length ? '各1回' : ''}起きれば <b class="num">${amountsText(p.arriveWorst, scaled(keep))}</b></span>`
        : `<span class="bad">⚠ ${r}。起きると道中で食料が尽き、人足が離脱します。</span>`,
    );
  }
  lines.push(eatNote);
  return lines.join('<br>');
}

/** 陣の割合(兵が使う米と物資の比)で満載にする積荷。米は道中で食べる分を先に確保する */
function mixLoad(nodes: string[]): { rice: number; goods: Record<string, number> } {
  const c = selectedConvoy()!;
  const sc = state.scenario;
  const pre = tripPreview(state, c, nodes, 0)!;
  const eat = pre.eat;
  const here = nodeAmounts(state, c.at);
  // 馬を連れていれば、往路で食べる飼い葉を先に積む。足りなければ馬は運べないので、人足の分だけで組む
  const fg = fodderGood(sc);
  let cap = convoyCapacity(state, c);
  let fodder = 0;
  if (fg && c.horses > 0) {
    if ((here[fg.id] ?? 0) + EPS >= pre.fodderNeed) fodder = Math.ceil(pre.fodderNeed * 2) / 2;
    else cap = c.carriers * sc.carrierCapacity;
  }
  const room = Math.max(0, cap - eat - fodder);
  const shares = retreatPlan(state).shares;
  const goods: Record<string, number> = {};
  for (const g of goodsOf(sc)) goods[g.id] = Math.floor(Math.min(room * (shares[g.id] ?? 0), here[g.id] ?? 0) * 2) / 2;
  if (fg && fodder > 0) goods[fg.id] = (goods[fg.id] ?? 0) + fodder;
  const used = Object.values(goods).reduce((x, y) => x + y, 0) - fodder;
  const rice = Math.min(eat + room - used, here.rice ?? 0);
  return { rice: Math.floor(rice * 2) / 2, goods };
}

function currentOrderKey(): string {
  const c = selectedConvoy();
  const here = c ? JSON.stringify(nodeAmounts(state, c.at)) : '';
  return [selected, dest, routeIdx, c?.at, !!c?.move, c?.auto, here, state.outcome, state.activeCards.join()].join('|');
}

function renderOrder(): void {
  orderKey = currentOrderKey();
  const body = $('order-body');
  const c = selectedConvoy();
  if (!c || state.outcome !== 'playing') {
    body.innerHTML = '';
    return;
  }
  const autoBtn = `<div class="row"><button type="button" id="btn-auto">${c.auto ? 'この隊を手動に戻す' : 'この隊を自動にする'}</button></div>`;
  const bindAuto = () => {
    $('btn-auto').onclick = () => {
      setAuto(state, c.id, !c.auto);
      dest = null;
      renderPanel();
    };
  };
  if (c.auto) {
    body.innerHTML = `<p class="preview">${c.name}は${t('ルールカード', 'ルールカード')}に従って自動で動いています。手動に戻すと指図できます。</p>${autoBtn}`;
    bindAuto();
    return;
  }
  if (c.move) {
    body.innerHTML = `<p class="preview">${c.name}は移動中です。着くまで指図できません。</p>${autoBtn}`;
    bindAuto();
    return;
  }
  const sc = state.scenario;
  const idx = state.convoys.indexOf(c) + 1;
  const who = c.horses > 0 ? `人足${c.carriers}・馬${c.horses}` : `人足${c.carriers}`;
  // 行き先が決まったら、見積もりと「出発」を先頭に出す(狭い画面でスクロールせずに押せるように)。
  // 行き先・隊の切り替えは、決まったあとは畳んでおく
  const head = `<p class="order-head"><b>${idx}. ${c.name}</b>(${who})・${nodeName(c.at)}${dest ? ` → <b>${nodeName(dest)}</b>` : 'にいる'}</p>`;
  const others = state.convoys.filter((x) => x !== c && !x.dropped && !x.move && !x.auto && x.at === c.at);
  const switchHtml = others.length
    ? '<div class="row wrap">隊を替える: ' + others.map((x) => `<button type="button" data-pick="${x.id}">${state.convoys.indexOf(x) + 1}</button>`).join('') + '</div>'
    : '';
  const destHtml =
    '<div class="dests">' +
    sc.map.nodes
      .filter((n) => n.id !== c.at)
      .map((n) => `<button type="button" data-dest="${n.id}" class="${n.id === dest ? 'selected' : ''}">${n.name}</button>`)
      .join('') +
    '</div>';
  const parts: string[] = [head];
  if (!dest) parts.push('<div class="note">行き先の拠点を地図で押すか、ここで選んでください。</div>', destHtml, switchHtml);
  const route = currentRoute();
  const opts = routeOptions();
  let safe: number | null = null;
  if (route && dest) {
    const cap = convoyCapacity(state, c);
    const here = nodeAmounts(state, c.at);
    // 物資の量を在庫と積める上限に収める(米は残りの積載まで)
    for (const g of goodsOf(sc)) goodsLoad[g.id] = Math.max(0, Math.min(goodsLoad[g.id] ?? 0, here[g.id] ?? 0));
    let gsum = Object.values(goodsLoad).reduce((x, y) => x + y, 0);
    if (gsum > cap) {
      for (const g of goodsOf(sc)) goodsLoad[g.id] = (goodsLoad[g.id] ?? 0) * (cap / gsum);
      gsum = cap;
    }
    const have = here.rice ?? 0;
    const max = Math.min(cap - gsum, have);
    load = Math.min(load, max);
    // 道中で食べる量は、護衛付きなどのカードも含めて core の見積もりから取る
    const eat = tripPreview(state, c, route.nodes, 0)!.eat;
    // 危険が起きると「帰り分」では足りなくなる道だけ、備えの分を出す
    // (危険が最後の区間にあるなら、荷を失っても食料は尽きないので要らない)
    const risky = tripPreview(state, c, route.nodes, 0)!.risks.length > 0;
    const safeNeed = risky ? safeLoad(route.nodes, cap) : null;
    const needsBuffer = risky && (safeNeed === null || safeNeed > eat + EPS);
    safe = needsBuffer && safeNeed !== null && safeNeed <= max + EPS ? safeNeed : null;
    const routeHtml =
      opts.length > 1
        ? '<h3>道</h3><div class="dests">' +
          opts
            .map((r, i) => `<button type="button" data-route="${i}" class="${r === route ? 'selected' : ''}">${routeLabel(r.nodes, r.days)}</button>`)
            .join('') +
          '</div>'
        : '';
    parts.push(
      `<div id="preview" class="preview">${previewHtml(route.nodes)}</div>`,
      `<button type="button" id="btn-go" class="primary big-go">出発させる</button>`,
      '<h3>積む量</h3>',
      `<div class="row">米 <input id="load" type="range" min="0" max="${max}" step="0.5" value="${load}" /> <b id="load-val" class="num">${fmt(load)}</b></div>`,
      `<div class="row wrap"><button type="button" id="load-full">${goodsOf(sc).length ? '残りを米で満載' : `満載(${fmt(max)})`}</button>` +
        (goodsOf(sc).length ? '<button type="button" id="load-mix">陣の割合で満載</button>' : '') +
        `<button type="button" id="load-back" ${eat > max + EPS ? 'disabled' : ''}>帰り分だけ(${fmt(eat)})</button>` +
        (needsBuffer
          ? `<button type="button" id="load-safe" ${safe === null ? 'disabled' : ''}>荷を失っても尽きない分${safeNeed === null ? '' : `(${fmt(safeNeed)})`}</button>`
          : '') +
        '</div>',
      ...(goodsOf(sc).length
        ? [
            `<details><summary>米以外(${goodsOf(sc).map((g) => g.name).join('・')})を細かく決める</summary>` +
              goodsOf(sc)
                .map(
                  (g) =>
                    `<div class="row">${t(g.name)} <input data-good="${g.id}" type="range" min="0" max="${Math.min(here[g.id] ?? 0, cap)}" step="0.5" value="${goodsLoad[g.id] ?? 0}" /> <b data-good-val="${g.id}" class="num">${fmt(goodsLoad[g.id] ?? 0)}</b></div>`,
                )
                .join('') +
              '</details>',
          ]
        : []),
      routeHtml,
      `<details><summary>行き先・隊を替える</summary>${destHtml}${switchHtml}</details>`,
    );
  }
  parts.push(autoBtn);
  body.innerHTML = parts.join('');
  bindAuto();

  body.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => (b.onclick = () => setDest(b.dataset.dest!)));
  body.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => (b.onclick = () => selectConvoy(b.dataset.pick!)));
  body.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(
    (b) =>
      (b.onclick = () => {
        routeIdx = Number(b.dataset.route);
        renderOrder();
      }),
  );
  if (!route || !dest) return;
  const eat = tripPreview(state, c, route.nodes, 0)!.eat;
  const cap = convoyCapacity(state, c);
  const range = body.querySelector<HTMLInputElement>('#load');
  const goodsRanges = [...body.querySelectorAll<HTMLInputElement>('[data-good]')];
  /** 合計が上限を超えないよう、ほかのスライダーの上限を付け直す(要素は作り直さない) */
  const syncMax = () => {
    const here = nodeAmounts(state, c.at);
    const gsum = Object.values(goodsLoad).reduce((x, y) => x + y, 0);
    if (range) range.max = String(Math.max(0, Math.min(cap - gsum, here.rice ?? 0)));
    for (const r of goodsRanges) {
      const id = r.dataset.good!;
      r.max = String(Math.max(0, Math.min(here[id] ?? 0, cap - load - (gsum - (goodsLoad[id] ?? 0)))));
    }
  };
  if (range) {
    // 要素を作り直さず、数字と予告だけ書き換える(作り直すとドラッグが途切れる)
    range.oninput = () => {
      load = Number(range.value);
      $('load-val').textContent = fmt(load);
      syncMax();
      $('preview').innerHTML = previewHtml(route.nodes);
    };
  }
  for (const r of goodsRanges) {
    r.oninput = () => {
      goodsLoad[r.dataset.good!] = Number(r.value);
      body.querySelector<HTMLElement>(`[data-good-val="${r.dataset.good}"]`)!.textContent = fmt(Number(r.value));
      syncMax();
      $('preview').innerHTML = previewHtml(route.nodes);
    };
  }
  syncMax();
  $('load-full').onclick = () => {
    const gsum = Object.values(goodsLoad).reduce((x, y) => x + y, 0);
    load = Math.min(cap - gsum, state.rice[c.at] ?? 0);
    renderOrder();
  };
  const mixBtn = body.querySelector<HTMLButtonElement>('#load-mix');
  if (mixBtn) {
    mixBtn.onclick = () => {
      const m = mixLoad(route.nodes);
      load = m.rice;
      goodsLoad = m.goods;
      renderOrder();
    };
  }
  $('load-back').onclick = () => {
    load = eat;
    goodsLoad = {};
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
    const goods = Object.fromEntries(Object.entries(goodsLoad).filter(([, v]) => v > EPS));
    const r = dispatch(state, c.id, dest!, load, route.nodes, goods);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    dispatchedOnce = true;
    selected = null;
    dest = null;
    pane = null;
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
    const where = r.surplusByNode.map((x) => `${nodeName(x.id)} ${fmt(x.amount)}`).join('、');
    text = [
      `${sc.goalDays}日間${nodeName(sc.frontId)}を保ち、撤退しました。`,
      '',
      `帰還: 兵 ${r.troopsHome}/${r.troopsTotal}人 ・ 人足 ${r.carriersHome}/${r.carriersTotal}人`,
      `  → +${(r.troopsHome + r.carriersHome) * scoring.perPerson}点(1人${scoring.perPerson}点)`,
      `余剰(蔵の外に残した米・物資): ${fmt(r.surplus)}${where ? `(${where})` : ''}`,
      `  → −${fmt(r.surplus * scoring.perSurplus)}点(村への負担)`,
      ...(r.purchaseBurden > 0 ? [`市で米を買った負担: −${fmt(r.purchaseBurden)}点(村への負担)`] : []),
      '',
      `得点 ${fmt(r.score)} / 満点 ${(r.troopsTotal + r.carriersTotal) * scoring.perPerson}`,
      bestLine,
    ].join('\n');
  }
  $('result-text').textContent = text;
  // ★と、次の★までの得点
  const starLine = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  const next = r.toNextStar === null ? (r.stars === 3 ? '最高の評価です' : '') : `★${r.stars + 1}まで あと${fmt(Math.ceil(r.toNextStar * 10) / 10)}点`;
  $('result-stars').innerHTML = `${starLine}<small>${next}</small>`;
  renderShare(r);
  $('result').hidden = false;
}

/** 結果の共有文字列と、同じ展開で遊ぶためのURL */
function renderShare(r: ReturnType<typeof evaluate>): void {
  const code = encodeShare({
    scenario: state.scenario.id,
    seed,
    cards: state.activeCards,
    outcome: r.held ? 'done' : 'lost',
    score: r.score,
    stars: r.stars,
    troopsHome: r.troopsHome,
    carriersHome: r.carriersHome,
    surplus: r.surplus,
  });
  const url = playUrl(state.scenario.id, seed);
  const box = $('result-share');
  if (box.dataset.code === code) return; // 何度も呼ばれるので、同じなら作り直さない(選択が外れないように)
  box.dataset.code = code;
  box.innerHTML =
    '<div>共有文字列(同じシナリオ・シードで、ほかの人も同じ展開を遊べます):</div>' +
    `<input id="share-code" readonly value="${code}" />` +
    '<div class="row"><button type="button" id="btn-copy">コピー</button>' +
    `<a href="${url}">この展開をもう一度(シード ${seed})</a></div>`;
  $('btn-copy').onclick = async () => {
    const input = $<HTMLInputElement>('share-code');
    try {
      await navigator.clipboard.writeText(code);
      $('btn-copy').textContent = 'コピーしました';
    } catch {
      // クリップボードが使えない環境では、選択して手でコピーしてもらう
      input.select();
      $('btn-copy').textContent = '選択しました(手でコピーしてください)';
    }
  };
}

/** そのシナリオ・シードで遊ぶためのURL */
function playUrl(scenarioId: string, s: number): string {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('s', scenarioId);
  url.searchParams.set('seed', String(s));
  return url.toString();
}

/** 共有文字列を読むダイアログ */
function setupShareDialog(): void {
  const dlg = $<HTMLDialogElement>('share-dialog');
  $('btn-share-open').onclick = () => {
    $('share-out').innerHTML = '';
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    $('share-input').focus();
  };
  $('btn-share-close').onclick = () => dlg.close();
  $('btn-share-read').onclick = () => {
    const r = decodeShare($<HTMLTextAreaElement>('share-input').value);
    const out = $('share-out');
    if (!r.ok) {
      out.innerHTML = `<span class="bad">${r.error}</span>`;
      return;
    }
    const d = r.data;
    const sc = SCENARIOS.find((x) => x.id === d.scenario);
    const cards = d.cards.map((id) => sc?.cards?.find((c) => c.id === id)?.name ?? id).join('・') || 'なし';
    const lines = [
      `シナリオ: ${sc ? sc.title : `${d.scenario}(このゲームにないシナリオ)`}`,
      `シード: ${d.seed}`,
      `結果: ${d.outcome === 'done' ? '撤退まで終えた' : '陣が落ちた'} ・ ${'★'.repeat(d.stars)}${'☆'.repeat(3 - d.stars)} ・ 得点 ${fmt(d.score)}`,
      `帰還: 兵${d.troopsHome}人・人足${d.carriersHome}人 ・ 余剰 ${fmt(d.surplus)}`,
      `ルールカード: ${cards}`,
      '<span class="note">共有文字列は書き換えを見抜けません(打ち間違いや欠けだけを見つけます)。結果は自己申告として見てください。</span>',
    ];
    if (sc) lines.push(`<a href="${playUrl(d.scenario, d.seed)}">同じ展開で遊ぶ</a>`);
    out.innerHTML = lines.join('<br>');
  };
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
/** 拠点で待機中の手動の隊 */
function idleManual(id: string) {
  return state.convoys.filter((x) => !x.move && !x.dropped && !x.auto && x.at === id);
}

/** その拠点の手動の隊を選ぶ(選んでいる隊がそこにいれば次の隊へ)。選べなければ false */
function cycleIdle(id: string, c: ReturnType<typeof selectedConvoy>): boolean {
  const idle = idleManual(id);
  if (!idle.length || state.outcome !== 'playing') return false;
  const k = c ? idle.indexOf(c) : -1;
  selectConvoy(idle[(k + 1) % idle.length]!.id);
  return true;
}

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const v = view();
  const c = selectedConvoy();
  const id = hitNode(state, v, x, y);
  // 隊を選んでいるときは、ほかの拠点を押すと行き先になる
  if (c && !c.move && !c.auto && id && id !== c.at) {
    setDest(id);
    return;
  }
  // 待機中の隊の絵を押したら、その拠点の手動の隊を順に選ぶ
  const gid = hitIdleGroup(state, v, x, y);
  if (gid && cycleIdle(gid, c)) return;
  if (!id) return;
  // 拠点の絵を押したら、拠点の札(在庫・ここにいる隊)を開く
  selected = null;
  dest = null;
  nodeSel = id;
  pane = 'node';
  renderPanel();
});
// 札の開け閉め・画面の向きの変更で地図の大きさが変わるので、大きさの変化を見て合わせる
new ResizeObserver(() => resize()).observe($('map-wrap'));
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => (b.onclick = () => openPane(b.dataset.tab as Pane)));
$('btn-sheet-close').onclick = () => openPane(null);
$('btn-hint-close').onclick = () => {
  hintClosed = hintNow;
  $('hint').hidden = true;
};
$('btn-restart').onclick = reset;

// ページの地に和紙の模様を敷く(描けなければ CSS の地の色のまま)
try {
  const tile = paperTileUrl();
  if (tile) document.documentElement.style.setProperty('--paper-tile', `url(${tile})`);
} catch {
  /* 模様なしで続ける */
}
setupGlossary($('tip'), $<HTMLDialogElement>('glossary'), $('btn-glossary'));
setupShareDialog();
$('ver').textContent = `試作 ${__APP_VERSION__}`;
{
  const sel = $<HTMLSelectElement>('scenario');
  sel.innerHTML = SCENARIOS.map((x) => `<option value="${x.id}">${x.title}</option>`).join('');
  sel.value = scenario.id;
  sel.onchange = () => {
    scenario = SCENARIOS.find((x) => x.id === sel.value) ?? SCENARIOS[0]!;
    // シナリオを変えたら、シードは選び直す(URL の seed は外す)
    const url = new URL(location.href);
    url.searchParams.set('s', scenario.id);
    url.searchParams.delete('seed');
    history.replaceState(null, '', url);
    reset();
  };
}
reset();
resize();
requestAnimationFrame(tick);
