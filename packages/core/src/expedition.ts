/**
 * 遠征ローグライト(作り直しの試作)。
 * 軍勢と荷駄を連れて、蔵から城まで拠点を1つずつ進み、城を落として蔵へ戻る。
 * 拠点ごとに出来事が起き、2〜3個の選択肢から選ぶ。運ぶ人(荷駄)も食べるので、多く連れるほど減りも速い。
 * 行きに米を置いていけば帰りに拾える。空になった荷駄は先に帰せる(食べる口が減る)。
 * 描画は知らない(画面は games/ 側)。同じシードなら同じ展開になる。
 */
import { Rng } from './rng';

export type ExNodeType = 'kura' | 'shiro' | 'mura' | 'mori' | 'kawa' | 'shuku' | 'nobuse' | 'toge' | 'no';

export interface ExNode {
  id: number;
  /** 何列目か(0 = 蔵、cols-1 = 城) */
  col: number;
  /** 列の中の位置(0〜1。描画用) */
  y: number;
  type: ExNodeType;
}

export interface ExMap {
  cols: number;
  nodes: ExNode[];
  /** 隣の列への道 [前の列の拠点, 次の列の拠点] */
  edges: [number, number][];
}

/** 遊びの数値(試作。ボットで調整する) */
export interface ExRules {
  /** 兵の隊数 */
  troops: number;
  /** 兵1隊が1日に食べる米 */
  troopEat: number;
  /** 荷駄1隊が1日に食べる米 */
  porterEat: number;
  /** 荷駄1隊が運べる米 */
  carry: number;
  /** 軍議で選べる荷駄の数 */
  minPorters: number;
  maxPorters: number;
  /** 村・宿場で買える米と、その負担(減点) */
  villageRice: number;
  villageBurden: number;
  innRice: number;
  innBurden: number;
  /** 森で1日かけて集める米の最小・最大 */
  forageMin: number;
  forageMax: number;
  /** 川を渡るとき荷を失う確率と割合 */
  riverChance: number;
  riverLoss: number;
  /** 野伏せりに渡す米。追い払いに失敗したら兵を1隊失い、この米も失う */
  banditToll: number;
  /** 兵1隊あたりの追い払いの成功率(上限 0.9) */
  banditPerTroop: number;
  /** 城: 攻めたときの兵1隊あたりの落城率(上限 0.9)、囲んだときの1日の落城率 */
  assaultPerTroop: number;
  siegePerDay: number;
  /** 得点: 落城、帰還1隊、負担・余り1あたりの減点 */
  scoreTaken: number;
  scorePerSquad: number;
  scorePerBurden: number;
}

export const EX_RULES: ExRules = {
  troops: 4,
  troopEat: 1,
  porterEat: 1,
  carry: 20,
  minPorters: 2,
  maxPorters: 10,
  villageRice: 20,
  villageBurden: 20,
  innRice: 20,
  innBurden: 10,
  forageMin: 0,
  forageMax: 24,
  riverChance: 0.4,
  riverLoss: 0.3,
  banditToll: 16,
  banditPerTroop: 0.2,
  assaultPerTroop: 0.15,
  siegePerDay: 0.3,
  scoreTaken: 100,
  scorePerSquad: 10,
  scorePerBurden: 1,
};

export type ExPhase = 'plan' | 'out' | 'siege' | 'back' | 'done';

export interface ExChoice {
  id: string;
  /** ボタンの言葉(短く) */
  label: string;
  /** 結果の見込み(短く。例「米+20 負担+20」) */
  effect: string;
  disabled?: boolean;
}

export interface ExEvent {
  type: ExNodeType;
  /** 見出し(1語) */
  title: string;
  choices: ExChoice[];
}

export interface ExState {
  rules: ExRules;
  seed: number;
  rng: Rng;
  map: ExMap;
  phase: ExPhase;
  /** 今いる拠点 */
  at: number;
  /** 行きに通った拠点(蔵から順に)。帰りはこれを逆にたどる */
  path: number[];
  day: number;
  food: number;
  troops: number;
  porters: number;
  /** 先に帰した荷駄(帰還に数える) */
  sentHome: number;
  /** 飢えて離れた隊 */
  lostTroops: number;
  lostPorters: number;
  /** 拠点に置いた米(拠点ID → 量) */
  cache: Record<number, number>;
  burden: number;
  taken: boolean;
  /** 今の拠点で答えを待っている出来事 */
  pending: ExEvent | null;
  /** 出来事を済ませた拠点(同じ拠点で2度起きないように。帰りは別に数える) */
  resolved: Set<string>;
  log: string[];
  /** 帳簿(米の合計が合うかの確かめ用) */
  ledger: { start: number; gained: number; eaten: number; lost: number; given: number };
}

