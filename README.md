# NOCLIPPED — a recovered tape

A first-person liminal horror exploration game set in the Backrooms, playable in the browser.

The game is about atmosphere, not monsters. Most of the time nothing happens:
you're alone in endless, familiar-but-wrong spaces, listening to fluorescent
lights hum. Entities are rare, and you'll glimpse far more of them than you meet.

```bash
npm install && npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). Headphones help:
much of the game is sound.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Look |
| Shift | Run (loud) |
| C / Ctrl | Crouch (quiet) |
| F | Flashlight |
| E | Interact (doors, pickups, notes) |
| Tab | Pockets (inventory, notes, journal) |
| Q | Drink Almond Water |
| R | Replace flashlight battery |
| Esc | Pause / settings |

There's no HUD. You hear your stamina in your breathing and see it as tunnel
vision. You notice your sanity going when the camera glitches, the walls seem
to breathe, footsteps follow you and the hum starts to sound like words.

## What's in it

- **Opening, the noclip.** A suburban house at 3 AM. The hallway is too long, the
  hall closet goes back much too far, the pantry opens onto the kitchen you're
  standing in, and the clock doesn't always keep time. Walk into a wall and stay
  there.
- **Level 0, "The Lobby".** Endless procedural yellow rooms, with water damage
  and dead lights. No entities for the first ten minutes or so. The way out is
  through pockets where the lights have failed.
- **Level 1, "Habitable Zone".** A vast concrete parking structure with puddles,
  supply crates and stairwells going down.
- **Level 2, "Pipe Dreams".** Hot, narrow maintenance tunnels with steam and
  distant clanking. Look for a red door.
- **Level !, "Run For Your Life".** Red emergency light, an alarm, something
  behind you.
- **Level 4, "Abandoned Office".** Cubicles, humming water coolers, windows onto
  white. One of the windows is open.
- **Level 37, "The Poolrooms".** White tile, still turquoise water, daylight from
  nowhere. Nothing lives here.
- **Level Fun =).** A party, reached through doors with balloons tied to them.
  Don't let the guests get close.
- **Entities**, each a small state machine gated by the dread director: Facelings,
  Smilers, Hounds, Partygoers, the Skin-Stealer (a voice only), the thing in
  Level !, and peripheral hallucinations.
- **Three endings:** go home (almost), wander forever, or be lost.
- **Extras:** notes from past wanderers, a journal/codex that persists between
  runs, checkpoints at level entry (localStorage), and settings for sensitivity,
  volume, FOV, graphics quality, film effects, head bob and invert Y.

## How it works

- **Lighting** (`src/gfx/lights.js`, `src/gfx/builder.js`). Every light is a slot
  in a float data texture. Chunk geometry stores, per vertex, the 8 strongest
  lights and their baked, occlusion-aware weights. The vertex shader looks up
  each light's current intensity every frame. This means thousands of
  fluorescent panels can each flicker, fail or be switched off by the director,
  at the cost of one small texture upload and no real-time shadow lights.
- **Camcorder post-processing** (`src/gfx/post.js`): HDR scene at reduced
  resolution, centre-weighted auto-exposure that adapts slowly, bloom, barrel
  distortion, chromatic aberration, VHS chroma bleed, tracking bands, gain noise
  that rises in the dark, glitches tied to sanity, and a feedback smear for the
  noclip fall.
- **Audio** (`src/audio/`). Everything is synthesised at startup with no audio
  files. That covers footsteps per surface, breathing, formant-synthesised
  voices, door slams, drags, clanks, and the reverb impulse responses
  themselves. Three convolution reverbs are cross-faded by room size, which is
  measured with raycasts. The fluorescent hum feeds a pool of spatialised voices
  attached to the nearest lights, synced to their flicker, and it can drop out
  entirely.
- **Dread director** (`src/director.js`). It tracks how long it's been since the
  last event and builds tension slowly. Most evaluations do nothing. When it
  does act, it escalates: a distant sound, then lights going out, then a
  glimpse, and only rarely an encounter.
- **Worlds** (`src/world/world.js`, `src/levels/`). Deterministic chunk layouts
  (walls on grid edges, lights, props) are streamed around the player. Border
  openings come from a shared hash, so neighbouring chunks always agree. Level 0
  chunks you've walked through can quietly regenerate once they're out of
  range, so the path behind you isn't always the same.

## Building

```bash
npm run build && npm run preview
```
