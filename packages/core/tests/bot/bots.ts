/**
 * 自動プレイボット(画面なしで sim を直接動かす)。CLAUDE.md §9「完了前の自動確認」
 * - idle: 何も運ばない(最低点の基準)
 * - naive: 陣へ日数最短の道で満載で直送し、着いたら帰り分だけ積んで戻る。置き米はしない。
 *          積荷は画面の既定と同じ「陣の割合」(物資のないシナリオでは米だけ)。素朴なプレイの代わり
 * - rules:…: 全隊を自動にし、決まったルールカードの組み合わせで動かす
 */
import {
  candidateRoutes,
  currentDay,
  dispatch,
  maxLoad,
  nodeAmounts,
  retreatPlan,
  runRules,
  setAuto,
  setCardActive,
  tripPreview,
  type CardId,
  type SimState,
} from '../../src';

export interface Bot {
  name: string;
  /** 遠征の最初に1回だけ呼ぶ */
  setup?(s: SimState): void;
  /** 毎刻み、step の前に呼ぶ */
  act(s: SimState): void;
}

export const idle: Bot = { name: 'idle', act: () => {} };

export const naive: Bot = {
  name: 'naive',
  act(s) {
    const sc = s.scenario;
    for (const c of s.convoys) {
      if (c.move || c.dropped) continue;
      if (c.at === sc.depotId) {
        // 撤退が始まった後や、撤退開始までに着かないなら出さない
        const route = candidateRoutes(sc.map, c.at, sc.frontId, 1)[0];
        if (!route || s.army.phase !== 'hold' || currentDay(s) + route.days > sc.goalDays) continue;
        const eat = tripPreview(s, c, route.nodes, 0)!.eat;
        const room = maxLoad(c, sc.carrierCapacity) - eat;
        const here = nodeAmounts(s, c.at);
        const shares = retreatPlan(s).shares;
        const goods: Record<string, number> = {};
        let used = 0;
        for (const [id, sh] of Object.entries(shares)) {
          if (id === 'rice') continue;
          goods[id] = Math.min(room * sh, here[id] ?? 0);
          used += goods[id]!;
        }
        const rice = Math.min(eat + room - used, here.rice ?? 0);
        if (rice <= eat) continue;
        dispatch(s, c.id, sc.frontId, rice, route.nodes, goods);
      } else {
        const route = candidateRoutes(sc.map, c.at, sc.depotId, 1)[0];
        if (!route) continue;
        const eat = tripPreview(s, c, route.nodes, 0)!.eat;
        if ((s.rice[c.at] ?? 0) >= eat) dispatch(s, c.id, sc.depotId, eat, route.nodes);
      }
    }
  },
};

/** 全隊を自動にし、cards を有効にして動かすボット */
export function rulesBot(cards: CardId[]): Bot {
  return {
    name: `rules:${cards.length ? cards.join('+') : 'none'}`,
    setup(s) {
      for (const c of s.convoys) setAuto(s, c.id, true);
      for (const id of cards) setCardActive(s, id, true);
    },
    act: (s) => runRules(s),
  };
}

/** preset-rules: 用意したルールカードの組み合わせ(シナリオに無いカードは setCardActive が無視する) */
export const PRESET_CARDS: CardId[][] = [[], ['kiro'], ['kiro', 'chukei'], ['kiro', 'goei'], ['kiro', 'chukei', 'goei']];

export const ALL_BOTS: Bot[] = [idle, naive, ...PRESET_CARDS.map(rulesBot)];
