/// <reference types="vite/client" />
/** すべての作品(games/*)のすべてのシナリオ(data/scenario-*.json)を集める */
import type { Scenario } from '../../src';

const files = import.meta.glob('../../../../games/*/data/scenario-*.json', { eager: true, import: 'default' });

export const ALL_SCENARIOS: { game: string; scenario: Scenario }[] = Object.entries(files)
  .map(([path, data]) => ({ game: path.split('/games/')[1]!.split('/')[0]!, scenario: data as Scenario }))
  .sort((a, b) => (a.game + a.scenario.id).localeCompare(b.game + b.scenario.id));

/** ボットで遊ばせる決まったシード */
export const BOT_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
