import { describe, expect, it } from 'vitest';
import type { Scenario } from '@hyoro/core';
import { DECORS, DECOR_MAX, DECOR_MIN, decorFor, type Pt } from '../src/decor';

const files = import.meta.glob('../data/scenario-*.json', { eager: true, import: 'default' });
const SCENARIOS = Object.values(files) as unknown as Scenario[];

type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
function crosses(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
const pt = (p: Pt): P => ({ x: p[0], y: p[1] });

describe('地図の飾り', () => {
  it('どのシナリオにも飾りがちょうど1つある。知らないシナリオIDはない', () => {
    for (const s of SCENARIOS) expect(DECORS.filter((d) => d.scenarios.includes(s.id)), s.id).toHaveLength(1);
    const ids = new Set(SCENARIOS.map((s) => s.id));
    for (const d of DECORS) for (const id of d.scenarios) expect(ids.has(id), id).toBe(true);
  });

  for (const s of SCENARIOS) {
    describe(s.id, () => {
      const d = decorFor(s.id)!;
      const nodes = s.map.nodes;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const links = s.map.links.map((l) => ({ l, a: byId.get(l.a)!, b: byId.get(l.b)! }));
      const mid = (x: (typeof links)[number]) => ({ x: (x.a.x + x.b.x) / 2, y: (x.a.y + x.b.y) / 2 });

      it('座標は描ける範囲にある', () => {
        const all: number[][] = [...d.mountains, ...d.forests, ...d.fields, ...d.marsh, ...(d.sea ?? []), ...d.rivers.flatMap((r) => r.points)];
        for (const p of all) for (const v of p.slice(0, 2)) expect(v >= DECOR_MIN && v <= DECOR_MAX, String(p)).toBe(true);
        expect(d.title.length).toBeGreaterThan(0);
        expect(d.title.length).toBeLessThanOrEqual(8);
      });

      it('山・林・田は拠点から離れ(10以上)、道の線(5以上)と道の日数の札(9以上)にかからない', () => {
        const items: [string, P][] = [
          ...d.mountains.map((m) => [`山${m}`, pt([m[0], m[1]])] as [string, P]),
          ...d.forests.map((m) => [`林${m}`, pt([m[0], m[1]])] as [string, P]),
          ...d.fields.map((m) => [`田${m}`, pt(m)] as [string, P]),
        ];
        for (const [name, p] of items) {
          for (const n of nodes) expect(dist(p, n), `${name} と ${n.id}`).toBeGreaterThanOrEqual(10);
          for (const x of links) {
            expect(segDist(p, x.a, x.b), `${name} と道 ${x.l.a}-${x.l.b}`).toBeGreaterThanOrEqual(5);
            expect(dist(p, mid(x)), `${name} と札 ${x.l.a}-${x.l.b}`).toBeGreaterThanOrEqual(9);
          }
        }
      });

      it('川は拠点から離れ、交わる道は「川越え」の道だけ(川を見て危険な道が分かるように)', () => {
        for (const r of d.rivers) {
          for (const n of nodes) for (let i = 0; i + 1 < r.points.length; i++) {
            expect(segDist(n, pt(r.points[i]!), pt(r.points[i + 1]!)), n.id).toBeGreaterThanOrEqual(8);
          }
          for (const x of links) {
            let hit = false;
            for (let i = 0; i + 1 < r.points.length; i++) if (crosses(pt(r.points[i]!), pt(r.points[i + 1]!), x.a, x.b)) hit = true;
            expect(hit, `${x.l.a}-${x.l.b}`).toBe(x.l.risk?.label === '川越え');
          }
        }
        const riverLinks = s.map.links.filter((l) => l.risk?.label === '川越え');
        if (riverLinks.length) expect(d.rivers.length).toBeGreaterThan(0);
      });
    });
  }
});
