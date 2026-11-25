import { findLink, validateMap, type GameMap } from './map';
import { Rng } from './rng';
import { candidateRoutes, routeFromNodes, routeRaids, routeRisks, shortestRoute, type Route } from './route';
import type { LinkRaid, LinkRisk } from './map';
import type { Scoring } from './score';
import { armyCapacity, eatenOver, maxLoad, type Army, type Convoy, type Move } from './unit';

export interface NodeSetup {
  /** 初期の米 */
  rice: number;
  /** 初期の米以外の物資(物資ID → 量)。省略は0 */
  goods?: Record<string, number>;
  /** 毎日の米の消費(軍勢の分とは別)。省略は0 */
  consumptionPerDay?: number;
  /** 市(米を買える)。省略は市なし */
  market?: MarketSetup;
}

/**
 * 市。米を買える。買うほど米価が上がり、払った額は「村への負担」として減点になる。
 * 米価 = basePrice × (1 + priceRise × これまでに買った量 / rice)
 */
export interface MarketSetup {
  /** 売ってくれる米の量 */
  rice: number;
  /** 最初の米価(米1あたりの負担) */
  basePrice: number;
  /** 売り切ったときに米価が何倍ぶん上がるか(1なら最後は2倍) */
  priceRise: number;
}

/**
 * 米以外の物資の働き。
 * cook: 欠けると米があっても食べられない(薪)。米が尽きたのと同じ扱い
 * health: 欠けるとすぐには困らないが、不足が続くと兵が体を壊して少しずつ離脱する(塩・味噌)
 * fodder: 馬だけが食べる(飼い葉)。兵は使わない。道中で尽きると、馬は荷を運べなくなる
 */
export type GoodKind = 'cook' | 'health' | 'fodder';

/** 米以外の物資。兵だけが使う(人足は米だけを食べ、薪は道中で拾える、という簡略化) */
export interface GoodDef {
  id: string;
  name: string;
  kind: GoodKind;
  /** 兵1人が1日に使う量(fodder では 0) */
  perTroopPerDay: number;
}

/** 荷を運ぶ馬 */
export interface HorseSetup {
  /** 1頭が運べる量 */
  capacity: number;
  /** 1頭が1日に食べる飼い葉 */
  fodderPerDay: number;
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
  /** 最初の撤退路(陣から蔵までの拠点の列)。省略時は日数の最も短い道 */
  retreat?: string[];
  /**
   * health の物資が足りないとき、兵のうち1日に体を壊して離脱する割合(不足の割合を掛ける)。省略時 0.02。
   * 端数は持ち越すので、少しの不足でも長く続けば離脱が出る
   */
  healthDropPerDay?: number;
}

