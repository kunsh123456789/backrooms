import { Level0 } from './level0.js';
import { House } from './house.js';
import { Level1 } from './level1.js';
import { Level2 } from './level2.js';
import { Level4 } from './level4.js';
import { Level37 } from './level37.js';
import { LevelRun } from './levelRun.js';
import { LevelFun } from './levelFun.js';

export const LEVEL_INFO = {
  house: { codex: true, checkpoint: false },
  housewrong: { codex: false, checkpoint: false },
  level0: { codex: true, checkpoint: true },
  level1: { codex: true, checkpoint: true },
  level2: { codex: true, checkpoint: true },
  level4: { codex: true, checkpoint: true },
  level37: { codex: true, checkpoint: true },
  levelRun: { codex: true, checkpoint: false },
  levelFun: { codex: true, checkpoint: true },
};

const REG = { level0: Level0, level1: Level1, level2: Level2, level4: Level4, level37: Level37, levelRun: LevelRun, levelFun: LevelFun };

export function registerLevel(id, cls) {
  REG[id] = cls;
}

export function createLevel(id, game, seed, opts) {
  if (id === 'house') return new House(game, seed, opts);
  if (id === 'housewrong') return new House(game, seed, { ...opts, wrong: true });
  const C = REG[id] || Level0;
  return new C(game, seed, opts);
}
