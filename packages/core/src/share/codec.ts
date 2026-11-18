/**
 * 共有文字列(CLAUDE.md §6)。結果を1行の文字列にして共有する。
 * 形: HY1-<本体>-<チェックサム>
 *   本体: 下の ShareV1 を決まった順の配列にして JSON にし、UTF-8 を base64url にしたもの
 *   チェックサム: 本体の FNV-1a 32bit を16進8桁にしたもの(打ち間違い・欠けを見つけるため。改ざん防止ではない)
 * 注意: 一度公開した版(HY1)の意味は変えない。中身を変えるときは HY2 を作り、HY1 も読めるままにする
 */

/** HY1 で共有する中身 */
export interface ShareV1 {
  /** シナリオID(例: b-01) */
  scenario: string;
  /** シード(同じシナリオ・シードなら同じ展開) */
  seed: number;
  /** 使っていたルールカード(ID を並べたもの。順は問わない) */
  cards: string[];
  /** 'done' = 撤退まで終えた / 'lost' = 陣が落ちた */
  outcome: 'done' | 'lost';
  /** 得点(小数第1位まで) */
  score: number;
  /** ★の数(0〜3) */
  stars: number;
  troopsHome: number;
  carriersHome: number;
  /** 余剰(小数第1位まで) */
  surplus: number;
}

export const SHARE_PREFIX = 'HY1';

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 結果を共有文字列にする */
export function encodeShare(d: ShareV1): string {
  // 配列の並び順が HY1 の意味。並びを変えてはいけない
  const arr = [
    d.scenario,
    d.seed >>> 0,
    [...d.cards].sort(),
    d.outcome === 'lost' ? 0 : 1,
    Math.round(d.score * 10),
    d.stars,
    d.troopsHome,
    d.carriersHome,
    Math.round(d.surplus * 10),
  ];
  const body = toBase64Url(JSON.stringify(arr));
  return `${SHARE_PREFIX}-${body}-${fnv1a(body)}`;
}

export type DecodeResult = { ok: true; data: ShareV1 } | { ok: false; error: string };

const isInt = (v: unknown, min = -Infinity, max = Infinity): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** 共有文字列を読む。形・版・チェックサム・中身の型をすべて確かめる(受け取った文字列を信用しない) */
export function decodeShare(text: string): DecodeResult {
  const m = /^HY(\d+)-([A-Za-z0-9_-]+)-([0-9a-f]{8})$/.exec(text.trim());
  if (!m) return { ok: false, error: '共有文字列の形ではありません' };
  if (m[1] !== '1') return { ok: false, error: `この版(HY${m[1]})には対応していません` };
  const body = m[2]!;
  if (fnv1a(body) !== m[3]) return { ok: false, error: '文字列が欠けているか、書き換わっています' };
  let arr: unknown;
  try {
    arr = JSON.parse(fromBase64Url(body));
  } catch {
    return { ok: false, error: '中身を読めません' };
  }
  if (!Array.isArray(arr) || arr.length !== 9) return { ok: false, error: '中身の形が違います' };
  const [scenario, seed, cards, outcome, score10, stars, troopsHome, carriersHome, surplus10] = arr as unknown[];
  if (typeof scenario !== 'string' || !/^[a-z0-9-]{1,20}$/.test(scenario)) return { ok: false, error: 'シナリオが不正です' };
  if (!isInt(seed, 0, 0xffffffff)) return { ok: false, error: 'シードが不正です' };
  if (!Array.isArray(cards) || cards.length > 10 || !cards.every((c) => typeof c === 'string' && /^[a-z]{1,12}$/.test(c))) {
    return { ok: false, error: 'カードが不正です' };
  }
  if (outcome !== 0 && outcome !== 1) return { ok: false, error: '結果が不正です' };
  if (!isInt(score10, -1e7, 1e7) || !isInt(stars, 0, 3) || !isInt(troopsHome, 0, 1e5) || !isInt(carriersHome, 0, 1e5) || !isInt(surplus10, 0, 1e8)) {
    return { ok: false, error: '数値が不正です' };
  }
  return {
    ok: true,
    data: {
      scenario,
      seed,
      cards: cards as string[],
      outcome: outcome === 0 ? 'lost' : 'done',
      score: round1(score10 / 10),
      stars,
      troopsHome,
      carriersHome,
      surplus: round1(surplus10 / 10),
    },
  };
}
