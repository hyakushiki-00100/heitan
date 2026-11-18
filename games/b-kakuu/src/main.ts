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
import { daysLeftColor, draw, fmt, hitNode, type View } from './render';

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
  $('result-share').dataset.code = '';
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
      `撤退開始まで ${fmt(Math.max(0, sc.goalDays - day))}日 ・ ${nodeName(a.at)} ` +
      `<b style="color:${daysLeftColor(left)}">${t('あと何日分', `あと${left.toFixed(1)}日分${by}`)}</b>`;
    for (const h of d.health) {
      // 米・薪より先に尽きるときだけ出す(同じ日数なら出さない。0.05日は浮動小数の誤差よけ)
      if (h.days !== null && h.days < left - 0.05) html += ` ・ <span style="color:${daysLeftColor(h.days)}">${h.name} あと${h.days.toFixed(1)}日</span>`;
    }
  } else if (a.phase === 'retreat') {
    html += `<b>撤退中</b> 兵${a.troops}人・${amountsText(a.cargo, a.goods)} ・ 蔵まで あと${fmt(armyDaysToHome(state) ?? 0)}日`;
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

/** 市の欄(市のないシナリオでは隠す) */
function renderMarkets(): void {
  const sec = $('markets-sec');
  const ids = Object.keys(state.markets);
  sec.hidden = ids.length === 0;
  if (!ids.length) return;
  const rows: string[] = [
    `<div class="note">${t('市')}で米を買えます。買った米はその拠点に置かれ、運搬隊が運びます。払った額は${t('余剰', '村への負担')}として減点になり、買うほど${t('米価')}が上がります。</div>`,
  ];
  for (const id of ids) {
    const m = state.markets[id]!;
    const price = marketPrice(state, id)!;
    const btn = (n: number) => {
      const amt = Math.min(n, m.left);
      const ok = amt > EPS && state.outcome === 'playing';
      return `<button type="button" data-buy="${id}" data-amt="${amt}" ${ok ? '' : 'disabled'}>${fmt(amt)}買う(負担${ok ? fmt(purchaseCost(state, id, amt)) : '-'})</button>`;
    };
    rows.push(
      `<div class="row"><b>${nodeName(id)}</b> 残り 米${fmt(m.left)} ・ 米価 ${price.toFixed(2)}</div>`,
      `<div class="row">${btn(10)}${btn(25)}</div>`,
    );
  }
  for (const o of state.orders) {
    const left = (o.arriveStep - state.step) * state.scenario.stepDays;
    rows.push(`<div class="note">${nodeName(o.from)}の村人が${nodeName(o.to)}へ米${fmt(o.rice)}を運んでいる(あと${fmt(left)}日)</div>`);
  }
  if (state.purchaseBurden > 0) rows.push(`<div class="note">これまでに市で払った負担: ${fmt(state.purchaseBurden)}</div>`);
  const box = $('markets');
  box.innerHTML = rows.join('');
  box.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
    b.onclick = () => {
      const r = buyLocal(state, b.dataset.buy!, Number(b.dataset.amt));
      if (!r.ok) alert(r.error);
      renderPanel();
    };
  });
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
  if (!dispatchedOnce) {
    const goods = goodsOf(state.scenario);
    hint =
      `${t('運搬隊')}を選び、行き先に<b>前線の${t('陣')}</b>を選んで出発させてください。<br>${t('人足')}も道中で米を食べます。<b>遠いほど、届く量が減ります。</b>` +
      (goods.length ? `<br>このシナリオでは米のほかに${goods.map((g) => t(g.name)).join('と')}も運びます。` : '');
  } else if (a.phase === 'retreat') {
    hint = `${t('撤退')}中です。蔵の外に残った${t('運搬隊')}は<b>帰還に数えません</b>。${t('帰り分')}を持たせて蔵へ戻してください。`;
  } else if (a.phase === 'hold' && day >= goal - 6) {
    hint = `${fmt(goal)}日目に${t('撤退')}が始まります。<b>撤退路の拠点に${t('置き米')}をし</b>、陣にいる${t('運搬隊')}は早めに蔵へ戻してください。`;
  } else if (!running && state.convoys.some((c) => c.move)) {
    hint = '▶ で時を進めます。';
  } else {
    hint = `陣に着いた隊は、${t('帰り分')}の米を持たせないと戻れません。途中の拠点で${t('中継')}することもできます。<br>慣れてきたら、${t('ルールカード')}を選んで運搬隊を自動にできます。`;
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
  renderCards();
  renderMarkets();

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
  const lines = [
    `道: ${nodes.map(nodeName).join(' → ')}(${fmt(p.route.days)}日)`,
    `人足${c.carriers}人 × ${fmt(ration)} × ${fmt(p.route.days)}日 = 道中で米 <b class="num">${fmt(p.eat)}</b> 食べる`,
  ];
  if (goodsTotal > EPS) lines.push(`積荷の合計 <b class="num">${fmt(load + goodsTotal)}</b> / ${fmt(convoyCapacity(state, c))}`);
  const fg = fodderGood(state.scenario);
  if (fg && c.horses > 0) {
    const have = goodsLoad[fg.id] ?? 0;
    const carriersCap = c.carriers * state.scenario.carrierCapacity;
    lines.push(`馬${c.horses}頭 × ${state.scenario.horse!.fodderPerDay} × ${fmt(p.route.days)}日 = ${t(fg.name)} <b class="num">${fmt(p.fodderNeed)}</b> 要る(積んだ ${fmt(have)})`);
    if (have + EPS < p.fodderNeed && load + goodsTotal > carriersCap + EPS) {
      lines.push(`<span class="bad">道中で${fg.name}が尽きると馬が運べなくなり、人足だけで運べる${carriersCap}を超える荷を捨てます。</span>`);
      // 荷を捨てるので、満載で届くような到着量は出さない
      lines.push(`到着は人足が運べる <b class="num">${carriersCap}</b> 以下`);
      return lines.join('<br>');
    }
  }
  if (p.arrive + EPS < 0) {
    lines.push(`<span class="bad">道中で食料が尽き、人足が${t('離脱')}します(積み荷も失われます)。</span>`);
  } else if (!p.risks.length && !p.raids.length) {
    lines.push(`出発 <b class="num">${amountsText(load, goodsLoad)}</b> → 到着 <b class="num">${amountsText(Math.max(0, p.arrive), arriveGoods)}</b>`);
  } else {
    const r = [
      ...p.risks.map((x) => `${x.risk.label}(${Math.round(x.risk.chance * 100)}%で荷の${Math.round(x.risk.loss * 100)}%を失う)`),
      ...p.raids.map(
        (x) => `${x.raid.label}(${nodeName(x.a)}→${nodeName(x.b)}にいる間、1日${Math.round(x.raid.chancePerDay * 100)}%で襲われ荷の${Math.round(x.raid.loss * 100)}%を失う。何度も起こりうる)`,
      ),
    ].join('・');
    lines.push(`出発 <b class="num">${amountsText(load, goodsLoad)}</b> → 無事なら <b class="num">${amountsText(Math.max(0, p.arrive), arriveGoods)}</b>`);
    lines.push(
      p.arriveWorst + EPS >= 0
        ? `<span class="warn">⚠ ${r}。${p.raids.length ? 'それぞれ1回' : ''}起きれば到着 <b class="num">${amountsText(p.arriveWorst, scaled(keep))}</b></span>`
        : `<span class="bad">⚠ ${r}。起きると道中で食料が尽き、人足が離脱します。</span>`,
    );
  }
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
  const sec = $('order');
  const body = $('order-body');
  const c = selectedConvoy();
  if (!c || state.outcome !== 'playing') {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
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
      ...goodsOf(sc).map(
        (g) =>
          `<div class="row">積む${t(g.name)} <input data-good="${g.id}" type="range" min="0" max="${Math.min(here[g.id] ?? 0, cap)}" step="0.5" value="${goodsLoad[g.id] ?? 0}" /> <b data-good-val="${g.id}" class="num">${fmt(goodsLoad[g.id] ?? 0)}</b></div>`,
      ),
      `<div class="row"><button type="button" id="load-full">${goodsOf(sc).length ? '残りを米で満載' : `満載(${fmt(max)})`}</button>` +
        (goodsOf(sc).length ? '<button type="button" id="load-mix">陣の割合で満載</button>' : '') +
        `<button type="button" id="load-back" ${eat > max + EPS ? 'disabled' : ''}>帰り分だけ(${fmt(eat)})</button>` +
        (needsBuffer
          ? `<button type="button" id="load-safe" ${safe === null ? 'disabled' : ''}>荷を失っても尽きない分${safeNeed === null ? '' : `(${fmt(safeNeed)})`}</button>`
          : '') +
        '</div>',
      `<div id="preview" class="preview">${previewHtml(route.nodes)}</div>`,
      `<button type="button" id="btn-go" class="primary">出発させる</button>`,
    );
  }
  parts.push(autoBtn);
  body.innerHTML = parts.join('');
  bindAuto();

  body.querySelectorAll<HTMLButtonElement>('[data-dest]').forEach((b) => (b.onclick = () => setDest(b.dataset.dest!)));
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
setupShareDialog();
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