const NODE_TITLE: Record<ExNodeType, string> = {
  kura: '蔵',
  shiro: '城',
  mura: '村',
  mori: '森',
  kawa: '川',
  shuku: '宿場',
  nobuse: '野伏せり',
  toge: '峠',
  no: '野',
};
export const exNodeTitle = (t: ExNodeType): string => NODE_TITLE[t];

/** 地図を作る。列0が蔵、最後の列が城。間の列には2〜3個の拠点があり、どの拠点も次の列へ1〜2本の道を持つ */
export function generateExMap(seed: number, cols = 7): ExMap {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const nodes: ExNode[] = [];
  const byCol: number[][] = [];
  const pool: ExNodeType[] = ['mura', 'mori', 'kawa', 'shuku', 'nobuse', 'toge', 'no', 'mura', 'mori', 'kawa', 'nobuse', 'no'];
  for (let c = 0; c < cols; c++) {
    const n = c === 0 || c === cols - 1 ? 1 : rng.int(2, 3);
    byCol.push([]);
    for (let i = 0; i < n; i++) {
      const type: ExNodeType = c === 0 ? 'kura' : c === cols - 1 ? 'shiro' : pool[rng.int(0, pool.length - 1)]!;
      const id = nodes.length;
      nodes.push({ id, col: c, y: n === 1 ? 0.5 : 0.15 + (0.7 * i) / (n - 1), type });
      byCol[c]!.push(id);
    }
  }
  const edges: [number, number][] = [];
  const has = (a: number, b: number) => edges.some((e) => e[0] === a && e[1] === b);
  for (let c = 0; c + 1 < cols; c++) {
    const A = byCol[c]!;
    const B = byCol[c + 1]!;
    // 上下の並びが近いものを結ぶ(線が交わりにくいように)。どの拠点も入る道と出る道を1本以上持つ
    for (let i = 0; i < A.length; i++) {
      const j = Math.round((i * (B.length - 1)) / Math.max(1, A.length - 1));
      edges.push([A[i]!, B[j]!]);
      if (rng.next() < 0.5) {
        const k = Math.min(B.length - 1, Math.max(0, j + (rng.next() < 0.5 ? -1 : 1)));
        if (!has(A[i]!, B[k]!)) edges.push([A[i]!, B[k]!]);
      }
    }
    for (let j = 0; j < B.length; j++) {
      if (!edges.some((e) => e[1] === B[j])) {
        const i = Math.round((j * (A.length - 1)) / Math.max(1, B.length - 1));
        edges.push([A[i]!, B[j]!]);
      }
    }
  }
  return { cols, nodes, edges };
}

export function createExpedition(seed: number, rules: ExRules = EX_RULES, cols = 7): ExState {
  const map = generateExMap(seed, cols);
  return {
    rules,
    seed,
    rng: new Rng(seed),
    map,
    phase: 'plan',
    at: 0,
    path: [0],
    day: 0,
    food: 0,
    troops: rules.troops,
    porters: 0,
    sentHome: 0,
    lostTroops: 0,
    lostPorters: 0,
    cache: {},
    burden: 0,
    taken: false,
    pending: null,
    resolved: new Set(),
    log: [],
    ledger: { start: 0, gained: 0, eaten: 0, lost: 0, given: 0 },
  };
}

/** 1日に食べる米 */
export function exEatPerDay(s: ExState, troops = s.troops, porters = s.porters): number {
  return troops * s.rules.troopEat + porters * s.rules.porterEat;
}

/** 運べる米の上限 */
export function exCapacity(s: ExState, porters = s.porters): number {
  return porters * s.rules.carry;
}

/** 今の米で何日もつか */
export function exDaysLeft(s: ExState): number {
  const e = exEatPerDay(s);
  return e > 0 ? s.food / e : Infinity;
}

