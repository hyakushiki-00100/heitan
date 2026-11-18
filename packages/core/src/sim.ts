import { findLink, validateMap, type GameMap } from './map';
import { Rng } from './rng';
import { candidateRoutes, routeFromNodes, routeRisks, shortestRoute, type Route } from './route';
import type { LinkRisk } from './map';
import type { Scoring } from './score';
import { armyCapacity, eatenOver, maxLoad, type Army, type Convoy, type Move } from './unit';

export interface NodeSetup {
  /** 初期の米 */
  rice: number;
  /** 毎日の消費(軍勢の分とは別)。省略は0 */
  consumptionPerDay?: number;
}

export interface ArmySetup {
  /** 兵数 */
  troops: number;
  /** 兵1人が1日に食べる米 */
  ration: number;
  /** 兵1人が撤退時に持てる米 */
  capacityPer: number;
  /**
   * 撤退中、食べられなかった兵のうち1刻みで離脱する割合(0〜1)。省略時 0.25。
   * 1にすると「足りなければ即全員離脱」になり、少しの不足でも全滅するので厳しすぎる。
   */
  hungerDropRate?: number;
}

/** ルールカードの種類(動きはコード側で決まっていて、数値だけデータで変えられる) */
export type CardId = 'kiro' | 'chukei' | 'goei';
export const CARD_IDS: readonly CardId[] = ['kiro', 'chukei', 'goei'];

export interface CardDef {
  id: CardId;
  /** 画面に出す名前 */
  name: string;
  /** 画面に出す説明 */
  text: string;
  /** 効果の数値(カードごとに使う名前が決まっている。rules.ts / sim.ts 参照) */
  params: Record<string, number>;
}

export interface Scenario {
  id: string;
  title: string;
  /** 1刻みの日数(半日なら 0.5) */
  stepDays: number;
  /** 人足1人が一度に運べる米 */
  carrierCapacity: number;
  /** 人足1人が1日に食べる米 */
  carrierRation: number;
  map: GameMap;
  depotId: string;
  frontId: string;
  /** 何日陣を保ったら撤退を始めるか */
  goalDays: number;
  seed: number;
  nodes: Record<string, NodeSetup>;
  convoys: { id: string; name: string; carriers: number; at: string }[];
  /** 前線の軍勢。最初は frontId にいる */
  army: ArmySetup;
  /** 評価の重み。省略時は DEFAULT_SCORING */
  scoring?: Scoring;
  /** このシナリオで使えるルールカード。省略は無し */
  cards?: CardDef[];
}

/** playing=進行中 / done=撤退まで終えた / lost=陣の兵糧が尽きた */
export type Outcome = 'playing' | 'done' | 'lost';

export interface LogEntry {
  step: number;
  text: string;
}

export interface SimState {
  scenario: Scenario;
  step: number;
  rice: Record<string, number>;
  convoys: Convoy[];
  army: Army;
  log: LogEntry[];
  outcome: Outcome;
  rng: Rng;
  /** 有効にしているルールカード */
  activeCards: CardId[];
  /** 自動の隊が蔵から陣へ運ぶときの道(蔵→陣のノード列)。既定は日数最短 */
  autoRoute: string[];
}

/** 浮動小数の誤差を吸収する幅(米の量の比較に使う) */
const EPS = 1e-9;

const clean = (v: number): number => (v < EPS ? 0 : v);

