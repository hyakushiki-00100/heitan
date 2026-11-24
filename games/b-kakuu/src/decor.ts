/**
 * 地図の飾り(山・川・海・林・田・湿地・題箋・方位)のデータ。シミュレーションには関係しない。
 * 座標は地図と同じ 0〜100。余白にも描くため -25〜120 まで認める
 */
import raw from '../data/decor.json';
import type { NodeIcon } from './icons';

export type Pt = [number, number];
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface MapDecor {
  scenarios: string[];
  /** 絵図の題(縦書きで題箋に書く) */
  title: string;
  titleCorner: Corner;
  compassCorner: Corner;
  /** 拠点の絵の種類(拠点ID → 絵) */
  icons: Record<string, NodeIcon>;
  /** 海(多角形) */
  sea?: Pt[];
  /** 山 [x, 麓のy, 大きさ] */
  mountains: [number, number, number][];
  rivers: { width: number; points: Pt[] }[];
  /** 林 [x, y, 木の数] */
  forests: [number, number, number][];
  fields: Pt[];
  marsh: Pt[];
}

export const DECOR_MIN = -25;
export const DECOR_MAX = 120;

export const DECORS = (raw as unknown as { maps: MapDecor[] }).maps;

export function decorFor(scenarioId: string): MapDecor | null {
  return DECORS.find((d) => d.scenarios.includes(scenarioId)) ?? null;
}