/** 軍議の見積もり(荷駄の数ごと) */
export function exPlanPreview(s: ExState, porters: number): { food: number; eat: number; days: number } {
  const food = exCapacity(s, porters);
  const eat = exEatPerDay(s, s.troops, porters);
  return { food, eat, days: food / eat };
}

/** 出陣する(荷駄の数を決め、満載で出る) */
export function exStart(s: ExState, porters: number): void {
  if (s.phase !== 'plan') throw new Error('出陣は軍議のときだけ');
  const p = Math.max(s.rules.minPorters, Math.min(s.rules.maxPorters, Math.round(porters)));
  s.porters = p;
  s.food = exCapacity(s);
  s.ledger.start = s.food;
  s.phase = 'out';
  s.log.push(`出陣(兵${s.troops}・荷駄${p}・米${s.food})`);
}

/** 行きに次へ進める拠点 */
export function exNext(s: ExState): number[] {
  if (s.pending) return [];
  if (s.phase === 'out') return s.map.edges.filter((e) => e[0] === s.at).map((e) => e[1]);
  if (s.phase === 'back') {
    const i = s.path.lastIndexOf(s.at);
    return i > 0 ? [s.path[i - 1]!] : [];
  }
  return [];
}

/** 何日かたつ。毎日食べ、足りなければ隊が離れる(荷駄から先に) */
function passDays(s: ExState, days: number): void {
  for (let d = 0; d < days; d++) {
    s.day++;
    const need = exEatPerDay(s);
    if (s.food >= need) {
      s.food -= need;
      s.ledger.eaten += need;
      continue;
    }
    s.ledger.eaten += s.food;
    const short = need - s.food;
    s.food = 0;
    // 足りない量を1隊の食べる量で割った数だけ離れる(荷駄から)
    let leave = Math.ceil(short / s.rules.troopEat);
    const p = Math.min(leave, s.porters);
    s.porters -= p;
    s.lostPorters += p;
    leave -= p;
    const t = Math.min(leave, s.troops);
    s.troops -= t;
    s.lostTroops += t;
    if (p + t > 0) s.log.push(`${s.day}日目: 米が尽き、${p ? `荷駄${p}` : ''}${p && t ? '・' : ''}${t ? `兵${t}` : ''}が離れた`);
  }
}

/** 運べる量を超えた米は、その拠点に置いていく */
function fitCapacity(s: ExState): void {
  const over = s.food - exCapacity(s);
  if (over > 0) {
    s.food -= over;
    s.cache[s.at] = (s.cache[s.at] ?? 0) + over;
  }
}

function gain(s: ExState, amount: number): number {
  const got = Math.max(0, Math.min(amount, exCapacity(s) - s.food));
  s.food += got;
  s.ledger.gained += got;
  return got;
}

function lose(s: ExState, amount: number, kind: 'lost' | 'given'): number {
  const l = Math.min(s.food, Math.max(0, Math.round(amount)));
  s.food -= l;
  s.ledger[kind] += l;
  return l;
}

const room = (s: ExState) => exCapacity(s) - s.food;

