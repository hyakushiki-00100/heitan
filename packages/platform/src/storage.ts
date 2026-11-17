/**
 * localStorage の薄い包み。読み書きはすべて try/catch で囲み、
 * 使えない環境(プライベートブラウズ・容量超過・無効化)でも例外を外に出さない。
 * 保存できなくてもゲームは遊べること(CLAUDE.md §6)。
 */

/** localStorage と同じ形の最小インターフェース(テストで差し替えるため) */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** キーの前置き。保存形式を変えるときは v2 にし、古い値は読まない */
export const KEY_PREFIX = 'hyoro:v1:';

/** ブラウザの localStorage。参照するだけで例外が出る環境もあるので try で囲む */
export function browserStore(): KeyValueStore | null {
  try {
    const s = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/**
 * JSON を読む。無い・壊れている・形が違う・読めない場合は fallback を返す。
 * isValid で形を確かめる(保存先は利用者が書き換えられるので、中身を信用しない)。
 */
export function loadJson<T>(
  key: string,
  fallback: T,
  isValid: (v: unknown) => v is T,
  store: KeyValueStore | null = browserStore(),
): T {
  if (!store) return fallback;
  try {
    const raw = store.getItem(KEY_PREFIX + key);
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    return isValid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** JSON を書く。書けたら true、書けなければ false(例外は出さない) */
export function saveJson(key: string, value: unknown, store: KeyValueStore | null = browserStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(KEY_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
