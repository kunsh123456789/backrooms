import { Level0 } from './level0.js';
import { House } from './house.js';

export const LEVEL_INFO = {
  house: { codex: true, checkpoint: false },
  level0: { codex: true, checkpoint: true },
};

export function createLevel(id, game, seed, opts) {
  switch (id) {
    case 'house':
      return new House(game, seed, opts);
    case 'housewrong':
      return new House(game, seed, { ...opts, wrong: true });
    case 'level0':
      return new Level0(game, seed, opts);
    default:
      return new Level0(game, seed, opts);
  }
}
