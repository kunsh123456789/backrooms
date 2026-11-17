import * as THREE from 'three';
import { RNG, fbm2, valueNoise2 } from '../core/math.js';

// Procedural canvas textures. Everything here is drawn at startup, so nothing
// copyrighted ships with the game. Stains, water damage and wear are baked in.

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTex(c, { srgb = true, repeat = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Fill with tileable fbm noise around a base colour (noise computed at low res, grain at full res). */
function noiseFill(ctx, w, h, base, amp, scale, seed, alphaFn = null) {
  const lw = Math.max(8, w >> 2), lh = Math.max(8, h >> 2);
  const lc = canvas(lw, lh), lctx = lc.getContext('2d');
  const limg = lctx.createImageData(lw, lh);
  const ld = limg.data;
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const u = x / lw, v = y / lh;
      const n =
        fbm2(u * scale, v * scale, seed) * (1 - u) * (1 - v) +
        fbm2((u - 1) * scale, v * scale, seed) * u * (1 - v) +
        fbm2(u * scale, (v - 1) * scale, seed) * (1 - u) * v +
        fbm2((u - 1) * scale, (v - 1) * scale, seed) * u * v;
      const k = (n - 0.5) * amp;
      const i = (y * lw + x) * 4;
      ld[i] = Math.max(0, Math.min(255, base[0] + k * 255));
      ld[i + 1] = Math.max(0, Math.min(255, base[1] + k * 255));
      ld[i + 2] = Math.max(0, Math.min(255, base[2] + k * 255));
      ld[i + 3] = alphaFn ? alphaFn(u, v, n) : 255;
    }
  }
  lctx.putImageData(limg, 0, 0);
  // tile 3x3 so smoothing wraps at the edges
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, w, h);
  const sx = w / lw, sy = h / lh;
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(lc, 0, 0, lw, lh, 0, 0, w + sx, h + sy);
  ctx.restore();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const g = amp * 0.5 * 255;
  for (let i = 0; i < d.length; i += 4) {
    const r = (Math.random() - 0.5) * g;
    d[i] += r;
    d[i + 1] += r;
    d[i + 2] += r;
  }
  ctx.putImageData(img, 0, 0);
}

/** Irregular water stain with darker tide-line rings. */
function stain(ctx, x, y, r, rgb, alpha, rng, rings = true) {
  const pts = 18;
  const path = () => {
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = r * (0.7 + 0.5 * valueNoise2(Math.cos(a) * 2 + x, Math.sin(a) * 2 + y, 7));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.85;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  };
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.1);
  g.addColorStop(0, `rgba(${rgb},${alpha * 0.6})`);
  g.addColorStop(0.7, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  path();
  ctx.fillStyle = g;
  ctx.fill();
  if (rings) {
    ctx.lineWidth = 1 + rng.next() * 2;
    ctx.strokeStyle = `rgba(${rgb},${alpha * 1.3})`;
    path();
    ctx.stroke();
  }
}

function wrapDraw(w, h, x, y, fn) {
  // draw at the position and its wrapped copies so stains tile seamlessly
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) fn(x + ox, y + oy);
}

