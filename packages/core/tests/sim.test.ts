import { describe, expect, it } from 'vitest';
import {
  createState,
  currentDay,
  daysLeft,
  dispatch,
  eatenOver,
  evaluate,
  nodeConsumptionPerDay,
  retreatPlan,
  retreatRoute,
  shortestRoute,
  step,
  type Scenario,
  type SimState,
} from '../src';
import raw from '../../../games/b-kakuu/data/scenario-01.json';

const scenario = raw as unknown as Scenario;
const fresh = (mutate?: (sc: Scenario) => void): SimState => {
  const sc = structuredClone(scenario);
  mutate?.(sc);
  return createState(sc);
};
const run = (s: SimState, n: number) => {
  for (let i = 0; i < n; i++) step(s);
};
/** 終わるまで、毎刻み bot に指図させながら進める */
const playOut = (s: SimState, bot: (s: SimState) => void) => {
  let guard = 0;
  while (s.outcome === 'playing' && guard++ < 1000) {
    bot(s);
    step(s);
  }
  return s;
};

// 前線の兵 24人 × 0.5 = 1日12 を食べる
const FRONT_PER_DAY = 12;
const BACK = 12.5; // 運搬隊(5人)が陣から蔵へ戻る5日分

describe('運ぶ人も食べる', () => {
  it('蔵→陣(5日・10刻み)で、道中の食べた分だけ減って届く', () => {
    const s = fresh();
    const r = dispatch(s, 'c1', 'jin', 50);
    expect(r.ok).toBe(true);
    expect(s.rice.kura).toBe(440 - 50);
    run(s, 10);
    // 人足5人×0.5×5日 = 12.5 を食べる → 37.5 届く。陣は 5日間で 60 消費
    expect(s.convoys[0]!.move).toBeNull();
    expect(s.convoys[0]!.at).toBe('jin');
    expect(s.rice.jin).toBeCloseTo(90 + 37.5 - 5 * FRONT_PER_DAY, 6);
  });
  it('遠いほど届く量が減る(近い村なら食べる量が少ない)', () => {
    const s = fresh();
    dispatch(s, 'c1', 'mura', 50); // 1日
    run(s, 2);
    expect(s.rice.mura).toBeCloseTo(47.5, 6);
  });
  it('積み荷が道中の食料に足りなければ、人足が離脱して隊は動かせなくなる(積み荷は失われる)', () => {
    const s = fresh();
    dispatch(s, 'c1', 'jin', 5); // 5日で12.5必要
    run(s, 10);
    const c = s.convoys[0]!;
    expect(c.dropped).toBe(true);
    expect(c.move).toBeNull();
    expect(c.cargo).toBe(0);
    expect(c.at).not.toBe('jin');
    expect(dispatch(s, 'c1', 'kura', 0).ok).toBe(false);
    expect(s.log.some((l) => l.text.includes('離脱'))).toBe(true);
  });
  it('経路は日数最短(蔵→陣は河原経由の5日)', () => {
    const s = fresh();
    const r = dispatch(s, 'c1', 'jin', 50);
    expect(r.ok && r.route).toEqual({ nodes: ['kura', 'kawa', 'jin'], days: 5 });
  });
});

describe('陣の保持', () => {
  it('保持中は陣の兵が1日12を食べ、残り日数に反映される', () => {
    const s = fresh();
    expect(nodeConsumptionPerDay(s, 'jin')).toBe(FRONT_PER_DAY);
    expect(nodeConsumptionPerDay(s, 'kawa')).toBe(0);
    run(s, 2);
    expect(s.rice.jin).toBe(90 - FRONT_PER_DAY);
  });
  it('何もしなければ陣の兵糧が尽きて失敗(7.5日分あるので8日目)', () => {
    const s = fresh();
    run(s, 100);
    expect(s.outcome).toBe('lost');
    expect(currentDay(s)).toBe(8);
    expect(evaluate(s).held).toBe(false);
    expect(evaluate(s).score).toBe(0);
  });
});