/** シナリオデータの整合性を検査する。問題があれば Error を投げる。 */
export function validateScenario(sc: Scenario): void {
  validateMap(sc.map);
  const ids = new Set(sc.map.nodes.map((n) => n.id));
  if (!(sc.stepDays > 0)) throw new Error('stepDays は正の数');
  if (!(sc.carrierCapacity > 0)) throw new Error('carrierCapacity は正の数');
  if (!(sc.carrierRation >= 0)) throw new Error('carrierRation は0以上');
  if (!(sc.goalDays > 0)) throw new Error('goalDays は正の数');
  if (!ids.has(sc.depotId)) throw new Error(`depotId が地図にない: ${sc.depotId}`);
  if (!ids.has(sc.frontId)) throw new Error(`frontId が地図にない: ${sc.frontId}`);
  if (sc.depotId === sc.frontId) throw new Error('depotId と frontId は別の拠点にする');
  if (!shortestRoute(sc.map, sc.frontId, sc.depotId)) throw new Error('陣から蔵への道がない');
  for (const l of sc.map.links) {
    const steps = l.days / sc.stepDays;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
      throw new Error(`道の日数は1刻み(${sc.stepDays}日)の倍数にする: ${l.a}-${l.b} ${l.days}日`);
    }
  }
  for (const [id, n] of Object.entries(sc.nodes)) {
    if (!ids.has(id)) throw new Error(`nodes に地図にない拠点: ${id}`);
    if (!(n.rice >= 0)) throw new Error(`米は0以上: ${id}`);
    if (n.consumptionPerDay !== undefined && !(n.consumptionPerDay >= 0)) throw new Error(`消費は0以上: ${id}`);
  }
  const cids = new Set<string>();
  for (const c of sc.convoys) {
    if (cids.has(c.id)) throw new Error(`運搬隊IDが重複: ${c.id}`);
    cids.add(c.id);
    if (!ids.has(c.at)) throw new Error(`運搬隊の位置が地図にない: ${c.id} @ ${c.at}`);
    if (!(Number.isInteger(c.carriers) && c.carriers > 0)) throw new Error(`人足の数は正の整数: ${c.id}`);
  }
  const seenCards = new Set<string>();
  for (const c of sc.cards ?? []) {
    if (!CARD_IDS.includes(c.id)) throw new Error(`知らないルールカード: ${c.id}`);
    if (seenCards.has(c.id)) throw new Error(`ルールカードが重複: ${c.id}`);
    seenCards.add(c.id);
    for (const [k, v] of Object.entries(c.params)) if (!Number.isFinite(v)) throw new Error(`カードの数値が不正: ${c.id}.${k}`);
  }
  const a = sc.army;
  if (!a) throw new Error('army がない');
  if (!(Number.isInteger(a.troops) && a.troops > 0)) throw new Error('兵数は正の整数');
  if (!(a.ration >= 0)) throw new Error('兵の食事は0以上');
  if (!(a.capacityPer >= 0)) throw new Error('兵の携行量は0以上');
  if (a.hungerDropRate !== undefined && !(a.hungerDropRate > 0 && a.hungerDropRate <= 1)) {
    throw new Error('hungerDropRate は0より大きく1以下');
  }
}

/** 日数最短の道(同じ日数なら candidateRoutes と同じ順で決める) */
function defaultRoute(sc: Scenario, from: string, to: string): Route | null {
  return candidateRoutes(sc.map, from, to, 1)[0] ?? null;
}

/**
 * 遠征の初期状態を作る。seed を渡すとシナリオの seed の代わりに使う
 * (遊ぶたびに展開を変えたいとき。同じ seed なら同じ展開になる)。
 */
export function createState(scenario: Scenario, seed: number = scenario.seed): SimState {
  validateScenario(scenario);
  const rice: Record<string, number> = {};
  for (const n of scenario.map.nodes) rice[n.id] = scenario.nodes[n.id]?.rice ?? 0;
  const a = scenario.army;
  return {
    scenario,
    step: 0,
    rice,
    convoys: scenario.convoys.map((c) => ({ ...c, cargo: 0, move: null, dropped: false, auto: false })),
    army: {
      troops: a.troops,
      troopsTotal: a.troops,
      ration: a.ration,
      capacityPer: a.capacityPer,
      at: scenario.frontId,
      cargo: 0,
      move: null,
      retreatNodes: defaultRoute(scenario, scenario.frontId, scenario.depotId)!.nodes,
      phase: 'hold',
      dropped: 0,
    },
    log: [],
    outcome: 'playing',
    rng: new Rng(seed),
    activeCards: [],
    autoRoute: defaultRoute(scenario, scenario.depotId, scenario.frontId)!.nodes,
  };
}

