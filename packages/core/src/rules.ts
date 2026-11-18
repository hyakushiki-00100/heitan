/**
 * ルールカードと自動の隊の動き。
 * シミュレーション本体(sim.ts)からは切り離してあり、stepWithRules で「自動の判断 → 1刻み進める」を行う。
 * カードを外したくなったら、ここと sim.ts の護衛付き(carrierRationOf / convoyRiskChance)だけ見ればよい。
 */
import { candidateRoutes, routeFromNodes } from './route';
import {
  armyDailyNeed,
  cardParams,
  convoyCapacity,
  fodderGood,
  carrierRationOf,
  currentDay,
  dispatch,
  goodsOf,
  nodeAmounts,
  orderLocal,
  remainingDays,
  retreatPlan,
  retreatRoute,
  step,
  tripPreview,
  type SimState,
} from './sim';
import { nodeConsumptionPerDay } from './stock';
import type { Convoy } from './unit';

const EPS = 1e-9;

/** 自動の隊が蔵から陣へ運ぶ道を変える(蔵→陣の道であること) */
export function setAutoRoute(state: SimState, nodes: string[]): boolean {
  const sc = state.scenario;
  const r = routeFromNodes(sc.map, nodes);
  if (!r || nodes[0] !== sc.depotId || nodes[nodes.length - 1] !== sc.frontId) return false;
  state.autoRoute = [...nodes];
  return true;
}

const routeDays = (state: SimState, nodes: string[]) => routeFromNodes(state.scenario.map, nodes)?.days ?? Infinity;

/** a から b への道。両方が自動便の道の上にあればその一部を使い、なければ日数最短 */
function pathBetween(state: SimState, a: string, b: string): string[] | null {
  const r = state.autoRoute;
  const i = r.indexOf(a);
  const j = r.indexOf(b);
  if (i >= 0 && j >= 0 && i !== j) return i < j ? r.slice(i, j + 1) : r.slice(j, i + 1).reverse();
  return candidateRoutes(state.scenario.map, a, b, 1)[0]?.nodes ?? null;
}

/**
 * 隊を出すのに必要な最小の積み荷。arriveAtLeast だけ届けたい。
 * worstCase なら道の危険がすべて起きても届く量にする。積める上限を超えるなら null
 */
function loadFor(state: SimState, c: Convoy, nodes: string[], arriveAtLeast: number, worstCase: boolean): number | null {
  const cap = convoyCapacity(state, c);
  const ok = (l: number) => {
    const p = tripPreview(state, c, nodes, l);
    if (!p) return false;
    return (worstCase ? p.arriveWorst : p.arrive) + EPS >= arriveAtLeast;
  };
  if (!ok(cap)) return null;
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.min(cap, Math.ceil(hi * 2 - EPS) / 2); // 0.5 刻みに切り上げ
}

/** 米と物資の量('rice' は米、それ以外は物資ID) */
type Amounts = Record<string, number>;

/** シナリオで扱うもの('rice' と物資ID) */
function resIds(state: SimState): string[] {
  return ['rice', ...goodsOf(state.scenario).map((g) => g.id)];
}

const total = (a: Amounts) => Object.values(a).reduce((x, y) => x + y, 0);

/** 拠点 id へ向かっている運搬隊が、着いたときに届けるはずの量(危険は起きない前提) */
function inbound(state: SimState, id: string): Amounts {
  const out: Amounts = Object.fromEntries(resIds(state).map((r) => [r, 0]));
  for (const c of state.convoys) {
    const mv = c.move;
    if (!mv || c.dropped || mv.route[mv.route.length - 1] !== id) continue;
    out.rice! += Math.max(0, c.cargo - c.carriers * carrierRationOf(state, mv.route) * remainingDays(state.scenario, mv));
    for (const [g, v] of Object.entries(c.goods)) out[g] = (out[g] ?? 0) + v;
  }
  // 村の運び手が届ける途中の米(現地調達)
  for (const o of state.orders) if (o.to === id) out.rice! += o.rice;
  return out;
}

/**
 * 陣にいる隊・陣へ向かっている隊が、いずれ陣から蔵へ戻るときに陣の米から積む帰り分の合計。
 * これを見込まないと、撤退の日に陣の米が足りなくなり、隊も陣に取り残される
 */