describe('撤退(帰り道の補給)', () => {
  it('撤退路は陣→河原→蔵の5日で、ほかの道より短い(同じ日数の道がない)', () => {
    const s = fresh();
    expect(retreatRoute(s)).toEqual({ nodes: ['jin', 'kawa', 'kura'], days: 5 });
    // 里の村を経由すると 3 + 1.5 + 1 = 5.5日、峠経由は 3 + 2 + 1 = 6日
    expect(shortestRoute(s.scenario.map, 'kawa', 'kura')!.days).toBe(2);
  });
  it('撤退の見積もり: 必要60、兵が持てるのは48、河原に12置く必要がある', () => {
    const plan = retreatPlan(fresh());
    expect(plan.need).toBe(60);
    expect(plan.capacity).toBe(48);
    expect(plan.fromFront).toBe(48);
    expect(plan.stops).toEqual([{ id: 'kawa', required: 12, have: 0 }]);
  });
  it('20日目に撤退を始め、陣から持てるだけ持ち出す。陣での消費は止まる', () => {
    const s = fresh((sc) => (sc.nodes.jin!.rice = 1000));
    run(s, 40);
    expect(s.army.phase).toBe('retreat');
    expect(s.army.cargo).toBe(48);
    expect(s.rice.jin).toBe(1000 - 20 * FRONT_PER_DAY - 48);
    expect(nodeConsumptionPerDay(s, 'jin')).toBe(0);
    const jinAfter = s.rice.jin;
    run(s, 1);
    expect(s.rice.jin).toBe(jinAfter);
  });
  it('持てる量に余裕があっても、残りの道のりに要る分しか持ち出さない(残りは余剰になる)', () => {
    const s = fresh((sc) => {
      sc.nodes.jin!.rice = 1000;
      sc.army.capacityPer = 10; // 240まで持てる
    });
    run(s, 40);
    expect(s.army.cargo).toBe(60);
    expect(s.rice.jin).toBe(1000 - 20 * FRONT_PER_DAY - 60);
    run(s, 10);
    expect(s.army).toMatchObject({ phase: 'home', troops: 24, cargo: 0 });
  });
  it('河原に置き米があれば受け取り、全員が蔵に戻る。残りの米は蔵に納める', () => {
    const s = fresh((sc) => {
      sc.nodes.jin!.rice = 1000;
      sc.nodes.kawa = { rice: 12 };
    });
    run(s, 50);
    expect(s.army.phase).toBe('home');
    expect(s.army.troops).toBe(24);
    expect(s.army.dropped).toBe(0);
    expect(s.rice.kawa).toBe(0);
    expect(s.log.some((l) => l.text.includes('河原で米12を受け取った'))).toBe(true);
  });
  it('置き米がないと、最後の1日分が足りず、食べられなかった兵の一部が離脱する(半日ごとに25%)', () => {
    const s = fresh((sc) => (sc.nodes.jin!.rice = 1000));
    run(s, 50);
    // 河原に着いた時点で残り12。あと2日(4刻み)で24要る。
    // 3刻み目: 24人が食べられず6人離脱 → 4刻み目: 18人が食べられず5人離脱 → 13人帰還
    expect(s.army.phase).toBe('home');
    expect(s.army.troops).toBe(13);
    expect(s.army.dropped).toBe(11);
  });
  it('置き米が全くなく陣も空なら、兵は少しずつ離脱しながら帰る(一度に全員はいなくならない)', () => {
    const s = fresh((sc) => {
      sc.nodes.jin!.rice = 20 * FRONT_PER_DAY; // ちょうど20日分。撤退時は0
    });
    run(s, 40);
    expect(s.army.phase).toBe('retreat');
    expect(s.army.cargo).toBe(0);
    run(s, 1);
    expect(s.army.troops).toBe(18);
  });
});

describe('遠征の終わりと評価', () => {
  it('軍勢が蔵に戻り、移動中の運搬隊がいなくなったら終わる', () => {
    const s = fresh((sc) => {
      sc.nodes.jin!.rice = 1000;
      sc.nodes.kawa = { rice: 12 };
    });
    // 撤退中に、蔵から峠へ隊を出しておく(3日かかるので、軍勢が帰り着いた後も移動中)
    run(s, 48);
    expect(dispatch(s, 'c1', 'toge', 10).ok).toBe(true);
    run(s, 2); // 25日目に軍勢が帰る。隊はまだ移動中
    expect(s.army.phase).toBe('home');
    expect(s.outcome).toBe('playing');
    run(s, 4);
    expect(s.outcome).toBe('done');
  });
  it('評価: 蔵にいない人足は未帰還、蔵以外に残った米は余剰として減点', () => {
    const s = fresh((sc) => {
      sc.nodes.jin!.rice = 1000;
      sc.nodes.kawa = { rice: 12 };
    });
    run(s, 60);
    expect(s.outcome).toBe('done');
    const r = evaluate(s);
    const leftAtJin = 1000 - 20 * FRONT_PER_DAY - 48;
    expect(r).toMatchObject({ held: true, troopsHome: 24, troopsTotal: 24, carriersHome: 20, carriersTotal: 20 });
    expect(r.surplus).toBe(leftAtJin);
    expect(r.surplusByNode).toEqual([{ id: 'jin', rice: leftAtJin }]);
    expect(r.score).toBe(44 * 10 - leftAtJin);
  });
  it('陣に置き去りにした運搬隊は帰還に数えない', () => {
    const s = fresh((sc) => {
      sc.nodes.jin!.rice = 1000;
      sc.nodes.kawa = { rice: 12 };
      sc.convoys[0]!.at = 'jin';
    });
    run(s, 60);
    expect(s.outcome).toBe('done');
    expect(evaluate(s).carriersHome).toBe(15);
  });
});

