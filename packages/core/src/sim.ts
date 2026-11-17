import { findLink, validateMap, type GameMap } from './map';
import { Rng } from './rng';
import { shortestRoute, type Route } from './route';
import { dailyConsumption } from './stock';
import { eatenOver, maxLoad, type Convoy } from './unit';

export interface NodeSetup {
  /** 初期の米 */
  rice: number;
  /** 毎日の消費(陣など)。省略は0 */
  consumptionPerDay?: number;
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
  /** 何日陣を保てば成功か */
  goalDays: number;
  seed: number;
  nodes: Record<string, NodeSetup>;
  convoys: { id: string; name: string; carriers: number; at: string }[];
}

export type Outcome = 'playing' | 'won' | 'lost';

export interface LogEntry {
  step: number;
  text: string;
}

export interface SimState {
  scenario: Scenario;
  step: number;
  rice: Record<string, number>;
  convoys: Convoy[];
  log: LogEntry[];
  outcome: Outcome;
  rng: Rng;
}

export function createState(scenario: Scenario): SimState {
  validateMap(scenario.map);
  const rice: Record<string, number> = {};
  for (const n of scenario.map.nodes) rice[n.id] = scenario.nodes[n.id]?.rice ?? 0;
  return {
    scenario,
    step: 0,
    rice,
    convoys: scenario.convoys.map((c) => ({ ...c, cargo: 0, move: null })),
    log: [],
    outcome: 'playing',
    rng: new Rng(scenario.seed),
  };
}

export function currentDay(state: SimState): number {
  return state.step * state.scenario.stepDays;
}

function stepsForLeg(scenario: Scenario, a: string, b: string): number {
  const link = findLink(scenario.map, a, b);
  if (!link) throw new Error(`リンクがありません: ${a}-${b}`);
  return Math.max(1, Math.round(link.days / scenario.stepDays));
}

function nodeName(state: SimState, id: string): string {
  return state.scenario.map.nodes.find((n) => n.id === id)?.name ?? id;
}

function addLog(state: SimState, text: string): void {
  state.log.push({ step: state.step, text });
}

export type DispatchResult = { ok: true; route: Route } | { ok: false; error: string };

/** 運搬隊を出発させる。load は拠点の米から積む量。 */
export function dispatch(state: SimState, convoyId: string, destId: string, load: number): DispatchResult {
  if (state.outcome !== 'playing') return { ok: false, error: '遠征は終わっています' };
  const convoy = state.convoys.find((c) => c.id === convoyId);
  if (!convoy) return { ok: false, error: '運搬隊が見つかりません' };
  if (convoy.move) return { ok: false, error: '移動中です' };
  if (convoy.at === destId) return { ok: false, error: '同じ拠点です' };
  const route = shortestRoute(state.scenario.map, convoy.at, destId);
  if (!route) return { ok: false, error: '道がつながっていません' };
  if (!(load >= 0)) return { ok: false, error: '積み荷が不正です' };
  const cap = maxLoad(convoy, state.scenario.carrierCapacity);
  if (load > cap) return { ok: false, error: `積載上限(${cap})を超えています` };
  const have = state.rice[convoy.at] ?? 0;
  if (load > have) return { ok: false, error: `拠点の米(${have})が足りません` };

  state.rice[convoy.at] = have - load;
  convoy.cargo = load;
  const first = route.nodes[0]!;
  const second = route.nodes[1]!;
  const legSteps = stepsForLeg(state.scenario, first, second);
  convoy.move = { route: route.nodes, leg: 0, stepsLeft: legSteps, legSteps };
  addLog(state, `${convoy.name}が${nodeName(state, first)}を出発(米${load})`);
  return { ok: true, route };
}

/** 1刻み(既定は半日)進める。 */
export function step(state: SimState): void {
  if (state.outcome !== 'playing') return;
  const sc = state.scenario;
  state.step += 1;

  // 1. 運搬隊が食べて、進む
  for (const convoy of state.convoys) {
    const mv = convoy.move;
    if (!mv) continue;
    const need = eatenOver(convoy, sc.carrierRation, sc.stepDays);
    if (convoy.cargo < need) {
      const where = mv.route[mv.leg]!;
      addLog(state, `${convoy.name}は食料が尽き、${nodeName(state, where)}へ引き返した(積み荷は失われた)`);
      convoy.cargo = 0;
      convoy.at = where;
      convoy.move = null;
      continue;
    }
    convoy.cargo -= need;
    mv.stepsLeft -= 1;
    if (mv.stepsLeft > 0) continue;

    const arrived = mv.route[mv.leg + 1]!;
    convoy.at = arrived;
    if (mv.leg + 2 < mv.route.length) {
      const next = mv.route[mv.leg + 2]!;
      mv.leg += 1;
      mv.legSteps = stepsForLeg(sc, arrived, next);
      mv.stepsLeft = mv.legSteps;
    } else {
      state.rice[arrived] = (state.rice[arrived] ?? 0) + convoy.cargo;
      addLog(state, `${convoy.name}が${nodeName(state, arrived)}に到着(米${convoy.cargo}を納めた)`);
      convoy.cargo = 0;
      convoy.move = null;
    }
  }

  // 2. 拠点が消費する
  for (const n of sc.map.nodes) {
    const perDay = dailyConsumption(sc, n.id);
    if (perDay <= 0) continue;
    const use = perDay * sc.stepDays;
    const have = state.rice[n.id] ?? 0;
    if (have < use) {
      state.rice[n.id] = 0;
      if (n.id === sc.frontId) {
        state.outcome = 'lost';
        addLog(state, `${n.name}の兵糧が尽きた。遠征は失敗`);
        return;
      }
    } else {
      state.rice[n.id] = have - use;
    }
  }

  // 3. 目標日数に達したか
  if (currentDay(state) >= sc.goalDays) {
    state.outcome = 'won';
    addLog(state, `${sc.goalDays}日間、${nodeName(state, sc.frontId)}を保った。遠征は成功`);
  }
}

/**
 * 運搬隊の現在位置(0〜100の描画座標)。移動中は区間を補間する。
 * alpha は次の刻みまでの進み具合(0〜1)。描画を滑らかにするためだけに使う。
 */
export function convoyPosition(state: SimState, convoy: Convoy, alpha = 0): { x: number; y: number } {
  const nodes = state.scenario.map.nodes;
  const get = (id: string) => nodes.find((n) => n.id === id)!;
  const mv = convoy.move;
  if (!mv) {
    const n = get(convoy.at);
    return { x: n.x, y: n.y };
  }
  const a = get(mv.route[mv.leg]!);
  const b = get(mv.route[mv.leg + 1]!);
  const t = Math.min(1, (mv.legSteps - mv.stepsLeft + alpha) / mv.legSteps);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
