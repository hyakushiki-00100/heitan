import { describe, expect, it } from 'vitest';
import { neighbors, shortestRoute, validateMap, type GameMap } from '../src';

const map: GameMap = {
  nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: id, kind: 'camp' as const, x: i, y: 0 })),
  links: [
    { a: 'a', b: 'b', days: 1 },
    { a: 'b', b: 'c', days: 1 },
    { a: 'a', b: 'c', days: 5 },
  ],
};

describe('map / route', () => {
  it('正しい地図は検査を通る', () => {
    expect(() => validateMap(map)).not.toThrow();
  });
  it('不正な地図を検出する', () => {
    expect(() => validateMap({ ...map, links: [{ a: 'a', b: 'zzz', days: 1 }] })).toThrow();
    expect(() => validateMap({ ...map, links: [{ a: 'a', b: 'b', days: 0 }] })).toThrow();
    expect(() => validateMap({ ...map, links: [{ a: 'a', b: 'b', days: 1 }, { a: 'b', b: 'a', days: 1 }] })).toThrow();
    expect(() => validateMap({ ...map, nodes: [...map.nodes, map.nodes[0]!] })).toThrow();
  });
  it('隣接ノード', () => {
    expect(neighbors(map, 'a').sort()).toEqual(['b', 'c']);
  });
  it('最短経路は日数で選ぶ(遠回りでも短ければそちら)', () => {
    expect(shortestRoute(map, 'a', 'c')).toEqual({ nodes: ['a', 'b', 'c'], days: 2 });
  });
  it('同じ地点・到達不能', () => {
    expect(shortestRoute(map, 'a', 'a')).toEqual({ nodes: ['a'], days: 0 });
    expect(shortestRoute(map, 'a', 'd')).toBeNull();
  });
});