export function currentDay(state: SimState): number {
  return state.step * state.scenario.stepDays;
}

/** カードが有効なら、その数値を返す。無効・シナリオに無いなら null */
export function cardParams(state: SimState, id: CardId): Record<string, number> | null {
  if (!state.activeCards.includes(id)) return null;
  return state.scenario.cards?.find((c) => c.id === id)?.params ?? null;
}

/** カードを有効/無効にする。シナリオに無いカードは拒否 */
export function setCardActive(state: SimState, id: CardId, on: boolean): boolean {
  if (!state.scenario.cards?.some((c) => c.id === id)) return false;
  state.activeCards = state.activeCards.filter((x) => x !== id);
  if (on) state.activeCards.push(id);
  return true;
}

/** 運搬隊を自動/手動に切り替える */
export function setAuto(state: SimState, convoyId: string, on: boolean): boolean {
  const c = state.convoys.find((x) => x.id === convoyId);
  if (!c || c.dropped) return false;
  c.auto = on;
  return true;
}

/**
 * その道を行く人足1人の1日の食事。
 * 護衛付きなら、危険な区間を含む道を行く隊にだけ護衛が付き、護衛の分だけ増える(安全な道では増えない)
 */
export function carrierRationOf(state: SimState, routeNodes: string[]): number {
  const goei = cardParams(state, 'goei');
  const base = state.scenario.carrierRation;
  if (!goei || routeRisks(state.scenario.map, routeNodes).length === 0) return base;
  return base * (goei.rationFactor ?? 1);
}

/** 道の危険が運搬隊に起きる確率(護衛付きなら下がる)。軍勢には護衛の効果はない */
export function convoyRiskChance(state: SimState, risk: LinkRisk): number {
  const goei = cardParams(state, 'goei');
  return risk.chance * (goei?.chanceFactor ?? 1);
}

function stepsForLeg(scenario: Scenario, a: string, b: string): number {
  const link = findLink(scenario.map, a, b);
  if (!link) throw new Error(`リンクがありません: ${a}-${b}`);
  return Math.max(1, Math.round(link.days / scenario.stepDays));
}

function startMove(scenario: Scenario, nodes: string[]): Move {
  const legSteps = stepsForLeg(scenario, nodes[0]!, nodes[1]!);
  return { route: nodes, leg: 0, stepsLeft: legSteps, legSteps };
}

/** 1刻み歩かせる。拠点に着いたらそのIDを返し、終点なら finished=true */
function advance(scenario: Scenario, mv: Move): { reached: string | null; finished: boolean } {
  mv.stepsLeft -= 1;
  if (mv.stepsLeft > 0) return { reached: null, finished: false };
  const reached = mv.route[mv.leg + 1]!;
  if (mv.leg + 2 < mv.route.length) {
    mv.leg += 1;
    mv.legSteps = stepsForLeg(scenario, reached, mv.route[mv.leg + 1]!);
    mv.stepsLeft = mv.legSteps;
    return { reached, finished: false };
  }
  return { reached, finished: true };
}

function nodeName(state: SimState, id: string): string {
  return state.scenario.map.nodes.find((n) => n.id === id)?.name ?? id;
}

function addLog(state: SimState, text: string): void {
  state.log.push({ step: state.step, text });
}

const r1 = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export type DispatchResult = { ok: true; route: Route } | { ok: false; error: string };

/**
 * 運搬隊を出発させる。load は拠点の米から積む量。
 * routeNodes を渡すとその道を通る(出発点と行き先が合っていること)。省略時は日数最短の道。
 */