/** ルールカードの種類(動きはコード側で決まっていて、数値だけデータで変えられる) */
export type CardId = 'kiro' | 'chukei' | 'goei' | 'genchi';
export const CARD_IDS: readonly CardId[] = ['kiro', 'chukei', 'goei', 'genchi'];

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
  convoys: { id: string; name: string; carriers: number; horses?: number; at: string }[];
  /** 馬の性質。馬を使う隊があるシナリオでは必須 */
  horse?: HorseSetup;
  /** 前線の軍勢。最初は frontId にいる */
  army: ArmySetup;
  /** 評価の重み。省略時は DEFAULT_SCORING */
  scoring?: Scoring;
  /** このシナリオで使えるルールカード。省略は無し */
  cards?: CardDef[];
  /** 米以外の物資。省略は米だけ */
  goods?: GoodDef[];
  /** ★1・★2・★3 になる得点の割合(満点に対する)。省略時は DEFAULT_STAR_THRESHOLDS */
  starThresholds?: [number, number, number];
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
  /** 拠点ごとの米 */
  rice: Record<string, number>;
  /** 米以外の物資: 物資ID → 拠点ID → 量 */
  goods: Record<string, Record<string, number>>;
  convoys: Convoy[];
  army: Army;
  log: LogEntry[];
  outcome: Outcome;
  rng: Rng;
  /** 有効にしているルールカード */
  activeCards: CardId[];
  /** 自動の隊が蔵から陣へ運ぶときの道(蔵→陣のノード列)。既定は日数最短 */
  autoRoute: string[];
  /**
   * 物資の帳簿('rice' と物資ID → 量)。どこにも消えずに合計が合うかを確かめるために持つ。
   * 最初の量 = 拠点 + 運搬中 + 軍勢の手持ち + eaten + lost
   */
  ledger: {
    initial: Record<string, number>;
    /** 市で買った量(最初の量に足して合計を確かめる) */
    bought: Record<string, number>;
    eaten: Record<string, number>;
    lost: Record<string, number>;
  };
  /** 市の状態(拠点ID → 残り・買った量) */
  markets: Record<string, { left: number; bought: number }>;
  /** 村の運び手が届ける途中の米(現地調達) */
  orders: { from: string; to: string; rice: number; arriveStep: number }[];
  /** 市で払った額の合計(村への負担。減点になる) */
  purchaseBurden: number;
  /** 記録用の数え上げ(評価・調整用) */
  stats: { hungerSteps: number; starvedNode: string | null };
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
  if (sc.army.retreat) {
    const r = sc.army.retreat;
    if (!routeFromNodes(sc.map, r) || r[0] !== sc.frontId || r[r.length - 1] !== sc.depotId) throw new Error('army.retreat が陣から蔵への道になっていない');
  }
  if (!shortestRoute(sc.map, sc.frontId, sc.depotId)) throw new Error('陣から蔵への道がない');
  for (const l of sc.map.links) {
    const steps = l.days / sc.stepDays;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
      throw new Error(`道の日数は1刻み(${sc.stepDays}日)の倍数にする: ${l.a}-${l.b} ${l.days}日`);
    }
  }
  const goodIds = new Set<string>();
  for (const g of sc.goods ?? []) {
    if (g.id === 'rice' || goodIds.has(g.id)) throw new Error(`物資IDが重複: ${g.id}`);
    goodIds.add(g.id);
    if (g.kind !== 'cook' && g.kind !== 'health' && g.kind !== 'fodder') throw new Error(`物資の働きが不正: ${g.id}`);
    if (!(g.perTroopPerDay >= 0)) throw new Error(`物資の消費は0以上: ${g.id}`);
    if (g.kind === 'fodder' && g.perTroopPerDay !== 0) throw new Error(`飼い葉は兵が使わない(perTroopPerDay は0): ${g.id}`);
  }
  if ((sc.goods ?? []).filter((g) => g.kind === 'fodder').length > 1) throw new Error('飼い葉(fodder)は1種類まで');
  for (const [id, n] of Object.entries(sc.nodes)) {
    if (!ids.has(id)) throw new Error(`nodes に地図にない拠点: ${id}`);
    if (!(n.rice >= 0)) throw new Error(`米は0以上: ${id}`);
    for (const [g, v] of Object.entries(n.goods ?? {})) {
      if (!goodIds.has(g)) throw new Error(`知らない物資: ${id}.${g}`);
      if (!(v >= 0)) throw new Error(`物資は0以上: ${id}.${g}`);
    }
    if (n.market) {
      const m = n.market;
      if (!(m.rice > 0 && m.basePrice >= 0 && m.priceRise >= 0)) throw new Error(`市の値が不正: ${id}`);
      if (id === sc.depotId) throw new Error('蔵には市を置かない');
    }
    if (n.consumptionPerDay !== undefined && !(n.consumptionPerDay >= 0)) throw new Error(`消費は0以上: ${id}`);
  }
  const cids = new Set<string>();
  for (const c of sc.convoys) {
    if (cids.has(c.id)) throw new Error(`運搬隊IDが重複: ${c.id}`);
    cids.add(c.id);
    if (!ids.has(c.at)) throw new Error(`運搬隊の位置が地図にない: ${c.id} @ ${c.at}`);
    if (!(Number.isInteger(c.carriers) && c.carriers > 0)) throw new Error(`人足の数は正の整数: ${c.id}`);
    if (c.horses !== undefined && !(Number.isInteger(c.horses) && c.horses >= 0)) throw new Error(`馬の数は0以上の整数: ${c.id}`);
    if ((c.horses ?? 0) > 0) {
      if (!sc.horse || !(sc.horse.capacity > 0) || !(sc.horse.fodderPerDay >= 0)) throw new Error(`馬を使うなら horse(capacity, fodderPerDay)が要る: ${c.id}`);
      if (!(sc.goods ?? []).some((g) => g.kind === 'fodder')) throw new Error(`馬を使うなら飼い葉(kind: fodder)の物資が要る: ${c.id}`);
    }
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
  if (a.healthDropPerDay !== undefined && !(a.healthDropPerDay >= 0 && a.healthDropPerDay <= 1)) {
    throw new Error('healthDropPerDay は0以上1以下');
  }
}

/** シナリオの米以外の物資(無ければ空) */
export function goodsOf(sc: Scenario): GoodDef[] {
  return sc.goods ?? [];
}

/** 飼い葉の物資(無ければ null) */
export function fodderGood(sc: Scenario): GoodDef | null {
  return goodsOf(sc).find((g) => g.kind === 'fodder') ?? null;
}

/** 運搬隊が1回に運べる上限(人足の分 + 馬の分) */
export function convoyCapacity(state: SimState, c: Convoy): number {
  return maxLoad(c, state.scenario.carrierCapacity, state.scenario.horse?.capacity ?? 0);
}

/** 運搬隊の馬が days 日に食べる飼い葉 */
export function fodderFor(state: SimState, c: Convoy, days: number): number {
  return c.horses * (state.scenario.horse?.fodderPerDay ?? 0) * days;
}

/** 物資の量の合計(重さ。どの物資も1単位=1) */
export function goodsWeight(g: Record<string, number>): number {
  let w = 0;
  for (const v of Object.values(g)) w += v;
  return w;
}