/** 今の拠点の出来事を作る(済んでいれば null) */
function makeEvent(s: ExState): ExEvent | null {
  const n = s.map.nodes[s.at]!;
  const key = `${s.phase === 'back' ? 'b' : 'o'}${s.at}`;
  if (n.type === 'shiro') {
    if (s.taken) return null;
    const pa = Math.min(0.9, s.troops * s.rules.assaultPerTroop);
    return {
      type: 'shiro',
      title: '城',
      choices: [
        { id: 'assault', label: '攻める', effect: `${Math.round(pa * 100)}%で落城・失敗で兵−1`, disabled: s.troops === 0 },
        { id: 'siege', label: '囲む', effect: `1日・${Math.round(s.rules.siegePerDay * 100)}%で落城` },
        { id: 'withdraw', label: '引き上げる', effect: '落とさず帰る' },
      ],
    };
  }
  if (s.resolved.has(key)) return null;
  const R = s.rules;
  switch (n.type) {
    case 'mura':
      return {
        type: n.type,
        title: '村',
        choices: [
          { id: 'buy', label: '買う', effect: `米+${R.villageRice} 負担+${R.villageBurden}`, disabled: room(s) <= 0 },
          { id: 'pass', label: '通る', effect: '' },
        ],
      };
    case 'shuku':
      return {
        type: n.type,
        title: '宿場',
        choices: [
          { id: 'buy', label: '買う', effect: `米+${R.innRice} 負担+${R.innBurden}`, disabled: room(s) <= 0 },
          { id: 'pass', label: '通る', effect: '' },
        ],
      };
    case 'mori':
      return {
        type: n.type,
        title: '森',
        choices: [
          { id: 'forage', label: '集める', effect: `1日・米+${R.forageMin}〜${R.forageMax}`, disabled: room(s) <= 0 },
          { id: 'pass', label: '通る', effect: '' },
        ],
      };
    case 'kawa':
      return {
        type: n.type,
        title: '川',
        choices: [
          { id: 'cross', label: '渡る', effect: `${Math.round(R.riverChance * 100)}%で米−${Math.round(R.riverLoss * 10)}割` },
          { id: 'ford', label: '浅瀬を探す', effect: '1日・安全' },
        ],
      };
    case 'nobuse': {
      const p = Math.min(0.9, s.troops * R.banditPerTroop);
      return {
        type: n.type,
        title: '野伏せり',
        choices: [
          { id: 'fight', label: '追い払う', effect: `${Math.round(p * 100)}%・失敗で兵−1 米−${R.banditToll}` },
          { id: 'pay', label: '米を渡す', effect: `米−${R.banditToll}` },
        ],
      };
    }
    default:
      return null;
  }
}

/** 次の拠点へ進む(峠は2日、ほかは1日) */
export function exMove(s: ExState, to: number): { ok: boolean; error?: string } {
  if (!exNext(s).includes(to)) return { ok: false, error: 'そこへは進めない' };
  const n = s.map.nodes[to]!;
  passDays(s, n.type === 'toge' ? 2 : 1);
  s.at = to;
  if (s.phase === 'out') s.path.push(to);
  // 帰りは、置いておいた米を拾う(運べる分だけ。残りは置いたまま)
  if (s.phase === 'back' && s.cache[to]) {
    const take = Math.min(s.cache[to]!, room(s));
    s.cache[to]! -= take;
    s.food += take;
    if (take > 0) s.log.push(`${s.day}日目: ${exNodeTitle(n.type)}で置き米${take}を拾った`);
  }
  if (s.phase === 'out' && n.type === 'shiro') s.phase = 'siege';
  if (s.phase === 'back' && to === 0) {
    finish(s);
    return { ok: true };
  }
  s.pending = makeEvent(s);
  checkWiped(s);
  return { ok: true };
}

/** 出来事に答える */
export function exChoose(s: ExState, id: string): { ok: boolean; error?: string } {
  const ev = s.pending;
  if (!ev) return { ok: false, error: '出来事がない' };
  const c = ev.choices.find((x) => x.id === id);
  if (!c || c.disabled) return { ok: false, error: '選べない' };
  const R = s.rules;
  const key = `${s.phase === 'back' ? 'b' : 'o'}${s.at}`;
  let msg = '';
  switch (id) {
    case 'buy': {
      const inn = ev.type === 'shuku';
      const got = gain(s, inn ? R.innRice : R.villageRice);
      const cost = Math.round(((inn ? R.innBurden : R.villageBurden) * got) / (inn ? R.innRice : R.villageRice));
      s.burden += cost;
      msg = `米${got}を買った(負担${cost})`;
      break;
    }
    case 'forage': {
      passDays(s, 1);
      const got = gain(s, s.rng.int(R.forageMin, R.forageMax));
      msg = `森で米${got}を集めた`;
      break;
    }
    case 'cross': {
      if (s.rng.next() < R.riverChance) msg = `川で米${lose(s, s.food * R.riverLoss, 'lost')}を失った`;
      else msg = '無事に渡った';
      break;
    }
    case 'ford':
      passDays(s, 1);
      msg = '浅瀬を渡った';
      break;
    case 'fight': {
      if (s.rng.next() < Math.min(0.9, s.troops * R.banditPerTroop)) msg = '野伏せりを追い払った';
      else {
        s.troops = Math.max(0, s.troops - 1);
        s.lostTroops++;
        msg = `追い払えず、兵1と米${lose(s, R.banditToll, 'given')}を失った`;
      }
      break;
    }
    case 'pay':
      msg = `米${lose(s, R.banditToll, 'given')}を渡した`;
      break;
    case 'pass':
      break;
    case 'assault': {
      if (s.rng.next() < Math.min(0.9, s.troops * R.assaultPerTroop)) {
        s.taken = true;
        msg = '城が落ちた';
      } else {
        s.troops = Math.max(0, s.troops - 1);
        s.lostTroops++;
        msg = '攻めたが落ちない。兵1が傷ついて離れた';
      }
      break;
    }
    case 'siege':
      passDays(s, 1);
      if (s.rng.next() < R.siegePerDay) {
        s.taken = true;
        msg = '囲み続け、城が落ちた';
      } else msg = '城は持ちこたえた';
      break;
    case 'withdraw':
      msg = '城を落とさず引き上げる';
      break;
  }
  if (msg) s.log.push(`${s.day}日目: ${msg}`);
  s.resolved.add(key);
  if (ev.type === 'shiro') {
    if (s.taken || id === 'withdraw') {
      s.phase = 'back';
      s.pending = null;
    } else s.pending = makeEvent(s);
  } else s.pending = null;
  checkWiped(s);
  return { ok: true };
}