export function dispatch(
  state: SimState,
  convoyId: string,
  destId: string,
  load: number,
  routeNodes?: string[],
): DispatchResult {
  if (state.outcome !== 'playing') return { ok: false, error: '遠征は終わっています' };
  const convoy = state.convoys.find((c) => c.id === convoyId);
  if (!convoy) return { ok: false, error: '運搬隊が見つかりません' };
  if (convoy.dropped) return { ok: false, error: '離脱した隊です' };
  if (convoy.move) return { ok: false, error: '移動中です' };
  if (convoy.at === destId) return { ok: false, error: '同じ拠点です' };
  const route = routeNodes ? routeFromNodes(state.scenario.map, routeNodes) : defaultRoute(state.scenario, convoy.at, destId);
  if (!route) return { ok: false, error: routeNodes ? '通れない道です' : '道がつながっていません' };
  if (route.nodes[0] !== convoy.at || route.nodes[route.nodes.length - 1] !== destId) {
    return { ok: false, error: '道の出発点か行き先が合っていません' };
  }
  if (!(load >= 0)) return { ok: false, error: '積み荷が不正です' };
  const cap = maxLoad(convoy, state.scenario.carrierCapacity);
  if (load > cap + EPS) return { ok: false, error: `積載上限(${cap})を超えています` };
  const have = state.rice[convoy.at] ?? 0;
  if (load > have + EPS) return { ok: false, error: `拠点の米(${r1(have)})が足りません` };

  state.rice[convoy.at] = clean(have - load);
  convoy.cargo = load;
  convoy.move = startMove(state.scenario, route.nodes);
  addLog(state, `${convoy.name}が${nodeName(state, convoy.at)}を出発(米${r1(load)})`);
  return { ok: true, route };
}

/** 撤退路(プレイヤーが選んだ道。既定は陣→蔵の日数最短) */
export function retreatRoute(state: SimState): Route {
  return routeFromNodes(state.scenario.map, state.army.retreatNodes)!;
}

/** 撤退路を選び直す。陣を保持している間だけ */
export function setRetreatRoute(state: SimState, nodes: string[]): { ok: true } | { ok: false; error: string } {
  const sc = state.scenario;
  if (state.army.phase !== 'hold') return { ok: false, error: '撤退が始まった後は変えられません' };
  const r = routeFromNodes(sc.map, nodes);
  if (!r || nodes[0] !== sc.frontId || nodes[nodes.length - 1] !== sc.depotId) return { ok: false, error: '陣から蔵への道ではありません' };
  state.army.retreatNodes = [...nodes];
  return { ok: true };
}

export interface TripPreview {
  route: Route;
  /** 道中で食べる量 */
  eat: number;
  /** 危険が何も起きなければ届く量(負なら道中で食料が尽きる) */
  arrive: number;
  /** 危険がすべて起きた場合に届く量(負なら道中で食料が尽きる) */
  arriveWorst: number;
  risks: { a: string; b: string; risk: LinkRisk }[];
}

/** 出発前の見積もり。危険が起きない場合と、全部起きた場合の両方を出す */
export function tripPreview(state: SimState, convoy: Convoy, nodes: string[], load: number): TripPreview | null {
  const sc = state.scenario;
  const route = routeFromNodes(sc.map, nodes);
  if (!route) return null;
  const perDay = convoy.carriers * carrierRationOf(state, nodes);
  let worst = load;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const link = findLink(sc.map, nodes[i]!, nodes[i + 1]!)!;
    worst -= perDay * link.days;
    if (worst < -EPS) break;
    if (link.risk) worst *= 1 - link.risk.loss;
  }
  const eat = eatenOver(convoy, carrierRationOf(state, nodes), route.days);
  return { route, eat, arrive: load - eat, arriveWorst: worst < -EPS ? worst : clean(Math.max(0, worst)), risks: routeRisks(sc.map, nodes) };
}

/**
 * 区間 from→to を通り抜けたときの危険の判定。起きたら積み荷を減らし、失った量を返す。
 * 乱数は state.rng から引くので、同じシード・同じ操作なら同じ結果になる。
 */
function applyRisk(state: SimState, from: string, to: string, holder: { cargo: number }, who: string, isConvoy: boolean): number {
  const link = findLink(state.scenario.map, from, to);
  if (!link?.risk) return 0;
  const chance = isConvoy ? convoyRiskChance(state, link.risk) : link.risk.chance;
  if (chance <= 0) return 0;
  if (state.rng.next() >= chance) return 0;
  const lost = holder.cargo * link.risk.loss;
  holder.cargo = clean(holder.cargo - lost);
  if (lost > 0) addLog(state, `${who}は${link.risk.label}で荷の${Math.round(link.risk.loss * 100)}%(米${r1(lost)})を失った`);
  return lost;
}