/** 軍勢が1日に使う量(米と物資ごと)。今の兵数で */
export function armyDailyNeed(state: SimState): { rice: number; goods: Record<string, number> } {
  const a = state.army;
  const goods: Record<string, number> = {};
  for (const g of goodsOf(state.scenario)) if (g.kind !== 'fodder') goods[g.id] = a.troops * g.perTroopPerDay;
  return { rice: a.troops * a.ration, goods };
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
  const goods: Record<string, Record<string, number>> = {};
  const emptyGoods = () => Object.fromEntries(goodsOf(scenario).map((g) => [g.id, 0])) as Record<string, number>;
  for (const g of goodsOf(scenario)) {
    goods[g.id] = {};
    for (const n of scenario.map.nodes) goods[g.id]![n.id] = scenario.nodes[n.id]?.goods?.[g.id] ?? 0;
  }
  const a = scenario.army;
  return {
    scenario,
    step: 0,
    rice,
    goods,
    convoys: scenario.convoys.map((c) => ({
      ...c,
      horses: c.horses ?? 0,
      horsesTired: false,
      cargo: 0,
      goods: emptyGoods(),
      move: null,
      dropped: false,
      auto: false,
    })),
    army: {
      troops: a.troops,
      troopsTotal: a.troops,
      ration: a.ration,
      capacityPer: a.capacityPer,
      at: scenario.frontId,
      cargo: 0,
      goods: emptyGoods(),
      healthDebt: 0,
      move: null,
      retreatNodes: scenario.army.retreat ? [...scenario.army.retreat] : defaultRoute(scenario, scenario.frontId, scenario.depotId)!.nodes,
      phase: 'hold',
      dropped: 0,
    },
    log: [],
    outcome: 'playing',
    rng: new Rng(seed),
    activeCards: [],
    autoRoute: defaultRoute(scenario, scenario.depotId, scenario.frontId)!.nodes,
    markets: Object.fromEntries(
      Object.entries(scenario.nodes)
        .filter(([, n]) => n.market)
        .map(([id, n]) => [id, { left: n.market!.rice, bought: 0 }]),
    ),
    orders: [],
    purchaseBurden: 0,
    ledger: {
      initial: Object.fromEntries(['rice', ...goodsOf(scenario).map((g) => g.id)].map((r) => [r, totalOf(r === 'rice' ? rice : goods[r]!)])),
      bought: Object.fromEntries(['rice', ...goodsOf(scenario).map((g) => g.id)].map((r) => [r, 0])),
      eaten: Object.fromEntries(['rice', ...goodsOf(scenario).map((g) => g.id)].map((r) => [r, 0])),
      lost: Object.fromEntries(['rice', ...goodsOf(scenario).map((g) => g.id)].map((r) => [r, 0])),
    },
    stats: { hungerSteps: 0, starvedNode: null },
  };
}

const totalOf = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

/**
 * 物資の合計が合っているか。合っていなければ、ずれている物資とその量を返す(合っていれば空)。
 * 最初の量 + 市で買った量 = 拠点 + 運搬中 + 軍勢の手持ち + 村の運び手が届ける途中 + 食べた・使った量 + 失った量
 */
export function ledgerMismatch(state: SimState, tolerance = 1e-6): { res: string; diff: number }[] {
  const out: { res: string; diff: number }[] = [];
  for (const res of Object.keys(state.ledger.initial)) {
    let now = res === 'rice' ? totalOf(state.rice) : totalOf(state.goods[res]!);
    for (const c of state.convoys) now += res === 'rice' ? c.cargo : (c.goods[res] ?? 0);
    now += res === 'rice' ? state.army.cargo : (state.army.goods[res] ?? 0);
    if (res === 'rice') for (const o of state.orders) now += o.rice;
    const diff = state.ledger.initial[res]! + state.ledger.bought[res]! - (now + state.ledger.eaten[res]! + state.ledger.lost[res]!);
    if (Math.abs(diff) > tolerance) out.push({ res, diff });
  }
  return out;
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
  const dangerous = routeRisks(state.scenario.map, routeNodes).length > 0 || routeRaids(state.scenario.map, routeNodes).length > 0;
  if (!goei || !dangerous) return base;
  return base * (goei.rationFactor ?? 1);
}

/** 道の危険が運搬隊に起きる確率(護衛付きなら下がる)。軍勢には護衛の効果はない */
export function convoyRiskChance(state: SimState, risk: LinkRisk): number {
  const goei = cardParams(state, 'goei');
  return risk.chance * (goei?.chanceFactor ?? 1);
}