describe('シナリオ01の難しさ(自動プレイで確認)', () => {
  /** 素直な手: 20日目までに着く便を満載で送り、着いたら帰り分を持たせて戻す。撤退の準備はしない */
  const naive = (s: SimState) => {
    for (const c of s.convoys) {
      if (c.move || c.dropped) continue;
      if (c.at === 'kura' && s.rice.kura! >= 50 && currentDay(s) + 5 <= s.scenario.goalDays) dispatch(s, c.id, 'jin', 50);
      else if (c.at === 'jin' && s.rice.jin! >= BACK) dispatch(s, c.id, 'kura', BACK);
    }
  };
  /** 備える手: 素直な手に加えて、河原に撤退用の米(+運んだ隊が戻る分)を置く */
  const prepared = (extra: number) => {
    let sent = false;
    return (s: SimState) => {
      for (const c of s.convoys) {
        if (c.move || c.dropped) continue;
        if (c.at === 'kura' && !sent && currentDay(s) >= 12) {
          const req = retreatPlan(s).stops.find((x) => x.id === 'kawa')!.required;
          // 行き2日で5食べ、戻りに5使う
          sent = dispatch(s, c.id, 'kawa', req + 10 + extra).ok;
          continue;
        }
        if (c.at === 'kawa' && s.rice.kawa! >= 5) {
          dispatch(s, c.id, 'kura', 5);
          continue;
        }
        naive(s);
      }
    };
  };

  it('素直な手では陣は保てるが、撤退で兵が離脱する', () => {
    const s = playOut(fresh(), naive);
    const r = evaluate(s);
    expect(s.outcome).toBe('done');
    expect(r.held).toBe(true);
    expect(r.troopsHome).toBeLessThan(24);
  });
  it('備える手なら全員が帰る', () => {
    const s = playOut(fresh(), prepared(0));
    const r = evaluate(s);
    expect(r).toMatchObject({ troopsHome: 24, carriersHome: 20 });
    expect(r.score).toBeGreaterThan(evaluate(playOut(fresh(), naive)).score);
  });
  it('河原に置きすぎると余剰が増え、得点が下がる', () => {
    const ok = evaluate(playOut(fresh(), prepared(0)));
    const over = evaluate(playOut(fresh(), prepared(10)));
    expect(over.troopsHome).toBe(24);
    expect(over.surplus).toBeGreaterThan(ok.surplus);
    expect(over.score).toBeLessThan(ok.score);
  });
  it('少なく積むと、道中で食べ尽くして届かない', () => {
    const s = fresh();
    for (const c of s.convoys) dispatch(s, c.id, 'jin', 12);
    run(s, 10);
    expect(s.convoys.every((c) => c.dropped && c.at !== 'jin')).toBe(true);
  });
});

describe('入力の検査と決定性', () => {
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
      return JSON.stringify({ r: s.rice, st: s.step, o: s.outcome, a: s.army });
    };
    expect(play()).toBe(play());
  });
});

describe('検証で見つかった問題の回帰テスト', () => {
  it('帰り分ちょうどを積めば、食事量・人数・行き先によらず浮動小数の誤差で尽きない', () => {
    const bad: string[] = [];
    for (const r of [0.1, 0.2, 0.3, 0.35, 0.6, 0.7, 1.1, 1.3]) {
      for (const n of [3, 5, 7]) {
        for (const d of ['mura', 'kawa', 'toge', 'jin']) {
          const s = fresh((sc) => {
            sc.carrierRation = r;
            sc.carrierCapacity = 100;
            sc.convoys[0]!.carriers = n;
            sc.nodes.jin!.rice = 1000;
          });
          const c = s.convoys[0]!;
          const route = shortestRoute(s.scenario.map, c.at, d)!;
          dispatch(s, c.id, d, eatenOver(c, r, route.days));
          for (let i = 0; i < 40 && c.move; i++) step(s);
          if (c.at !== d || c.dropped) bad.push(`ration=${r} n=${n} to=${d}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
  it('道の日数が刻みの倍数でないシナリオは拒否する(画面の予告と実際の消費がずれるため)', () => {
    expect(() => fresh((sc) => (sc.map.links[0] = { ...sc.map.links[0]!, days: 1.2 }))).toThrow(/倍数/);
  });
  it('シナリオの参照切れ・不正値を拒否する', () => {
    const cases: ((sc: Scenario) => void)[] = [
      (sc) => (sc.convoys[0]!.at = 'nowhere'),
      (sc) => (sc.frontId = 'nowhere'),
      (sc) => (sc.depotId = 'nowhere'),
      (sc) => (sc.depotId = sc.frontId),
      (sc) => (sc.nodes['nowhere'] = { rice: 1 }),
      (sc) => (sc.convoys[1]!.id = sc.convoys[0]!.id),
      (sc) => (sc.convoys[0]!.carriers = 0),
      (sc) => (sc.stepDays = 0),
      (sc) => (sc.army.troops = 0),
      (sc) => (sc.army.troops = 2.5),
      (sc) => (sc.army.hungerDropRate = 0),
      (sc) => (sc.army.hungerDropRate = 1.5),
      (sc) => (sc.map.links = sc.map.links.filter((l) => l.b !== 'jin')),
    ];
    cases.forEach((mutate, i) => {
      expect(() => fresh(mutate), `case ${i}`).toThrow();
    });
  });
  it('本番のシナリオ01は検査を通る', () => {
    expect(() => fresh()).not.toThrow();
  });
});