function pendingBackFood(state: SimState): number {
  const sc = state.scenario;
  const kiro = !!cardParams(state, 'kiro');
  const home = pathBetween(state, sc.frontId, sc.depotId);
  if (!home) return 0;
  let sum = 0;
  for (const c of state.convoys) {
    if (c.dropped) continue;
    const toFront = c.move ? c.move.route[c.move.route.length - 1] === sc.frontId : c.at === sc.frontId;
    if (!toFront) continue;
    sum += loadFor(state, c, home, 0, kiro) ?? 0;
  }
  return sum;
}

/** 陣で1日に使う量(米と物資)。陣を保持している間だけ */
function frontDaily(state: SimState): Amounts {
  const sc = state.scenario;
  const d = armyDailyNeed(state);
  const out: Amounts = { rice: nodeConsumptionPerDay(state, sc.frontId) };
  for (const g of goodsOf(sc)) out[g.id] = state.army.phase === 'hold' ? (d.goods[g.id] ?? 0) : 0;
  return out;
}

/**
 * 撤退開始の日に陣に残っていてほしい量(撤退で持ち出す分+隊の帰り分)に、今の見込みで足りない量。
 * extra は「やがて陣へ届く」と数えてよい量(中継地にある分など)
 */
function frontDeficit(state: SimState, extra: Amounts = {}): Amounts {
  const sc = state.scenario;
  const out: Amounts = Object.fromEntries(resIds(state).map((r) => [r, 0]));
  if (state.army.phase !== 'hold') return out;
  const daysToGoal = Math.max(0, sc.goalDays - currentDay(state));
  const plan = retreatPlan(state);
  const have = nodeAmounts(state, sc.frontId);
  const inb = inbound(state, sc.frontId);
  const daily = frontDaily(state);
  const back = pendingBackFood(state);
  for (const r of resIds(state)) {
    const need = plan.fromFront * (plan.shares[r] ?? 0) + (r === 'rice' ? back : 0);
    const projected = (have[r] ?? 0) + (inb[r] ?? 0) + (extra[r] ?? 0) - (daily[r] ?? 0) * daysToGoal;
    out[r] = Math.max(0, need - projected);
  }
  return out;
}

const frontNeedsMore = (state: SimState, extra: Amounts = {}) => total(frontDeficit(state, extra)) > EPS;

/**
 * 「帰路分を残す」のときに拠点に残しておく量(米と物資それぞれ)。
 * 陣: 撤退開始まで reserveDays 日分の消費(撤退が近ければ撤退で持ち出す分も)。撤退路の途中: 置き米+危険への上乗せ
 */
function reserveAt(state: SimState, id: string): Amounts {
  const out: Amounts = Object.fromEntries(resIds(state).map((r) => [r, 0]));
  const kiro = cardParams(state, 'kiro');
  if (!kiro || state.army.phase !== 'hold') return out;
  const sc = state.scenario;
  const plan = retreatPlan(state);
  if (id === sc.frontId) {
    const k = kiro.frontReserveDays ?? 2;
    const daysToGoal = Math.max(0, sc.goalDays - currentDay(state));
    const daily = frontDaily(state);
    for (const r of resIds(state)) {
      out[r] = (daily[r] ?? 0) * Math.min(k, daysToGoal) + (daysToGoal <= k ? plan.fromFront * (plan.shares[r] ?? 0) : 0);
    }
    return out;
  }
  const stop = plan.stops.find((x) => x.id === id);
  if (stop) for (const r of resIds(state)) out[r] = (stop.required + stop.riskBuffer) * (plan.shares[r] ?? 0);
  return out;
}

/** 中継地: 自動便の道の途中の拠点のうち、道の真ん中に最も近いもの。途中の拠点がなければ null */
export function relayNode(state: SimState): string | null {
  const r = state.autoRoute;
  if (r.length < 3) return null;
  const total = routeDays(state, r);
  let best: string | null = null;
  let bestGap = Infinity;
  for (let i = 1; i + 1 < r.length; i++) {
    const gap = Math.abs(routeDays(state, r.slice(0, i + 1)) - total / 2);
    if (gap < bestGap - EPS) {
      bestGap = gap;
      best = r[i]!;
    }
  }
  return best;
}

export type AutoRole = 'direct' | 'near' | 'far';

/**
 * 自動の隊の役割。中継経由なら、自動の「人足だけの隊」を「蔵⇔中継地」(near)と「中継地⇔陣」(far)に分ける。
 * 分ける割合は区間の日数の比(長い区間ほど多くの隊を当てる)。どちらも1隊以上。
 * 馬を連れた隊は、飼い葉が蔵にしかないので、中継経由でも蔵から直送(direct)にする。
 * 中継経由でなければ全員 direct
 */