/** 襲撃が運搬隊に起きる、半日(1刻み)あたりの確率(護衛付きなら下がる) */
export function convoyRaidChance(state: SimState, raid: LinkRaid): number {
  const goei = cardParams(state, 'goei');
  return Math.min(1, raid.chancePerDay * state.scenario.stepDays * (goei?.chanceFactor ?? 1));
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

/** 積み荷の説明(例: 米50・薪10) */
function cargoText(state: SimState, rice: number, goods: Record<string, number>): string {
  const parts = [`米${r1(rice)}`];
  for (const g of goodsOf(state.scenario)) if ((goods[g.id] ?? 0) > EPS) parts.push(`${g.name}${r1(goods[g.id]!)}`);
  return parts.join('・');
}

/**
 * 運搬隊を出発させる。load は拠点の米から積む量、goods は米以外の物資(物資ID → 量)。
 * 積める上限は米と物資の合計にかかる。
 * routeNodes を渡すとその道を通る(出発点と行き先が合っていること)。省略時は日数最短の道。
 */
export function dispatch(
  state: SimState,
  convoyId: string,
  destId: string,
  load: number,
  routeNodes?: string[],
  goods: Record<string, number> = {},
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
  const defs = goodsOf(state.scenario);
  for (const [id, v] of Object.entries(goods)) {
    const def = defs.find((g) => g.id === id);
    if (!def) return { ok: false, error: `知らない物資です: ${id}` };
    if (!(v >= 0)) return { ok: false, error: '積み荷が不正です' };
    const haveG = state.goods[id]![convoy.at] ?? 0;
    if (v > haveG + EPS) return { ok: false, error: `拠点の${def.name}(${r1(haveG)})が足りません` };
  }
  const cap = convoyCapacity(state, convoy);
  if (load + goodsWeight(goods) > cap + EPS) return { ok: false, error: `積載上限(${cap})を超えています` };
  const have = state.rice[convoy.at] ?? 0;
  if (load > have + EPS) return { ok: false, error: `拠点の米(${r1(have)})が足りません` };

  state.rice[convoy.at] = clean(have - load);
  convoy.cargo = load;
  for (const g of defs) {
    const v = goods[g.id] ?? 0;
    state.goods[g.id]![convoy.at] = clean((state.goods[g.id]![convoy.at] ?? 0) - v);
    convoy.goods[g.id] = v;
  }
  convoy.move = startMove(state.scenario, route.nodes);
  convoy.horsesTired = false;
  addLog(state, `${convoy.name}が${nodeName(state, convoy.at)}を出発(${cargoText(state, load, goods)})`);
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
  /** 馬が道中で食べる飼い葉(馬がいなければ0) */
  fodderNeed: number;
  risks: { a: string; b: string; risk: LinkRisk }[];
  /** 道の襲撃(見積もりの最悪値は、区間ごとに1回襲われた場合) */
  raids: { a: string; b: string; days: number; raid: LinkRaid }[];
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
    // 襲撃は何度も起こりうるが、見積もりの「最悪」は区間ごとに1回襲われた場合とする
    if (link.raid) worst *= 1 - link.raid.loss;
  }
  const eat = eatenOver(convoy, carrierRationOf(state, nodes), route.days);
  return {
    route,
    eat,
    arrive: load - eat,
    arriveWorst: worst < -EPS ? worst : clean(Math.max(0, worst)),
    fodderNeed: fodderFor(state, convoy, route.days),
    risks: routeRisks(sc.map, nodes),
    raids: routeRaids(sc.map, nodes),
  };
}

/**
 * 区間 from→to を通り抜けたときの危険の判定。起きたら積み荷を減らし、失った量を返す。
 * 乱数は state.rng から引くので、同じシード・同じ操作なら同じ結果になる。
 */
function applyRisk(
  state: SimState,
  from: string,
  to: string,
  holder: { cargo: number; goods: Record<string, number> },
  who: string,
  isConvoy: boolean,
): number {
  const link = findLink(state.scenario.map, from, to);
  if (!link?.risk) return 0;
  const chance = isConvoy ? convoyRiskChance(state, link.risk) : link.risk.chance;
  if (chance <= 0) return 0;
  if (state.rng.next() >= chance) return 0;
  return applyLoss(state, holder, link.risk.loss, `${who}は${link.risk.label}で荷の${Math.round(link.risk.loss * 100)}%`);
}

/** 積み荷(米と物資)を loss の割合だけ失わせ、帳簿に記録し、失った量を返す。what はログの書き出し */
function applyLoss(state: SimState, holder: { cargo: number; goods: Record<string, number> }, loss: number, what: string): number {
  const before = holder.cargo;
  holder.cargo = clean(holder.cargo - holder.cargo * loss);
  const lost = before - holder.cargo;
  state.ledger.lost.rice! += lost;
  const lostGoods: Record<string, number> = {};
  for (const id of Object.keys(holder.goods)) {
    const b = holder.goods[id]!;
    holder.goods[id] = clean(b - b * loss);
    lostGoods[id] = b - holder.goods[id]!;
    state.ledger.lost[id] = (state.ledger.lost[id] ?? 0) + lostGoods[id]!;
  }
  const total = lost + goodsWeight(lostGoods);
  if (total > 0) addLog(state, `${what}(${cargoText(state, lost, lostGoods)})を失った`);
  return total;
}

/** 移動中の運搬隊が、今いる区間で襲撃に遭うかの判定(半日ごと) */
function applyRaid(state: SimState, c: Convoy): void {
  const mv = c.move;
  if (!mv) return;
  const link = findLink(state.scenario.map, mv.route[mv.leg]!, mv.route[mv.leg + 1]!);
  if (!link?.raid) return;
  const chance = convoyRaidChance(state, link.raid);
  if (chance <= 0 || state.rng.next() >= chance) return;
  if (c.cargo + goodsWeight(c.goods) <= EPS) return;
  applyLoss(state, c, link.raid.loss, `${c.name}は${link.raid.label}に襲われ、荷の${Math.round(link.raid.loss * 100)}%`);
}

