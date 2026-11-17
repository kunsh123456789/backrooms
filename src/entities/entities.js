// Entity manager (filled in during the entity phase).
export class Entities {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.fearSource = 0;
    this.glitch = 0;
    this.busy = false;
  }
  clear() {
    for (const e of this.list) e.dispose?.();
    this.list = [];
  }
  spawn() {
    return false;
  }
  peripheral() {}
  update() {}
}