export function autoRoles(state: SimState): Map<string, AutoRole> {
  const autos = state.convoys.filter((c) => c.auto && !c.dropped);
  const roles = new Map<string, AutoRole>();
  for (const c of autos) roles.set(c.id, 'direct');
  const relay = relayNode(state);
  const walkers = autos.filter((c) => c.horses <= 0);
  if (!cardParams(state, 'chukei') || walkers.length < 2 || !relay) return roles;
  const r = state.autoRoute;
  const nearDays = routeDays(state, r.slice(0, r.indexOf(relay) + 1));
  const ratio = nearDays / routeDays(state, r);
  const near = Math.min(walkers.length - 1, Math.max(1, Math.round(walkers.length * ratio)));
  walkers.forEach((c, i) => roles.set(c.id, i < near ? 'near' : 'far'));
  return roles;
}

/**
 * 隊を拠点 to へ帰す。帰り分は今いる拠点から積む。取り置きを減らすなら出さない。
 * foodTo を渡すと、to ではなく foodTo まで帰れる量を積む(途中の中継地で下ろした余りを、そこからの帰り分にするため)
 */
function sendBack(state: SimState, c: Convoy, to: string, foodTo: string = to): boolean {
  const nodes = pathBetween(state, c.at, to);
  const foodNodes = pathBetween(state, c.at, foodTo);
  if (!nodes || !foodNodes) return false;
  const kiro = !!cardParams(state, 'kiro');
  const food = loadFor(state, c, foodNodes, 0, kiro);
  if (food === null) return false;
  const have = state.rice[c.at] ?? 0;
  if (have + EPS < food + reserveAt(state, c.at).rice!) return false;
  return dispatch(state, c.id, to, food, nodes).ok;
}

/** 蔵から撤退路の置き米(米と物資)を運ぶ(帰路分を残すが有効なときだけ)。運んだら true */
function stockRetreatStop(state: SimState, c: Convoy): boolean {
  if (!cardParams(state, 'kiro') || state.army.phase !== 'hold') return false;
  const sc = state.scenario;
  const plan = retreatPlan(state);
  const back = [...retreatRoute(state).nodes].reverse(); // 蔵→陣の向き
  const cap = convoyCapacity(state, c);
  for (const stop of plan.stops) {
    const target = stop.required + stop.riskBuffer;
    if (target <= EPS) continue;
    const have = nodeAmounts(state, stop.id);
    const inb = inbound(state, stop.id);
    const short: Amounts = {};
    for (const r of resIds(state)) short[r] = Math.max(0, target * (plan.shares[r] ?? 0) - (have[r] ?? 0) - (inb[r] ?? 0));
    if (total(short) <= EPS) continue;
    const nodes = back.slice(0, back.indexOf(stop.id) + 1);
    // 米 = 足りない分 + この隊がそこから戻るための帰り分(道中で食べる分も含めて loadFor が足す)
    const backFood = loadFor(state, c, [...nodes].reverse(), 0, true);
    if (backFood === null) continue;
    const rice = loadFor(state, c, nodes, short.rice! + backFood, true);
    if (rice === null) continue;
    // 馬を連れているなら往路の飼い葉も積む。物資は残りの積載に収まる分だけ(収まらない分は次の隊が運ぶ)
    const goods: Amounts = {};
    const depotAvail = nodeAmounts(state, sc.depotId);
    const fodder = horseFodder(state, c, tripPreview(state, c, nodes, 0)!.fodderNeed, depotAvail);
    if (rice + fodder.amount > fodder.capacity + EPS) continue;
    const room = Math.max(0, fodder.capacity - rice - fodder.amount);
    const wantGoods = total(short) - short.rice!;
    const scale = wantGoods > room ? room / wantGoods : 1;
    for (const g of goodsOf(sc)) goods[g.id] = Math.min(short[g.id]! * scale, state.goods[g.id]![sc.depotId] ?? 0);
    if (fodder.id) goods[fodder.id] = Math.min((goods[fodder.id] ?? 0) + fodder.amount, state.goods[fodder.id]![sc.depotId] ?? 0);
    if (rice > (state.rice[sc.depotId] ?? 0) + EPS) continue;
    if (dispatch(state, c.id, stop.id, rice, nodes, goods).ok) return true;
  }
  return false;
}

/**
 * 馬を連れた隊が往路のために積む飼い葉と、そのときの積める上限。
 * 飼い葉が足りなければ馬は運べないので、上限は人足の分だけ(飼い葉は積まない)
 */
