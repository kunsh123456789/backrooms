// Keyboard + mouse + pointer lock.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.onLockChange = null;
    this.onKey = null; // (code, event) for UI handling

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Space' && this.locked) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    // Fallback when the browser refuses pointer lock (some embedded frames):
    // the camera follows the mouse as it moves, and turns on its own when the
    // cursor rests near the edge of the screen.
    this.lockFailed = false;
    this.mx = 0.5;
    this.my = 0.5;
    this.inside = false;
    this.onCanvasClick = null;
    canvas.addEventListener('click', () => this.onCanvasClick && this.onCanvasClick());
    document.addEventListener('mouseleave', () => (this.inside = false));
    window.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget) this.inside = false;
    });
    document.addEventListener('mousemove', (e) => {
      this.inside = true;
      this.mx = e.clientX / window.innerWidth;
      this.my = e.clientY / window.innerHeight;
      if (!this.locked && !this.lockFailed) return;
      // Guard against browser spikes on lock acquisition.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.lockFailed = false;
      canvas.style.cursor = this.locked ? 'none' : 'crosshair';
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.lockFailed = true;
    });
  }

  lock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => (this.lockFailed = true));
    } catch (e) {
      this.lockFailed = true;
    }
    // some frames refuse silently: fall back if nothing happened
    clearTimeout(this._lockT);
    this._lockT = setTimeout(() => {
      if (!this.locked) this.lockFailed = true;
    }, 700);
  }

  /** Continuous turning when the cursor rests near a screen edge (fallback mode). */
  edgeTurn() {
    if (this.locked || !this.lockFailed || !this.inside) return [0, 0];
    const zone = 0.12;
    const f = (v) => (v < zone ? -(1 - v / zone) : v > 1 - zone ? (v - (1 - zone)) / zone : 0);
    return [f(this.mx), f(this.my) * 0.6];
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  consumeMouse() {
    const d = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
  }
}