export interface RetreatPlan {
  route: Route;
  /**
   * 米と物資の割合(1日に使う量の比)。need・capacity・fromFront・stops は米と物資の合計(重さ)で、
   * 物資ごとの量はこの割合を掛けて求める。米だけのシナリオなら { rice: 1 }
   */
  shares: Record<string, number>;
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
   * have は、その拠点にある米と物資を割合どおりに揃えたときの量(いちばん足りない物資で決まる)。
   * riskBuffer は、その拠点に入る直前の区間に危険がある場合に、危険が起きても足りるよう上乗せしたい量
   */
  stops: { id: string; required: number; have: number; riskBuffer: number }[];
}

/**
 * 撤退の見積もり。陣を出るときに持てるだけ持ち、
 * 途中の拠点で「上限まで、または残りの道のりに要る分まで」補給する前提で、
 * 各拠点に置いておくべき量を求める。
 */
/** 拠点にある米と物資(物資ID → 量。米は 'rice') */
export function nodeAmounts(state: SimState, id: string): Record<string, number> {
  const out: Record<string, number> = { rice: state.rice[id] ?? 0 };
  for (const g of goodsOf(state.scenario)) out[g.id] = state.goods[g.id]![id] ?? 0;
  return out;
}

/** 米と物資を shares の割合で揃えたとき、何単位分あるか(いちばん足りないもので決まる) */
function setsOf(amounts: Record<string, number>, shares: Record<string, number>): number {
  let n = Infinity;
  for (const [id, sh] of Object.entries(shares)) if (sh > 0) n = Math.min(n, (amounts[id] ?? 0) / sh);
  return n === Infinity ? 0 : n;
}

/** 撤退で使う米と物資の割合 */
function retreatShares(state: SimState): Record<string, number> {
  const d = armyDailyNeed(state);
  const total = d.rice + goodsWeight(d.goods);
  const shares: Record<string, number> = { rice: total > 0 ? d.rice / total : 1 };
  for (const [id, v] of Object.entries(d.goods)) shares[id] = total > 0 ? v / total : 0;
  return shares;
}

export function retreatPlan(state: SimState): RetreatPlan {
  const sc = state.scenario;
  const route = retreatRoute(state);
  const daily = armyDailyNeed(state);
  const perDay = daily.rice + goodsWeight(daily.goods);
  const shares = retreatShares(state);
  const capacity = armyCapacity(state.army);
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
    stops.push({ id, required, have: setsOf(nodeAmounts(state, id), shares), riskBuffer });
    cargo = Math.max(cargo, target);
  }
  return { route, shares, risks: routeRisks(sc.map, route.nodes), need, capacity, fromFront, stops };
}

/** 移動中の Move の、終点までの残り日数(区間の途中なら残り刻みで数える) */
export function remainingDays(sc: Scenario, mv: Move): number {
  let days = mv.stepsLeft * sc.stepDays;
  for (let i = mv.leg + 1; i + 1 < mv.route.length; i++) days += stepsForLeg(sc, mv.route[i]!, mv.route[i + 1]!) * sc.stepDays;
  return days;
}

/**
 * 軍勢が拠点で受け取る。米と物資それぞれ「残りの道のりに要る分」まで受け取り、
 * 合計が持てる上限を超えるなら、どれも同じ割合で減らす。
 * 要る分を超えては受け取らない(多く置いた分はその場に残り、余剰として減点される)。
 * 受け取った量(米, 物資)を返す
 */
function armyPickup(state: SimState, nodeId: string, days: number): { rice: number; goods: Record<string, number> } {
  const a = state.army;
  const d = armyDailyNeed(state);
  const want: Record<string, number> = {
    rice: Math.min(Math.max(0, d.rice * days - a.cargo), state.rice[nodeId] ?? 0),
  };
  for (const g of goodsOf(state.scenario)) {
    want[g.id] = Math.min(Math.max(0, (d.goods[g.id] ?? 0) * days - (a.goods[g.id] ?? 0)), state.goods[g.id]![nodeId] ?? 0);
  }
  const room = Math.max(0, armyCapacity(a) - a.cargo - goodsWeight(a.goods));
  const total = goodsWeight(want);
  const scale = total > room ? room / total : 1;
  const got = { rice: clean(want.rice! * scale), goods: {} as Record<string, number> };
  state.rice[nodeId] = clean((state.rice[nodeId] ?? 0) - got.rice);
  a.cargo += got.rice;
  for (const g of goodsOf(state.scenario)) {
    const v = clean(want[g.id]! * scale);
    got.goods[g.id] = v;
    state.goods[g.id]![nodeId] = clean((state.goods[g.id]![nodeId] ?? 0) - v);
    a.goods[g.id] = (a.goods[g.id] ?? 0) + v;
  }
  return got;
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
  const cap = convoyCapacity(state, c);
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
  const take = armyPickup(state, a.at, remainingDays(sc, a.move));
  state.rice[a.at] = clean((state.rice[a.at] ?? 0) + (before - usable));
  a.phase = 'retreat';
  addLog(
    state,
    `${sc.goalDays}日間、${nodeName(state, a.at)}を保った。撤退を始める(兵${a.troops}人・${cargoText(state, take.rice, take.goods)}` +
      (keep > 0 ? `。運搬隊の帰り分${r1(Math.min(keep, before))}は残した)` : ')'),
  );
}

