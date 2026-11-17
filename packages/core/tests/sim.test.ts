import { describe, expect, it } from 'vitest';
import { createState, currentDay, daysLeft, dispatch, step, type Scenario, type SimState } from '../src';
import raw from '../../../games/b-kakuu/data/scenario-01.json';

const scenario = raw as unknown as Scenario;
const fresh = (): SimState => createState(structuredClone(scenario));
const run = (s: SimState, n: number) => {
  for (let i = 0; i < n; i++) step(s);
};

describe('sim: 運ぶ人も食べる', () => {
  it('蔵→陣(5日・10刻み)で、道中の食べた分だけ減って届く', () => {
    const s = fresh();
    const r = dispatch(s, 'c1', 'jin', 50);
    expect(r.ok).toBe(true);
    expect(s.rice.kura).toBe(350);
    run(s, 10);
    // 人足5人×0.5×5日 = 12.5 を食べる → 37.5 届く。陣は 5日間で 60 消費
    expect(s.convoys[0]!.move).toBeNull();
    expect(s.convoys[0]!.at).toBe('jin');
    expect(s.rice.jin).toBeCloseTo(90 + 37.5 - 60, 6);
  });
  it('遠いほど届く量が減る(近い村なら食べる量が少ない)', () => {
    const s = fresh();
    dispatch(s, 'c1', 'mura', 50); // 1日
    run(s, 2);
    expect(s.rice.mura).toBeCloseTo(47.5, 6);
  });
  it('積み荷が道中の食料に足りなければ引き返し、積み荷は失われる', () => {
    const s = fresh();
    dispatch(s, 'c1', 'jin', 5); // 5日で12.5必要
    run(s, 10);
    const c = s.convoys[0]!;
    expect(c.move).toBeNull();
    expect(c.cargo).toBe(0);
    expect(c.at).not.toBe('jin');
    expect(s.log.some((l) => l.text.includes('食料が尽き'))).toBe(true);
  });
  it('経路は日数最短(蔵→陣は河原経由と里経由が同じ5日=10刻み)', () => {
    const s = fresh();
    const r = dispatch(s, 'c1', 'jin', 50);
    expect(r.ok && r.route.days).toBe(5);
  });
});

describe('sim: 検証と終了判定', () => {
  it('不正な出発は拒否する', () => {
    const s = fresh();
    expect(dispatch(s, 'nope', 'jin', 1).ok).toBe(false);
    expect(dispatch(s, 'c1', 'kura', 1).ok).toBe(false);
    expect(dispatch(s, 'c1', 'jin', 51).ok).toBe(false); // 積載上限50
    expect(dispatch(s, 'c1', 'jin', -1).ok).toBe(false);
    s.rice.kura = 10;
    expect(dispatch(s, 'c1', 'jin', 20).ok).toBe(false); // 在庫不足
    expect(dispatch(s, 'c1', 'jin', 10).ok).toBe(true);
    expect(dispatch(s, 'c1', 'mura', 1).ok).toBe(false); // 移動中
  });
  it('何もしなければ陣の兵糧が尽きて失敗(7.5日分あるので8日目)', () => {
    const s = fresh();
    run(s, 100);
    expect(s.outcome).toBe('lost');
    expect(currentDay(s)).toBe(8);
  });
  it('終わった後は進まず、出発もできない', () => {
    const s = fresh();
    run(s, 100);
    const before = s.step;
    step(s);
    expect(s.step).toBe(before);
    expect(dispatch(s, 'c1', 'mura', 1).ok).toBe(false);
  });
  it('残り日数', () => {
    expect(daysLeft(90, 15)).toBe(6);
    expect(daysLeft(45, 0)).toBeNull();
  });
  it('同じシナリオ・同じ操作なら同じ結果(決定性)', () => {
    const play = () => {
      const s = fresh();
      dispatch(s, 'c1', 'jin', 50);
      run(s, 12);
      return JSON.stringify({ r: s.rice, st: s.step, o: s.outcome });
    };
    expect(play()).toBe(play());
  });
});

describe('シナリオ01の難しさ', () => {
  const back = 12.5; // 帰り道の食料: 5人×0.5×5日
  it('素直な手(全隊を満載で送り、着いたら帰りの分を持たせて戻す)で20日保てる', () => {
    const s = fresh();
    let guard = 0;
    while (s.outcome === 'playing' && guard++ < 1000) {
      for (const c of s.convoys) {
        if (c.move) continue;
        if (c.at === 'kura' && s.rice.kura! >= 50) dispatch(s, c.id, 'jin', 50);
        else if (c.at === 'jin' && s.rice.jin! >= back) dispatch(s, c.id, 'kura', back);
      }
      step(s);
    }
    expect(s.outcome).toBe('won');
  });
  it('少なく積むと、道中で食べ尽くして届かない', () => {
    const s = fresh();
    for (const c of s.convoys) dispatch(s, c.id, 'jin', 12);
    run(s, 10);
    expect(s.convoys.every((c) => c.at !== 'jin')).toBe(true);
  });
});
