import { SaveData } from './core/settings.js';
import { CODEX } from './lore.js';

// Three ways it ends: go home (almost), stop looking, or the tape cuts out.

export function runEnding(game, kind, opts = {}) {
  if (game._endingBusy) return;
  game._endingBusy = true;
  const a = game.audio;
  const fx = game.fx;
  const p = game.player;
  game.ui.setPrompt(null);
  game.ui.closeAll();

  if (kind === 'lost') {
    // abrupt: a burst of static, then nothing
    game.state = 'ending';
    game.seq = null;
    a.play('static', { gain: 0.9, bus: 'ui', rate: 0.8 });
    fx.staticAmt = 1;
    a.fadeWorld(0, 0.05);
    game.input.unlock();
    setTimeout(() => {
      fx.staticAmt = 0;
      fx.fade = 1;
      fx.fadeColor.setRGB(0, 0, 0);
    }, 450);
    game.codex.addEnding('lost');
    setTimeout(() => {
      const cause = opts.by ? ` Something ${by(opts.by)}.` : '';
      game.ui.showEnding('LOST TAPE', `The recording ends here.${cause}`, () => {
        game._endingBusy = false;
        a.fadeWorld(1, 0.5);
        if (SaveData.load()) game.continueGame();
        else game.goMenu();
      });
    }, 2600);
    return;
  }

  if (kind === 'wander') {
    // you stop looking for the exit; the camera keeps walking
    game.state = 'ending';
    game.codex.addEnding('wander');
    SaveData.clear();
    let t = 0;
    game.endingUpdate = (dt) => {
      t += dt;
      p.yaw += Math.sin(t * 0.13) * dt * 0.15;
      const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
      p.pos.x -= s * dt * 0.9;
      p.pos.z -= c * dt * 0.9;
      game.world.collide(p.pos, 0.3, 0.4, 1.7);
      p.pitch *= 0.99;
      game.camera.position.set(p.pos.x, p.pos.y + 1.55 + Math.sin(t * 2.3) * 0.02, p.pos.z);
      game.camera.rotation.set(p.pitch - 0.08, p.yaw, Math.sin(t * 0.5) * 0.01, 'YXZ');
      game.world.update(p.pos.x, p.pos.z);
      game.lights.update(dt);
      game.audio.updateListener(game.camera);
      game._updateHumAudio(dt, p.pos);
      fx.glitch = Math.max(0, 0.6 - t * 0.02);
      fx.fade = Math.min(1, Math.max(0, (t - 14) / 10));
    };
    game.input.unlock();
    setTimeout(() => {
      const e = CODEX.endings.wander;
      game.ui.showEnding('WANDERER', e.text, () => {
        game._endingBusy = false;
        game.endingUpdate = null;
        game.goMenu();
      });
    }, 22000);
    return;
  }

  if (kind === 'escape') {
    // through the door, and home
    game.seq = { kind: 'transition', noPause: true, wait: 0, gen: escapeSeq(game) };
  }
}

function by(type) {
  return {
    hound: 'was faster than you',
    smiler: 'was smiling in the dark',
    partygoer: 'wanted you to stay',
    chaser: 'caught up',
  }[type] || 'found you';
}

function* escapeSeq(game) {
  const a = game.audio, fx = game.fx;
  game.player.frozen = true;
  a.play('creak', { gain: 0.5, bus: 'ui', rate: 0.9 });
  fx.fadeColor.setRGB(1, 0.95, 0.85);
  a.fadeWorld(0, 2);
  for (let t = 0; t < 1; t += 0.03) {
    fx.fade = t;
    yield 0.05;
  }
  fx.fade = 1;
  yield 2;
  fx.fadeColor.setRGB(0, 0, 0);
  game.loadLevel('housewrong');
  game.state = 'play';
  game._endingBusy = false;
  game.player.frozen = false;
  a.fadeWorld(1, 3);
  for (let t = 0; t < 4; t += 0.05) {
    fx.fade = 1 - t / 4;
    yield 0.05;
  }
  fx.fade = 0;
  game.finishEscape = () => {
    // after a while, quietly: the end
    game.seq = { kind: 'transition', noPause: true, wait: 0, gen: escapeEnd(game) };
  };
}

function* escapeEnd(game) {
  const fx = game.fx, a = game.audio;
  yield 3;
  game.player.frozen = true;
  a.fadeWorld(0.3, 6);
  for (let t = 0; t < 6; t += 0.05) {
    fx.fade = t / 6;
    yield 0.05;
  }
  fx.fade = 1;
  game.state = 'ending';
  game.codex.addEnding('escape');
  SaveData.clear();
  game.input.unlock();
  game.ui.showEnding('HOME', 'You made it back. The fridge hums. The clock ticks.<br><br>Somewhere in the walls, very faintly, something buzzes.', () => {
    a.fadeWorld(1, 0.5);
    game.goMenu();
  });
}