/** 撤退中の軍勢を1刻み進める */
function stepArmy(state: SimState): void {
  const sc = state.scenario;
  const a = state.army;
  const mv = a.move;
  if (a.phase !== 'retreat' || !mv) return;

  const pool: FoodPool = {
    get: (id) => (id === 'rice' ? a.cargo : (a.goods[id] ?? 0)),
    set: (id, v) => {
      if (id === 'rice') a.cargo = v;
      else a.goods[id] = v;
    },
  };
  const fed = feedArmy(state, pool);
  if (fed < a.troops) {
    // 食べられなかった兵の一部が離脱する
    state.stats.hungerSteps += 1;
    const unfed = a.troops - fed;
    const rate = sc.army.hungerDropRate ?? 0.25;
    const out = Math.min(unfed, Math.ceil(unfed * rate - EPS));
    a.troops -= out;
    a.dropped += out;
    addLog(state, `撤退中に${shortNames(state, pool)}が足りず、兵${unfed}人が食べられなかった。うち${out}人が離脱した`);
  }
  if (a.troops === 0) {
    a.phase = 'gone';
    a.at = mv.route[mv.leg]!;
    a.move = null;
    addLog(state, '軍勢は散り散りになった');
    return;
  }

  const from = mv.route[mv.leg]!;
  const { reached, finished } = advance(sc, mv);
  if (!reached) return;
  a.at = reached;
  applyRisk(state, from, reached, a, '軍勢', false);
  if (finished) {
    state.rice[reached] = (state.rice[reached] ?? 0) + a.cargo;
    for (const g of goodsOf(sc)) state.goods[g.id]![reached] = (state.goods[g.id]![reached] ?? 0) + (a.goods[g.id] ?? 0);
    addLog(state, `軍勢が${nodeName(state, reached)}に戻った(兵${a.troops}人・残りの${cargoText(state, a.cargo, a.goods)}を納めた)`);
    a.cargo = 0;
    for (const g of goodsOf(sc)) a.goods[g.id] = 0;
    a.move = null;
    a.phase = 'home';
    return;
  }
  const pick = armyPickup(state, reached, remainingDays(sc, mv));
  if (pick.rice + goodsWeight(pick.goods) > 0) {
    addLog(state, `軍勢が${nodeName(state, reached)}で${cargoText(state, pick.rice, pick.goods)}を受け取った`);
  }
}

/** 軍勢が食べる元(陣の蔵、または撤退中の手持ち)。'rice' は米 */
interface FoodPool {
  get(id: string): number;
  set(id: string, v: number): void;
}

/** 足りない物の名前(米と cook の物資のうち、半日分に満たないもの) */
function shortNames(state: SimState, pool: FoodPool): string {
  const a = state.army;
  const dt = state.scenario.stepDays;
  const names: string[] = [];
  if (pool.get('rice') + EPS < a.ration * dt) names.push('兵糧');
  for (const g of goodsOf(state.scenario)) {
    if (g.kind === 'cook' && pool.get(g.id) + EPS < g.perTroopPerDay * dt) names.push(g.name);
  }
  return names.length ? names.join('と') : '兵糧';
}

/**
 * 軍勢に半日分を食べさせ、食べられた兵の数を返す。
 * 米と cook の物資(薪)は1人分ずつ揃わないと食べられない。揃った人数だけ食べ、その分を減らす。
 * health の物資(塩・味噌)は、足りない割合に応じて「体を壊す」端数をためて、1人分たまるごとに離脱させる
 */
function feedArmy(state: SimState, pool: FoodPool): number {
  const sc = state.scenario;
  const a = state.army;
  const dt = sc.stepDays;
  let fed = a.troops;
  const perRice = a.ration * dt;
  if (perRice > 0) fed = Math.min(fed, Math.floor((pool.get('rice') + EPS) / perRice));
  for (const g of goodsOf(sc)) {
    const per = g.perTroopPerDay * dt;
    if (g.kind === 'cook' && per > 0) fed = Math.min(fed, Math.floor((pool.get(g.id) + EPS) / per));
  }
  /** 減らして、実際に減った量を帳簿の「食べた・使った」に足す(clean で切り捨てた端数も含める) */
  const use = (id: string, amount: number) => {
    const before = pool.get(id);
    pool.set(id, clean(before - amount));
    state.ledger.eaten[id] = (state.ledger.eaten[id] ?? 0) + (before - pool.get(id));
  };
  use('rice', fed * perRice);
  for (const g of goodsOf(sc)) {
    if (g.kind === 'cook') use(g.id, fed * g.perTroopPerDay * dt);
  }
  // health の物資: 食べた兵の分だけ使う。足りなければ不足の割合だけ体を壊す端数がたまる
  let shortFrac = 0;
  for (const g of goodsOf(sc)) {
    if (g.kind !== 'health') continue;
    const need = fed * g.perTroopPerDay * dt;
    if (need <= 0) continue;
    const have = pool.get(g.id);
    const take = Math.min(have, need);
    use(g.id, take);
    shortFrac = Math.max(shortFrac, 1 - take / need);
  }
  if (shortFrac > EPS) {
    a.healthDebt += fed * (sc.army.healthDropPerDay ?? 0.02) * dt * shortFrac;
    const out = Math.min(a.troops, Math.floor(a.healthDebt + EPS));
    if (out > 0) {
      a.healthDebt -= out;
      a.troops -= out;
      a.dropped += out;
      const names = goodsOf(sc).filter((g) => g.kind === 'health').map((g) => g.name).join('・');
      addLog(state, `${names}が足りず、兵${out}人が体を壊して離脱した`);
      return Math.min(fed, a.troops);
    }
  }
  return fed;
}