/** 今の拠点に米を置く(帰りに拾う)。行きだけ */
export function exCache(s: ExState, amount: number): { ok: boolean; error?: string } {
  if (s.phase !== 'out' || s.pending) return { ok: false, error: '置けるのは行きの途中だけ' };
  if (s.at === 0) return { ok: false, error: '蔵には置かない' };
  const a = Math.min(s.food, Math.max(0, Math.round(amount)));
  if (a <= 0) return { ok: false, error: '置く米がない' };
  s.food -= a;
  s.cache[s.at] = (s.cache[s.at] ?? 0) + a;
  return { ok: true };
}

/** 荷駄を1隊、先に蔵へ帰す(食べる口が減る。運べなくなった米は置いていく) */
export function exSendHome(s: ExState): { ok: boolean; error?: string } {
  if (s.pending || s.phase === 'done' || s.phase === 'plan') return { ok: false, error: '今は帰せない' };
  if (s.porters <= 0) return { ok: false, error: '荷駄がいない' };
  s.porters--;
  s.sentHome++;
  fitCapacity(s);
  return { ok: true };
}

/** 兵が尽きたら終わり */
function checkWiped(s: ExState): void {
  if (s.troops <= 0 && s.phase !== 'done') {
    s.log.push('兵が尽きた');
    s.pending = null;
    finish(s);
  }
}

function finish(s: ExState): void {
  s.phase = 'done';
  s.pending = null;
  s.log.push(s.troops > 0 ? `${s.day}日目: 蔵に戻った` : `${s.day}日目: 遠征は終わった`);
}

export interface ExResult {
  taken: boolean;
  /** 蔵に戻った隊(兵・荷駄。先に帰した荷駄も含む) */
  home: number;
  total: number;
  burden: number;
  /** 拾わずに道中に残した置き米(余り。蔵へ持ち帰った米は余りに数えない) */
  waste: number;
  score: number;
  maxScore: number;
  stars: number;
}

export function exResult(s: ExState): ExResult {
  const R = s.rules;
  const back = s.phase === 'done' && s.troops > 0;
  const home = (back ? s.troops + s.porters : 0) + s.sentHome;
  const total = R.troops + (s.porters + s.sentHome + s.lostPorters);
  const waste = Object.values(s.cache).reduce((a, b) => a + b, 0);
  const maxScore = R.scoreTaken + total * R.scorePerSquad;
  const score = Math.max(0, (s.taken && back ? R.scoreTaken : 0) + home * R.scorePerSquad - (s.burden + waste) * R.scorePerBurden);
  const r = score / maxScore;
  const stars = r >= 0.9 ? 3 : r >= 0.75 ? 2 : r >= 0.5 ? 1 : 0;
  return { taken: s.taken && back, home, total, burden: s.burden, waste, score, maxScore, stars };
}

/** 米の帳簿のずれ(持っている+置いた = 最初+得た−食べた−失った−渡した) */
export function exLedgerGap(s: ExState): number {
  const held = s.food + Object.values(s.cache).reduce((a, b) => a + b, 0);
  const L = s.ledger;
  return held - (L.start + L.gained - L.eaten - L.lost - L.given);
}