export interface RetreatPlan {
  route: Route;
  /** 撤退路の危険(見積もりには入れていない。起きれば足りなくなる) */
  risks: { a: string; b: string; risk: LinkRisk }[];
  /** 撤退に必要な米の合計(今の兵数で) */
  need: number;
  /** 兵が持てる上限 */
  capacity: number;
  /** 撤退開始時に陣から持ち出したい量 */
  fromFront: number;
  /**
   * 途中の拠点に置いておくべき量(足りている分は0)。
   * riskBuffer は、その拠点に入る直前の区間に危険がある場合に、危険が起きても足りるよう上乗せしたい量
   */
  stops: { id: string; required: number; have: number; riskBuffer: number }[];
}

/**
 * 撤退の見積もり。陣を出るときに持てるだけ持ち、
 * 途中の拠点で「上限まで、または残りの道のりに要る分まで」補給する前提で、
 * 各拠点に置いておくべき量を求める。
 */
export function retreatPlan(state: SimState): RetreatPlan {
  const sc = state.scenario;
  const a = state.army;
  const route = retreatRoute(state);
  const perDay = a.troops * a.ration;
  const capacity = armyCapacity(a);
  const need = perDay * route.days;
  const legDays: number[] = [];
  for (let i = 0; i + 1 < route.nodes.length; i++) legDays.push(findLink(sc.map, route.nodes[i]!, route.nodes[i + 1]!)!.days);
  let remaining = need;
  const fromFront = Math.min(capacity, remaining);
  let cargo = fromFront;
  const stops: RetreatPlan['stops'] = [];
  for (let i = 0; i < legDays.length; i++) {
    const eat = perDay * legDays[i]!;
    cargo -= eat;
    remaining -= eat;
    const id = route.nodes[i + 1]!;
    if (id === sc.depotId) break;
    const target = Math.min(capacity, remaining);
    const arriving = Math.max(0, cargo);
    const required = clean(target - arriving);
    const risk = findLink(sc.map, route.nodes[i]!, id)!.risk;
    // 危険が起きると、着いた時点の手持ちの loss 割合を失う。その分を置き米に足せば足りる
    const riskBuffer = risk && required > 0 ? clean(Math.min(arriving, target) * risk.loss) : 0;
    stops.push({ id, required, have: state.rice[id] ?? 0, riskBuffer });
    cargo = Math.max(cargo, target);
  }
  return { route, risks: routeRisks(sc.map, route.nodes), need, capacity, fromFront, stops };
}

/** 移動中の Move の、終点までの残り日数(区間の途中なら残り刻みで数える) */
export function remainingDays(sc: Scenario, mv: Move): number {
  let days = mv.stepsLeft * sc.stepDays;
  for (let i = mv.leg + 1; i + 1 < mv.route.length; i++) days += stepsForLeg(sc, mv.route[i]!, mv.route[i + 1]!) * sc.stepDays;
  return days;
}

/**
 * 軍勢が拠点で受け取る量。持てる上限と「残りの道のりに要る分」の小さい方まで。
 * 要る分を超えては受け取らない(多く置いた分はその場に残り、余剰として減点される)。
 */
function armyPickup(state: SimState, nodeId: string, remainingNeed: number): number {
  const a = state.army;
  const target = Math.min(armyCapacity(a), remainingNeed);
  const pick = Math.min(Math.max(0, target - a.cargo), state.rice[nodeId] ?? 0);
  if (pick <= EPS) return 0;
  state.rice[nodeId] = clean((state.rice[nodeId] ?? 0) - pick);
  a.cargo += pick;
  return pick;
}