function horseFodder(state: SimState, c: Convoy, need: number, avail: Amounts): { id: string | null; amount: number; capacity: number } {
  const fg = fodderGood(state.scenario);
  const carriersOnly = c.carriers * state.scenario.carrierCapacity;
  if (!fg || c.horses <= 0) return { id: null, amount: 0, capacity: convoyCapacity(state, c) };
  if ((avail[fg.id] ?? 0) + EPS < need) return { id: fg.id, amount: 0, capacity: carriersOnly };
  return { id: fg.id, amount: need, capacity: convoyCapacity(state, c) };
}

/** 拠点で待機している「自分以外の」自動の隊が、そこから蔵へ帰るのに要る米(手を付けないでおく分) */
function othersHomeFood(state: SimState, c: Convoy): number {
  const home = pathBetween(state, c.at, state.scenario.depotId);
  if (!home || c.at === state.scenario.depotId) return 0;
  const kiro = !!cardParams(state, 'kiro');
  let sum = 0;
  for (const o of state.convoys) {
    if (o === c || !o.auto || o.dropped || o.move || o.at !== c.at) continue;
    sum += loadFor(state, o, home, 0, kiro) ?? 0;
  }
  return sum;
}

/**
 * 隊を to へ満載で出す。積荷の米と物資は wants(足りない量)の比で組む。
 * 米は道中で食べる分を先に確保する。今いる拠点の取り置きと、他の隊の帰り分には手を付けない。
 * 間に合わない・届く量が少なすぎるなら出さない
 */
function sendFull(state: SimState, c: Convoy, to: string, onlyIfArriveBy: number, wants: Amounts): boolean {
  const sc = state.scenario;
  const nodes = pathBetween(state, c.at, to);
  if (!nodes) return false;
  if (currentDay(state) + routeDays(state, nodes) > onlyIfArriveBy + EPS) return false;
  const want = total(wants);
  if (want <= EPS) return false;
  const reserve = reserveAt(state, c.at);
  const here = nodeAmounts(state, c.at);
  const avail: Amounts = {};
  for (const r of resIds(state)) avail[r] = Math.max(0, (here[r] ?? 0) - (reserve[r] ?? 0) - (r === 'rice' ? othersHomeFood(state, c) : 0));
  const pre = tripPreview(state, c, nodes, 0)!;
  const eat = pre.eat;
  if (avail.rice! + EPS < eat) return false;
  // 馬を連れているなら、往路で食べる飼い葉を先に積む。飼い葉が足りなければ馬に頼らず人足だけで運べる量にする
  const fodder = horseFodder(state, c, pre.fodderNeed, avail);
  const room = fodder.capacity - eat - fodder.amount;
  if (room <= EPS) return false;
  // 足りない量の比のまま、積める上限まで増やす(足りない量が上限より少なくても満載で運ぶ)
  const load: Amounts = {};
  for (const r of resIds(state)) load[r] = Math.min((wants[r] ?? 0) * (room / want), r === 'rice' ? avail.rice! - eat : avail[r]!);
  // 他のものが足りずに空いた分は、在庫のあるものを足りない比で詰め直す
  let spare = room - total(load);
  for (const r of resIds(state)) {
    if (spare <= EPS || (wants[r] ?? 0) <= EPS) continue;
    const cap = (r === 'rice' ? avail.rice! - eat : avail[r]!) - load[r]!;
    const add = Math.min(spare, Math.max(0, cap));
    load[r]! += add;
    spare -= add;
  }
  const rice = eat + load.rice!;
  const goods: Amounts = {};
  for (const g of goodsOf(sc)) goods[g.id] = load[g.id]!;
  if (fodder.id) goods[fodder.id] = (goods[fodder.id] ?? 0) + fodder.amount;
  // 届く量が積み荷の3割に満たないなら、運ぶ意味が薄いので出さない
  if (total(load) < (rice + total(goods)) * 0.3) return false;
  return dispatch(state, c.id, to, rice, nodes, goods).ok;
}

/**
 * 現地調達: 陣の米が「市から届くまでの日数 + marginDays」を切りそうなら、陣に一番近い市(maxDays 日以内)から
 * 陣の buyDays 日分の米を買い、村の運び手に届けてもらう。届く途中の注文があるあいだは重ねて買わない
 */