/** 市の今の米価(米1あたりの負担)。市がなければ null */
export function marketPrice(state: SimState, nodeId: string): number | null {
  const setup = state.scenario.nodes[nodeId]?.market;
  const m = state.markets[nodeId];
  if (!setup || !m) return null;
  return setup.basePrice * (1 + (setup.priceRise * m.bought) / setup.rice);
}

/** 市で amount 買ったときに払う額(米価は買いながら上がるので、買う前と後の米価の平均を掛ける) */
export function purchaseCost(state: SimState, nodeId: string, amount: number): number {
  const setup = state.scenario.nodes[nodeId]?.market;
  const m = state.markets[nodeId];
  if (!setup || !m) return Infinity;
  return amount * setup.basePrice * (1 + (setup.priceRise * (m.bought + amount / 2)) / setup.rice);
}

/** 市で米を買う。後でどこへ置くかは呼ぶ側が決める(内部用) */
function takeFromMarket(state: SimState, nodeId: string, amount: number): { ok: true; cost: number } | { ok: false; error: string } {
  const m = state.markets[nodeId];
  if (state.outcome !== 'playing') return { ok: false, error: '遠征は終わっています' };
  if (!m) return { ok: false, error: '市がありません' };
  if (!(amount > 0)) return { ok: false, error: '買う量が不正です' };
  if (amount > m.left + EPS) return { ok: false, error: `市の米(${r1(m.left)})が足りません` };
  const before = marketPrice(state, nodeId)!;
  const cost = purchaseCost(state, nodeId, amount);
  m.left = clean(m.left - amount);
  m.bought += amount;
  state.purchaseBurden += cost;
  state.ledger.bought.rice! += amount;
  addLog(
    state,
    `${nodeName(state, nodeId)}の市で米${r1(amount)}を買った(米価 ${before.toFixed(2)}→${marketPrice(state, nodeId)!.toFixed(2)}、村への負担 +${r1(cost)})`,
  );
  return { ok: true, cost };
}

/** 市で米を買い、その拠点に置く(運ぶのは運搬隊) */
export function buyLocal(state: SimState, nodeId: string, amount: number): { ok: true; cost: number } | { ok: false; error: string } {
  const r = takeFromMarket(state, nodeId, amount);
  if (r.ok) state.rice[nodeId] = (state.rice[nodeId] ?? 0) + amount;
  return r;
}

/**
 * 市で米を買い、村の運び手に to まで届けてもらう(現地調達)。届くまで道の日数がかかる。
 * 村の運び手は自分たちの食べ物を持っていく(届ける米は減らない)。襲撃や川越えにも遭わない(簡略化)
 */
export function orderLocal(state: SimState, nodeId: string, to: string, amount: number): { ok: true; cost: number; days: number } | { ok: false; error: string } {
  const route = defaultRoute(state.scenario, nodeId, to);
  if (!route) return { ok: false, error: '道がつながっていません' };
  const r = takeFromMarket(state, nodeId, amount);
  if (!r.ok) return r;
  const steps = Math.max(1, Math.round(route.days / state.scenario.stepDays));
  state.orders.push({ from: nodeId, to, rice: amount, arriveStep: state.step + steps });
  return { ok: true, cost: r.cost, days: route.days };
}

/**
 * 移動中の運搬隊の馬に飼い葉を食べさせる。足りなければ、馬は荷を運べなくなり、
 * 人足が運べる量を超えた分の荷(米と物資を同じ割合で)を捨てる。捨てた量は帳簿の「失った量」に入る
 */