/** 撤退中の軍勢が蔵に着くまでの残り日数。撤退中でなければ null */
export function armyDaysToHome(state: SimState): number | null {
  const mv = state.army.move;
  return state.army.phase === 'retreat' && mv ? remainingDays(state.scenario, mv) : null;
}

/**
 * 運搬隊が from から蔵へ帰るのに要る最小の米(道の危険がすべて起きても尽きない量)。
 * 道は日数最短。積める上限でも足りなければ上限を返す
 */
export function safeReturnFood(state: SimState, c: Convoy, from: string): number {
  const sc = state.scenario;
  const nodes = defaultRoute(sc, from, sc.depotId)?.nodes;
  if (!nodes) return 0;
  const cap = maxLoad(c, sc.carrierCapacity);
  const ok = (l: number) => (tripPreview(state, c, nodes, l)?.arriveWorst ?? -1) + EPS >= 0;
  if (!ok(cap)) return cap;
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.min(cap, Math.ceil(hi * 2 - EPS) / 2);
}

function startRetreat(state: SimState): void {
  const sc = state.scenario;
  const a = state.army;
  a.cargo = 0;
  a.move = startMove(sc, retreatRoute(state).nodes);
  // 帰路分を残す: 陣にいる運搬隊の帰り分には手を付けない(隊を陣に置き去りにしないため)
  let keep = 0;
  if (cardParams(state, 'kiro')) {
    for (const c of state.convoys) {
      if (!c.dropped && !c.move && c.at === a.at) keep += safeReturnFood(state, c, a.at);
    }
  }
  const before = state.rice[a.at] ?? 0;
  const usable = Math.max(0, before - keep);
  state.rice[a.at] = usable;
  const take = armyPickup(state, a.at, a.troops * a.ration * remainingDays(sc, a.move));
  state.rice[a.at] = clean((state.rice[a.at] ?? 0) + (before - usable));
  a.phase = 'retreat';
  addLog(
    state,
    `${sc.goalDays}日間、${nodeName(state, a.at)}を保った。撤退を始める(兵${a.troops}人・米${r1(take)}` +
      (keep > 0 ? `。運搬隊の帰り分${r1(Math.min(keep, before))}は残した)` : ')'),
  );
}

/** 撤退中の軍勢を1刻み進める */
function stepArmy(state: SimState): void {
  const sc = state.scenario;
  const a = state.army;
  const mv = a.move;
  if (a.phase !== 'retreat' || !mv) return;

  const perSoldier = a.ration * sc.stepDays;
  const need = a.troops * perSoldier;
  if (a.cargo + EPS >= need) {
    a.cargo = clean(a.cargo - need);
  } else {
    // 食べられる分だけ食べ、食べられなかった兵の一部が離脱する
    const fed = Math.floor((a.cargo + EPS) / perSoldier);
    const unfed = a.troops - fed;
    const rate = sc.army.hungerDropRate ?? 0.25;
    const out = Math.min(unfed, Math.ceil(unfed * rate - EPS));
    a.cargo = clean(a.cargo - fed * perSoldier);
    a.troops -= out;
    a.dropped += out;
    addLog(state, `撤退中に兵糧が足りず、兵${unfed}人が食べられなかった。うち${out}人が離脱した`);
    if (a.troops === 0) {
      a.phase = 'gone';
      a.at = mv.route[mv.leg]!;
      a.move = null;
      addLog(state, '軍勢は散り散りになった');
      return;
    }
  }

  const from = mv.route[mv.leg]!;
  const { reached, finished } = advance(sc, mv);
  if (!reached) return;
  a.at = reached;
  applyRisk(state, from, reached, a, '軍勢', false);
  if (finished) {
    state.rice[reached] = (state.rice[reached] ?? 0) + a.cargo;
    addLog(state, `軍勢が${nodeName(state, reached)}に戻った(兵${a.troops}人・残りの米${r1(a.cargo)}を納めた)`);
    a.cargo = 0;
    a.move = null;
    a.phase = 'home';
    return;
  }
  const pick = armyPickup(state, reached, a.troops * a.ration * remainingDays(sc, mv));
  if (pick > 0) {
    addLog(state, `軍勢が${nodeName(state, reached)}で米${r1(pick)}を受け取った`);
  }
}

