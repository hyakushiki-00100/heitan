/**
 * 広告の差し込み口(インターフェースだけ)。SDK は公開先が決まってから実装する(CLAUDE.md §6)。
 * 既定は「広告なし」。ゲーム側は ads() を呼ぶだけにして、公開先ごとに setAdProvider で差し替える。
 */

export type RewardResult = 'rewarded' | 'skipped' | 'unavailable';

export interface AdProvider {
  /** 広告を出せる状態か */
  readonly available: boolean;
  /** リワード広告を出す。placement は出す場所の名前(例: 'retry') */
  showRewarded(placement: string): Promise<RewardResult>;
}

/** 広告なし。常に unavailable を返す */
export const noAds: AdProvider = {
  available: false,
  showRewarded: async () => 'unavailable',
};

let current: AdProvider = noAds;

export function setAdProvider(p: AdProvider): void {
  current = p;
}

export function ads(): AdProvider {
  return current;
}