function feedHorses(state: SimState, c: Convoy): void {
  const fg = fodderGood(state.scenario);
  if (!fg || c.horses <= 0) return;
  const need = fodderFor(state, c, state.scenario.stepDays);
  const have = c.goods[fg.id] ?? 0;
  const eat = Math.min(have, need);
  c.goods[fg.id] = clean(have - eat);
  state.ledger.eaten[fg.id] = (state.ledger.eaten[fg.id] ?? 0) + (have - c.goods[fg.id]!);
  if (have + EPS >= need) return;
  // 飼い葉が足りない: 馬は荷を運べない。人足だけで運べる量まで荷を減らす
  const carrierCap = c.carriers * state.scenario.carrierCapacity;
  const total = c.cargo + goodsWeight(c.goods);
  if (total > carrierCap + EPS) {
    const keep = carrierCap / total;
    const lostRice = c.cargo * (1 - keep);
    c.cargo = clean(c.cargo - lostRice);
    state.ledger.lost.rice! += lostRice;
    const lostGoods: Record<string, number> = {};
    for (const id of Object.keys(c.goods)) {
      const b = c.goods[id]!;
      c.goods[id] = clean(b * keep);
      lostGoods[id] = b - c.goods[id]!;
      state.ledger.lost[id] = (state.ledger.lost[id] ?? 0) + lostGoods[id]!;
    }
    addLog(state, `${c.name}は${fg.name}が尽き、馬が荷を運べなくなった(${cargoText(state, lostRice, lostGoods)}を捨てた)`);
  }
  // 荷が人足だけで運べる量なら困らないので記録しない(空荷に近い帰り道で毎回出ると見づらいため)
  c.horsesTired = true;
}

/** 1刻み(既定は半日)進める。 */
export function step(state: SimState): void {
  if (state.outcome !== 'playing') return;
  const sc = state.scenario;
  state.step += 1;

  // 0. 村の運び手が届ける米
  state.orders = state.orders.filter((o) => {
    if (o.arriveStep > state.step) return true;
    state.rice[o.to] = (state.rice[o.to] ?? 0) + o.rice;
    addLog(state, `${nodeName(state, o.from)}の村人が${nodeName(state, o.to)}に米${r1(o.rice)}を届けた`);
    return false;
  });

  // 1. 運搬隊が食べて、進む
  for (const convoy of state.convoys) {
    const mv = convoy.move;
    if (!mv || convoy.dropped) continue;
    const need = eatenOver(convoy, carrierRationOf(state, mv.route), sc.stepDays);
    if (convoy.cargo + EPS < need) {
      addLog(state, `${convoy.name}は道中で食料が尽き、人足が離脱した(積み荷は失われた)`);
      state.ledger.lost.rice! += convoy.cargo;
      convoy.cargo = 0;
      for (const id of Object.keys(convoy.goods)) {
        state.ledger.lost[id] = (state.ledger.lost[id] ?? 0) + convoy.goods[id]!;
        convoy.goods[id] = 0;
      }
      convoy.at = mv.route[mv.leg]!;
      convoy.move = null;
      convoy.dropped = true;
      continue;
    }
    const beforeEat = convoy.cargo;
    convoy.cargo = clean(convoy.cargo - need);
    state.ledger.eaten.rice! += beforeEat - convoy.cargo;
    feedHorses(state, convoy);
    applyRaid(state, convoy);
    const from = mv.route[mv.leg]!;
    const { reached, finished } = advance(sc, mv);
    if (reached) {
      convoy.at = reached;
      applyRisk(state, from, reached, convoy, convoy.name, true);
    }
    if (finished) {
      state.rice[convoy.at] = (state.rice[convoy.at] ?? 0) + convoy.cargo;
      for (const g of goodsOf(sc)) {
        state.goods[g.id]![convoy.at] = (state.goods[g.id]![convoy.at] ?? 0) + (convoy.goods[g.id] ?? 0);
      }
      addLog(state, `${convoy.name}が${nodeName(state, convoy.at)}に到着(${cargoText(state, convoy.cargo, convoy.goods)}を納めた)`);
      convoy.cargo = 0;
      for (const g of goodsOf(sc)) convoy.goods[g.id] = 0;
      convoy.move = null;
    }
  }

  // 2. 軍勢: 保持中は陣の米を食べる。撤退中は持っている米を食べて進む
  const a = state.army;
  if (a.phase === 'hold') {
    const at = a.at;
    const pool: FoodPool = {
      get: (id) => (id === 'rice' ? (state.rice[at] ?? 0) : (state.goods[id]![at] ?? 0)),
      set: (id, v) => {
        if (id === 'rice') state.rice[at] = v;
        else state.goods[id]![at] = v;
      },
    };
    const troopsBefore = a.troops;
    const fed = feedArmy(state, pool);
    // 体を壊して離脱した分を除いても、食べられない兵がいれば陣は保てない
    if (fed < Math.min(troopsBefore, a.troops)) {
      const what = shortNames(state, pool);
      state.stats.starvedNode = at;
      state.outcome = 'lost';
      addLog(state, `${nodeName(state, at)}の${what}が尽きた。遠征は失敗`);
      return;
    }
  } else {
    stepArmy(state);
  }

  // 3. 拠点そのものの消費(軍勢とは別。シナリオ01では使っていない)
  for (const n of sc.map.nodes) {
    const perDay = sc.nodes[n.id]?.consumptionPerDay ?? 0;
    if (perDay <= 0) continue;
    const before = state.rice[n.id] ?? 0;
    state.rice[n.id] = clean(Math.max(0, before - perDay * sc.stepDays));
    state.ledger.eaten.rice! += before - state.rice[n.id]!;
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