/** 1刻み(既定は半日)進める。 */
export function step(state: SimState): void {
  if (state.outcome !== 'playing') return;
  const sc = state.scenario;
  state.step += 1;

  // 1. 運搬隊が食べて、進む
  for (const convoy of state.convoys) {
    const mv = convoy.move;
    if (!mv || convoy.dropped) continue;
    const need = eatenOver(convoy, carrierRationOf(state, mv.route), sc.stepDays);
    if (convoy.cargo + EPS < need) {
      addLog(state, `${convoy.name}は道中で食料が尽き、人足が離脱した(積み荷は失われた)`);
      convoy.cargo = 0;
      convoy.at = mv.route[mv.leg]!;
      convoy.move = null;
      convoy.dropped = true;
      continue;
    }
    convoy.cargo = clean(convoy.cargo - need);
    const from = mv.route[mv.leg]!;
    const { reached, finished } = advance(sc, mv);
    if (reached) {
      convoy.at = reached;
      applyRisk(state, from, reached, convoy, convoy.name, true);
    }
    if (finished) {
      state.rice[convoy.at] = (state.rice[convoy.at] ?? 0) + convoy.cargo;
      addLog(state, `${convoy.name}が${nodeName(state, convoy.at)}に到着(米${r1(convoy.cargo)}を納めた)`);
      convoy.cargo = 0;
      convoy.move = null;
    }
  }

  // 2. 軍勢: 保持中は陣の米を食べる。撤退中は持っている米を食べて進む
  const a = state.army;
  if (a.phase === 'hold') {
    const use = a.troops * a.ration * sc.stepDays;
    const have = state.rice[a.at] ?? 0;
    if (have + EPS < use) {
      state.rice[a.at] = 0;
      state.outcome = 'lost';
      addLog(state, `${nodeName(state, a.at)}の兵糧が尽きた。遠征は失敗`);
      return;
    }
    state.rice[a.at] = clean(have - use);
  } else {
    stepArmy(state);
  }

  // 3. 拠点そのものの消費(軍勢とは別。シナリオ01では使っていない)
  for (const n of sc.map.nodes) {
    const perDay = sc.nodes[n.id]?.consumptionPerDay ?? 0;
    if (perDay <= 0) continue;
    state.rice[n.id] = clean(Math.max(0, (state.rice[n.id] ?? 0) - perDay * sc.stepDays));
  }

  // 4. 撤退の開始と、遠征の終わり
  if (a.phase === 'hold' && currentDay(state) >= sc.goalDays) startRetreat(state);
  const armyDone = a.phase === 'home' || a.phase === 'gone';
  if (armyDone && !state.convoys.some((c) => c.move)) {
    state.outcome = 'done';
    addLog(state, '遠征は終わった');
  }
}

function movePosition(state: SimState, at: string, mv: Move | null, alpha: number): { x: number; y: number } {
  const nodes = state.scenario.map.nodes;
  const get = (id: string) => nodes.find((n) => n.id === id)!;
  if (!mv) {
    const n = get(at);
    return { x: n.x, y: n.y };
  }
  const a = get(mv.route[mv.leg]!);
  const b = get(mv.route[mv.leg + 1]!);
  const t = Math.min(1, (mv.legSteps - mv.stepsLeft + alpha) / mv.legSteps);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 運搬隊の現在位置(0〜100の描画座標)。移動中は区間を補間する。
 * alpha は次の刻みまでの進み具合(0〜1)。描画を滑らかにするためだけに使う。
 */
export function convoyPosition(state: SimState, convoy: Convoy, alpha = 0): { x: number; y: number } {
  return movePosition(state, convoy.at, convoy.move, alpha);
}

/** 軍勢の現在位置(描画座標) */
export function armyPosition(state: SimState, alpha = 0): { x: number; y: number } {
  return movePosition(state, state.army.at, state.army.move, alpha);
}