function localProcurement(state: SimState): void {
  const gp = cardParams(state, 'genchi');
  const sc = state.scenario;
  if (!gp || state.army.phase !== 'hold') return;
  if (state.orders.some((o) => o.to === sc.frontId)) return;
  const perDay = nodeConsumptionPerDay(state, sc.frontId);
  if (perDay <= 0) return;
  let best: { id: string; days: number } | null = null;
  for (const [id, m] of Object.entries(state.markets)) {
    if (m.left <= EPS) continue;
    const r = candidateRoutes(sc.map, id, sc.frontId, 1)[0];
    if (!r || r.days > (gp.maxDays ?? 6)) continue;
    if (!best || r.days < best.days) best = { id, days: r.days };
  }
  if (!best) return;
  // 届くまでの間に、陣に向かっている運搬隊の米も入ってくる
  const riceDays = ((state.rice[sc.frontId] ?? 0) + inbound(state, sc.frontId).rice!) / perDay;
  if (riceDays >= best.days + (gp.marginDays ?? 2)) return;
  // 撤退開始より後に届くなら買わない(余剰になるだけ)
  if (currentDay(state) + best.days > sc.goalDays) return;
  const amount = Math.min(state.markets[best.id]!.left, perDay * (gp.buyDays ?? 4));
  if (amount > EPS) orderLocal(state, best.id, sc.frontId, amount);
}

/** 待機中の自動の隊に、カードに従って指図する */
export function runRules(state: SimState): void {
  if (state.outcome !== 'playing') return;
  localProcurement(state);
  const sc = state.scenario;
  const depot = sc.depotId;
  const front = sc.frontId;
  const goal = sc.goalDays;
  const roles = autoRoles(state);
  const relay = relayNode(state);
  const hold = state.army.phase === 'hold';

  for (const c of state.convoys) {
    if (!c.auto || c.dropped || c.move) continue;
    const role = roles.get(c.id) ?? 'direct';

    if (c.at === depot) {
      if (stockRetreatStop(state, c)) continue;
      if (!hold) continue;
      if (role === 'direct') {
        const need = frontDeficit(state);
        if (total(need) > EPS) sendFull(state, c, front, goal, need);
      } else if (relay) {
        // 中継地にある分も「やがて陣へ届く」として数える。
        // 米は中継地から陣へ運ぶ間に食べる分を引いた割合(満載1回で届く割合)を掛ける。物資は食べないのでそのまま
        const farNodes = pathBetween(state, relay, front)!;
        const cap = convoyCapacity(state, c);
        const reach = Math.max(0, tripPreview(state, c, farNodes, cap)!.arrive) / cap;
        const here = nodeAmounts(state, relay);
        const reserve = reserveAt(state, relay);
        const inb = inbound(state, relay);
        const extra: Amounts = {};
        for (const r of resIds(state)) {
          const v = Math.max(0, (here[r] ?? 0) - (reserve[r] ?? 0)) + (inb[r] ?? 0);
          extra[r] = r === 'rice' ? v * reach : v;
        }
        const need = frontDeficit(state, extra);
        // 中継地に、中継地⇔陣の隊が1巡で運べる量より多く溜まっているなら送らない(溜まるだけで余剰になる)
        const farCap = state.convoys
          .filter((o) => roles.get(o.id) === 'far')
          .reduce((t, o) => t + convoyCapacity(state, o), 0);
        const stocked = total(extra);
        if (total(need) > EPS && stocked < farCap) sendFull(state, c, relay, goal - routeDays(state, farNodes), need);
      }
      continue;
    }

    // 蔵以外にいる。中継地⇔陣の隊は、陣を保持している間は中継地と陣を往復する
    if (role === 'far' && relay && hold) {
      if (c.at === relay) {
        // 陣へ運ぶ必要があれば運ぶ。なければ中継地で待たずに蔵へ帰る
        // (待っている間に中継地の米がなくなると、帰れなくなるため)
        if (frontNeedsMore(state) && sendFull(state, c, front, goal, frontDeficit(state))) continue;
        if (!frontNeedsMore(state)) sendBack(state, c, depot);
        continue;
      }
      if (c.at === front) {
        // まだ運ぶ必要があり、撤退までにもう1往復できるなら中継地へ。そうでなければ蔵へ直接帰る。
        // 中継地へ戻るときも蔵までの帰り分を積む(中継地で下ろした余りが、そこからの帰り分になる)
        const legDays = routeDays(state, pathBetween(state, front, relay)!);
        if (frontNeedsMore(state) && currentDay(state) + legDays * 2 <= goal + EPS) sendBack(state, c, relay, depot);
        else sendBack(state, c, depot);
        continue;
      }
    }
    // それ以外は蔵へ帰る(取り置きを減らすなら待つ)
    sendBack(state, c, depot);
  }
}

/** 自動の判断をしてから、1刻み進める。画面からはこれを呼ぶ */
export function stepWithRules(state: SimState): void {
  runRules(state);
  step(state);
}