const T = {
  // --- Level 0 ---
  wallpaper0() {
    const W = 1024, H = 640; // 4m x 2.7m
    const c = canvas(W, H), ctx = c.getContext('2d');
    const rng = new RNG(11);
    noiseFill(ctx, W, H, [196, 178, 104], 0.07, 8, 3);
    // faint vertical stripe pattern with tiny chevrons - the mono-yellow wallpaper
    for (let x = 0; x < W; x += 32) {
      ctx.fillStyle = 'rgba(150,128,60,0.08)';
      ctx.fillRect(x, 0, 3, H);
      ctx.fillStyle = 'rgba(240,225,150,0.06)';
      ctx.fillRect(x + 14, 0, 2, H);
      for (let y = 0; y < H; y += 20) {
        ctx.strokeStyle = 'rgba(140,118,50,0.09)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x + 8, y);
        ctx.lineTo(x + 16, y + 6);
        ctx.lineTo(x + 24, y);
        ctx.stroke();
      }
    }
    // water damage trickling from the ceiling, uneven
    for (let i = 0; i < 3; i++) {
      const x = rng.range(0, W);
      const len = rng.range(40, 200);
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(110,85,30,0.22)');
      g.addColorStop(1, 'rgba(110,85,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, rng.range(10, 50), len);
    }
    for (let i = 0; i < 2; i++) {
      const x = rng.range(0, W), y = rng.range(H * 0.2, H * 0.7);
      wrapDraw(W, H, x, y, (px, py) => stain(ctx, px, py, rng.range(30, 80), '120,95,35', 0.07, rng));
    }
    // grime and moisture at the base
    const g2 = ctx.createLinearGradient(0, H, 0, H - 130);
    g2.addColorStop(0, 'rgba(70,55,20,0.5)');
    g2.addColorStop(1, 'rgba(70,55,20,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, H - 130, W, 130);
    // baseboard
    ctx.fillStyle = 'rgba(120,100,55,0.9)';
    ctx.fillRect(0, H - 22, W, 22);
    ctx.fillStyle = 'rgba(80,65,30,0.8)';
    ctx.fillRect(0, H - 23, W, 2);
    // seams every 0.5m roll width
    ctx.fillStyle = 'rgba(120,100,50,0.12)';
    for (let x = 0; x < W; x += 128) ctx.fillRect(x, 0, 1.5, H);
    return toTex(c);
  },

  carpet0() {
    const W = 512;
    const c = canvas(W), ctx = c.getContext('2d');
    const rng = new RNG(5);
    // alpha encodes wetness for the WET shader path
    noiseFill(ctx, W, W, [142, 120, 66], 0.12, 5, 21, (u, v, n) => 255 - Math.max(0, Math.min(1, (n - 0.6) / 0.14)) * 110);
    // fibres
    const img = ctx.getImageData(0, 0, W, W);
    for (let i = 0; i < img.data.length; i += 4) {
      const f = (Math.random() - 0.5) * 26;
      img.data[i] += f;
      img.data[i + 1] += f;
      img.data[i + 2] += f * 0.7;
    }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 4; i++) {
      const x = rng.range(0, W), y = rng.range(0, W);
      wrapDraw(W, W, x, y, (px, py) => stain(ctx, px, py, rng.range(30, 110), '85,65,25', rng.range(0.06, 0.14), rng, rng.chance(0.4)));
    }
    return toTex(c);
  },

  ceiling0() {
    const W = 512; // 2.4m = 4 tiles
    const c = canvas(W), ctx = c.getContext('2d');
    const rng = new RNG(9);
    noiseFill(ctx, W, W, [205, 197, 160], 0.07, 14, 41);
    // perforations
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(90,85,60,${0.08 + Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * W, Math.random() * W, 1.2, 1.2);
    }
    for (let i = 0; i < 4; i++) {
      const x = rng.range(0, W), y = rng.range(0, W);
      wrapDraw(W, W, x, y, (px, py) => stain(ctx, px, py, rng.range(18, 50), '140,110,45', rng.range(0.15, 0.35), rng));
    }
    // T-bar grid
    ctx.fillStyle = 'rgba(160,150,120,1)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(i * 128, 0, 5, W);
      ctx.fillRect(0, i * 128, W, 5);
    }
    ctx.fillStyle = 'rgba(90,85,65,0.5)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(i * 128 + 5, 0, 1, W);
      ctx.fillRect(0, i * 128 + 5, W, 1);
    }
    return toTex(c);
  },

  panel() {
    const W = 128, H = 256;
    const c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    // prismatic diffuser and the two tubes behind it
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(200,200,190,1)');
    g.addColorStop(0.3, 'rgba(255,255,250,1)');
    g.addColorStop(0.5, 'rgba(225,225,215,1)');
    g.addColorStop(0.7, 'rgba(255,255,250,1)');
    g.addColorStop(1, 'rgba(200,200,190,1)');
    ctx.fillStyle = g;
    ctx.fillRect(6, 6, W - 12, H - 12);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 6; y < H - 6; y += 4) ctx.fillRect(6, y, W - 12, 1);
    // dead bugs
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(40,30,20,0.5)';
      ctx.fillRect(10 + Math.random() * (W - 20), H - 30 + Math.random() * 20, 2, 2);
    }
    ctx.strokeStyle = 'rgba(120,120,110,1)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    return toTex(c, { repeat: false });
  },

  // --- generic / props ---
  plaster() {
    const c = canvas(256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, [200, 195, 180], 0.08, 8, 77);
    return toTex(c);
  },
  black() {
    const c = canvas(4), ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 4, 4);
    return toTex(c);
  },
  white() {
    const c = canvas(4), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 4, 4);
    return toTex(c);
  },
  wood() {
    const W = 256;
    const c = canvas(W), ctx = c.getContext('2d');
    noiseFill(ctx, W, W, [120, 82, 50], 0.1, 4, 88);
    for (let y = 0; y < W; y += 2) {
      ctx.fillStyle = `rgba(60,35,15,${0.05 + 0.08 * Math.abs(Math.sin(y * 0.13 + Math.sin(y * 0.031) * 4))})`;
      ctx.fillRect(0, y, W, 1.5);
    }
    return toTex(c);
  },
  woodfloor() {
    const W = 512;
    const c = canvas(W), ctx = c.getContext('2d');
    const rng = new RNG(3);
    noiseFill(ctx, W, W, [112, 76, 46], 0.08, 5, 55);
    const pw = 64;
    for (let x = 0; x < W; x += pw) {
      const off = rng.range(0, W);
      ctx.fillStyle = `rgba(${rng.int(60, 110)},${rng.int(40, 70)},20,0.25)`;
      ctx.fillRect(x, 0, pw, W);
      for (let y = 0; y < W; y += 3) {
        ctx.fillStyle = `rgba(50,30,12,${0.04 + 0.06 * Math.abs(Math.sin((y + off) * 0.09))})`;
        ctx.fillRect(x, y, pw, 1);
      }
      ctx.fillStyle = 'rgba(30,18,8,0.7)';
      ctx.fillRect(x, 0, 2, W);
      ctx.fillRect(x, (off | 0) % W, pw, 2);
    }
    return toTex(c);
  },
  housewall() {
    const W = 512, H = 640;
    const c = canvas(W, H), ctx = c.getContext('2d');
    noiseFill(ctx, W, H, [176, 165, 140], 0.05, 6, 91);
    // faint damask-ish diamonds
    ctx.strokeStyle = 'rgba(140,125,100,0.12)';
    ctx.lineWidth = 2;
    for (let y = -40; y < H + 40; y += 80) {
      for (let x = 0; x < W + 64; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 32, y + 40);
        ctx.lineTo(x, y + 80);
        ctx.lineTo(x - 32, y + 40);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(235,230,220,1)';
    ctx.fillRect(0, H - 30, W, 30);
    ctx.fillStyle = 'rgba(120,110,90,0.6)';
    ctx.fillRect(0, H - 31, W, 2);
    return toTex(c);
  },
  housecarpet() {
    const c = canvas(256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, [92, 88, 92], 0.12, 12, 61);
    return toTex(c);
  },
  kitchentile() {
    const W = 256;
    const c = canvas(W), ctx = c.getContext('2d');
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#c9c4b5' : '#8c8578';
        ctx.fillRect(x * 64, y * 64, 64, 64);
      }
    const img = ctx.getImageData(0, 0, W, W);
    for (let i = 0; i < img.data.length; i += 4) {
      const f = (Math.random() - 0.5) * 12;
      img.data[i] += f;
      img.data[i + 1] += f;
      img.data[i + 2] += f;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(60,55,50,0.6)';
    for (let i = 0; i <= 4; i++) {
      ctx.fillRect(i * 64 - 1, 0, 2, W);
      ctx.fillRect(0, i * 64 - 1, W, 2);
    }
    return toTex(c);
  },
  fabric() {
    const c = canvas(256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, [78, 82, 92], 0.12, 20, 63);
    return toTex(c);
  },
  couch() {
    const c = canvas(256), ctx = c.getContext('2d');
    noiseFill(ctx, 256, 256, [92, 70, 58], 0.1, 16, 64);
    return toTex(c);
  },
  metal() {
    const W = 256;
    const c = canvas(W), ctx = c.getContext('2d');
    const rng = new RNG(17);
    noiseFill(ctx, W, W, [110, 105, 98], 0.12, 10, 19);
    for (let i = 0; i < 14; i++) {
      const x = rng.range(0, W), y = rng.range(0, W);
      wrapDraw(W, W, x, y, (px, py) => stain(ctx, px, py, rng.range(6, 30), '120,60,25', rng.range(0.2, 0.5), rng, false));
    }
    return toTex(c);
  },
  appliance() {
    const c = canvas(128), ctx = c.getContext('2d');
    noiseFill(ctx, 128, 128, [214, 212, 205], 0.04, 6, 90);
    return toTex(c);
  },

  // --- Level 1 ---
  concrete() {
    const W = 512;
    const c = canvas(W), ctx = c.getContext('2d');
    const rng = new RNG(23);
    noiseFill(ctx, W, W, [120, 122, 122], 0.18, 7, 29, (u, v, n) => (n > 0.6 ? Math.max(60, 255 - (n - 0.6) * 1400) : 255));
    for (let i = 0; i < 10; i++) {
      const x = rng.range(0, W), y = rng.range(0, W);
      wrapDraw(W, W, x, y, (px, py) => stain(ctx, px, py, rng.range(20, 90), '60,62,60', rng.range(0.1, 0.25), rng, false));
    }
    // cracks
    ctx.strokeStyle = 'rgba(40,40,40,0.5)';
    for (let i = 0; i < 4; i++) {
      let x = rng.range(0, W), y = rng.range(0, W);
      ctx.lineWidth = rng.range(0.6, 1.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 14; k++) {
        x += rng.range(-14, 14);
        y += rng.range(-14, 14);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // expansion joints
    ctx.fillStyle = 'rgba(50,50,50,0.5)';
    ctx.fillRect(0, 0, W, 2);
    ctx.fillRect(0, 0, 2, W);
    return toTex(c);
  },
  blockwall() {
    const W = 512, H = 512;
    const c = canvas(W, H), ctx = c.getContext('2d');
    noiseFill(ctx, W, H, [128, 128, 124], 0.14, 9, 31);
    ctx.fillStyle = 'rgba(70,70,68,0.6)';
    const bh = 64, bw = 128;
    for (let y = 0; y < H; y += bh) {
      ctx.fillRect(0, y, W, 3);
      const off = (y / bh) % 2 ? bw / 2 : 0;
      for (let x = off; x < W + bw; x += bw) ctx.fillRect(x, y, 3, bh);
    }
    const g = ctx.createLinearGradient(0, H, 0, H - 120);
    g.addColorStop(0, 'rgba(40,40,40,0.5)');
    g.addColorStop(1, 'rgba(40,40,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - 120, W, 120);
    return toTex(c);
  },
  pillar() {
    const W = 256, H = 512;
    const c = canvas(W, H), ctx = c.getContext('2d');
    noiseFill(ctx, W, H, [132, 132, 128], 0.15, 6, 37);
    // painted base band, scuffed
    ctx.fillStyle = 'rgba(170,150,60,0.75)';
    ctx.fillRect(0, H - 70, W, 50);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(30,30,30,0.7)';
      ctx.save();
      ctx.translate(i * 48, H - 70);
      ctx.transform(1, 0, -0.6, 1, 0, 0);
      ctx.fillRect(0, 0, 20, 50);
      ctx.restore();
    }
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(110,110,105,${Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * W, H - 70 + Math.random() * 50, 3, 2);
    }
    // number stencil
    ctx.fillStyle = 'rgba(30,30,30,0.55)';
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('B' + (((Math.random() * 9) | 0) + 1), W / 2, 180);
    return toTex(c);
  },
  crate() {
    const W = 256;
    const c = canvas(W), ctx = c.getContext('2d');
    noiseFill(ctx, W, W, [150, 120, 80], 0.12, 5, 41);
    ctx.fillStyle = 'rgba(70,50,30,0.6)';
    for (let i = 0; i < W; i += 42) ctx.fillRect(0, i, W, 3);
    ctx.strokeStyle = 'rgba(70,50,30,0.8)';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, W - 12, W - 12);
    ctx.fillStyle = 'rgba(40,30,20,0.6)';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('SUPPLY', 70, 140);
    return toTex(c);
  },

  // --- Level 2 ---
  tunnelwall() {
    const W = 512;
    const c = canvas(W), ctx = c.getContext('2d');
    const rng = new RNG(51);
    noiseFill(ctx, W, W, [92, 80, 68], 0.2, 8, 53);
    ctx.fillStyle = 'rgba(40,30,20,0.4)';
    for (let y = 0; y < W; y += 42) ctx.fillRect(0, y, W, 3);
    for (let i = 0; i < 16; i++) {
      const x = rng.range(0, W), y = rng.range(0, W);
      wrapDraw(W, W, x, y, (px, py) => stain(ctx, px, py, rng.range(10, 60), '50,35,20', rng.range(0.2, 0.4), rng, false));
    }
    return toTex(c);
  },
  grate() {
    const W = 256;
    const c = canvas(W), ctx = c.getContext('2d');
    noiseFill(ctx, W, W, [70, 66, 60], 0.15, 8, 57, (u, v, n) => (n > 0.6 ? 170 : 255));
    ctx.fillStyle = 'rgba(20,18,15,0.85)';
    for (let y = 0; y < W; y += 16) for (let x = 0; x < W; x += 16) ctx.fillRect(x + 3, y + 3, 10, 10);
    return toTex(c);
  },
  rust() {
    const W = 256;
    const c = canvas(W), ctx = c.getContext('2d');
    noiseFill(ctx, W, W, [120, 72, 40], 0.25, 10, 59);
    ctx.fillStyle = 'rgba(60,50,40,0.3)';
    for (let x = 0; x < W; x += 32) ctx.fillRect(x, 0, 2, W);
    return toTex(c);
  },

  // --- Level 4 ---
  officecarpet() {
    const W = 512;
    const c = canvas(W), ctx = c.getContext('2d');
    noiseFill(ctx, W, W, [84, 90, 98], 0.12, 18, 67);
    ctx.fillStyle = 'rgba(40,44,50,0.35)';
    for (let i = 0; i <= 2; i++) {
      ctx.fillRect(i * 256 - 1, 0, 2, W);
      ctx.fillRect(0, i * 256 - 1, W, 2);
    }
    const rng = new RNG(4);
    for (let i = 0; i < 3; i++) stain(ctx, rng.range(0, W), rng.range(0, W), rng.range(10, 30), '40,40,30', 0.2, rng);
    return toTex(c);
  },
  officewall() {
    const W = 512, H = 640;
    const c = canvas(W, H), ctx = c.getContext('2d');
    noiseFill(ctx, W, H, [196, 190, 176], 0.05, 6, 71);
    ctx.fillStyle = 'rgba(90,90,95,1)';
    ctx.fillRect(0, H - 24, W, 24);
    return toTex(c);
  },
  cubicle() {
    const W = 256;
    const c = canvas(W), ctx = c.getContext('2d');
    noiseFill(ctx, W, W, [104, 110, 120], 0.1, 30, 73);
    ctx.fillStyle = 'rgba(160,160,165,1)';
    ctx.fillRect(0, 0, W, 8);
    return toTex(c);
  },
  monitor() {
    const c = canvas(128), ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1b1c';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#060707';
    ctx.fillRect(10, 10, 108, 90);
    return toTex(c);
  },

  // --- Level 37 ---
  pooltile() {
    const W = 512;
    const c = canvas(W), ctx = c.getContext('2d');
    const n = 8, s = W / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = 236 + Math.random() * 14;
        ctx.fillStyle = `rgb(${v - 4},${v},${v + 2})`;
        ctx.fillRect(x * s, y * s, s, s);
        const g = ctx.createLinearGradient(x * s, y * s, x * s + s, y * s + s);
        g.addColorStop(0, 'rgba(255,255,255,0.25)');
        g.addColorStop(1, 'rgba(180,190,190,0.12)');
        ctx.fillStyle = g;
        ctx.fillRect(x * s, y * s, s, s);
      }
    ctx.fillStyle = 'rgba(165,175,172,1)';
    for (let i = 0; i <= n; i++) {
      ctx.fillRect(i * s - 1.5, 0, 3, W);
      ctx.fillRect(0, i * s - 1.5, W, 3);
    }
    return toTex(c);
  },

  // --- Level ! ---
  redwall() {
    const W = 512, H = 512;
    const c = canvas(W, H), ctx = c.getContext('2d');
    noiseFill(ctx, W, H, [150, 146, 140], 0.15, 8, 81);
    ctx.fillStyle = 'rgba(150,20,20,0.7)';
    ctx.fillRect(0, H * 0.55, W, 40);
    ctx.fillStyle = 'rgba(40,40,40,0.4)';
    for (let y = 0; y < H; y += 64) ctx.fillRect(0, y, W, 2);
    return toTex(c);
  },

  // --- Level Fun ---
  partywall() {
    const W = 512, H = 640;
    const c = canvas(W, H), ctx = c.getContext('2d');
    noiseFill(ctx, W, H, [226, 206, 120], 0.05, 6, 85);
    const cols = ['#e23b5a', '#3b7be2', '#3bd17a', '#f0c030', '#b04be0'];
    const rng = new RNG(8);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = cols[i % cols.length];
      ctx.globalAlpha = 0.5;
      const x = rng.range(0, W), y = rng.range(0, H);
      ctx.beginPath();
      ctx.ellipse(x, y, 10, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = cols[i % cols.length];
      ctx.beginPath();
      ctx.moveTo(x, y + 13);
      ctx.quadraticCurveTo(x + 6, y + 25, x, y + 38);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return toTex(c);
  },
  partyfloor() {
    const W = 256;
    const c = canvas(W), ctx = c.getContext('2d');
    noiseFill(ctx, W, W, [170, 60, 70], 0.12, 12, 87);
    const cols = ['#ff5', '#5cf', '#f5c', '#5f8', '#fff'];
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = cols[i % cols.length];
      ctx.fillRect(Math.random() * W, Math.random() * W, 3, 2);
    }
    return toTex(c);
  },

  // --- decals / signs ---
  exitsign() {
    const c = canvas(256, 96), ctx = c.getContext('2d');
    ctx.fillStyle = '#0b1a0d';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#6dff8a';
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText('EXIT', 24, 68);
    ctx.beginPath();
    ctx.moveTo(180, 30);
    ctx.lineTo(230, 48);
    ctx.lineTo(180, 66);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(160, 42, 24, 12);
    return toTex(c, { repeat: false });
  },
  paper() {
    const c = canvas(128, 160), ctx = c.getContext('2d');
    noiseFill(ctx, 128, 160, [222, 216, 196], 0.05, 4, 93);
    ctx.strokeStyle = 'rgba(30,30,60,0.6)';
    ctx.lineWidth = 1.2;
    for (let y = 22; y < 140; y += 11) {
      ctx.beginPath();
      ctx.moveTo(12, y);
      let x = 12;
      while (x < 112) {
        x += 3 + Math.random() * 5;
        ctx.lineTo(x, y + (Math.random() - 0.5) * 3);
        if (Math.random() < 0.12) {
          x += 6;
          ctx.moveTo(x, y);
        }
      }
      ctx.stroke();
    }
    return toTex(c, { repeat: false });
  },
  label() {
    // almond water label
    const c = canvas(128, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#e8e2cf';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#7a5a30';
    ctx.font = 'bold 14px serif';
    ctx.fillText('ALMOND', 32, 28);
    ctx.fillText('WATER', 36, 46);
    return toTex(c, { repeat: false });
  },
  battery() {
    const c = canvas(64, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#c8962a';
    ctx.fillRect(0, 0, 64, 24);
    return toTex(c, { repeat: false });
  },
  wetsign() {
    const c = canvas(128, 160), ctx = c.getContext('2d');
    ctx.fillStyle = '#e8c21c';
    ctx.fillRect(0, 0, 128, 160);
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.moveTo(64, 20);
    ctx.lineTo(104, 88);
    ctx.lineTo(24, 88);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8c21c';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('!', 56, 82);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('CAUTION', 26, 118);
    ctx.font = '13px sans-serif';
    ctx.fillText('WET FLOOR', 30, 138);
    return toTex(c, { repeat: false });
  },
  clockface() {
    const c = canvas(128), ctx = c.getContext('2d');
    ctx.fillStyle = '#efe9dc';
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillRect(64 + Math.cos(a) * 52 - 2, 64 + Math.sin(a) * 52 - 2, 4, 4);
    }
    return toTex(c, { repeat: false });
  },
  smiler() {
    const W = 256, H = 128;
    const c = canvas(W, H), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // eyes
    for (const x of [78, 178]) {
      const g = ctx.createRadialGradient(x, 30, 0, x, 30, 18);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 20, 10, 40, 40);
    }
    // grin of jagged teeth
    ctx.fillStyle = 'rgba(255,255,245,1)';
    ctx.beginPath();
    ctx.moveTo(30, 66);
    ctx.quadraticCurveTo(128, 140, 226, 66);
    ctx.quadraticCurveTo(128, 100, 30, 66);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,1)';
    for (let i = 0; i < 18; i++) {
      const t = i / 17;
      const x = 34 + t * 188;
      const y = 70 + Math.sin(t * Math.PI) * 26;
      ctx.fillRect(x, y - 8, 1.6, 14);
    }
    return toTex(c, { repeat: false, srgb: true });
  },
  partyface() {
    const c = canvas(128), ctx = c.getContext('2d');
    ctx.fillStyle = '#e8cf3a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#1a1010';
    ctx.fillRect(38, 40, 14, 6);
    ctx.fillRect(38, 54, 14, 6);
    ctx.fillRect(76, 40, 14, 6);
    ctx.fillRect(76, 54, 14, 6);
    ctx.strokeStyle = '#b0101a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(64, 60, 34, 0.25, Math.PI - 0.25);
    ctx.stroke();
    return toTex(c, { repeat: false });
  },
  glow() {
    const c = canvas(64), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return toTex(c, { repeat: false });
  },
  steam() {
    const c = canvas(64), ctx = c.getContext('2d');
    for (let i = 0; i < 6; i++) {
      const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 22);
      g.addColorStop(0, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    return toTex(c, { repeat: false });
  },
  streamer() {
    const c = canvas(32, 128), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 32, 128);
    const cols = ['#e23b5a', '#3b7be2', '#f0c030', '#3bd17a'];
    ctx.fillStyle = cols[(Math.random() * 4) | 0];
    for (let y = 0; y < 128; y += 2) ctx.fillRect(10 + Math.sin(y * 0.15) * 6, y, 10, 2);
    return toTex(c, { repeat: false });
  },
};

export function tex(name) {
  if (!cache.has(name)) {
    const fn = T[name];
    if (!fn) throw new Error('unknown texture ' + name);
    cache.set(name, fn());
  }
  return cache.get(name);
}
