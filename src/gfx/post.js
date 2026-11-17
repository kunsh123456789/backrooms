import * as THREE from 'three';

// Camcorder post pipeline:
// scene (HDR, reduced res) -> luminance/auto-exposure -> bloom -> VHS composite
// (lens distortion, chromatic aberration, chroma bleed, tracking, grain, glitch)
// -> optional feedback smear (used by the noclip fall).

const VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function pass(fs, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
}

const LUM_FS = /* glsl */ `
uniform sampler2D tScene; varying vec2 vUv;
void main(){
  // centre-weighted metering like a cheap camcorder
  vec2 c = vUv - 0.5;
  float w = 1.0 - smoothstep(0.15, 0.6, length(c));
  vec3 s = texture(tScene, vUv).rgb;
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(log(l + 0.002) * (0.35 + 0.65 * w), 0.35 + 0.65 * w, 0.0, 1.0);
}`;

const ADAPT_FS = /* glsl */ `
uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uDt; uniform float uSnap;
varying vec2 vUv;
void main(){
  vec4 m = textureLod(tLum, vec2(0.5), 10.0);
  float avg = exp(m.r / max(m.g, 0.001));
  float prev = texture(tPrev, vec2(0.5)).r;
  // brighten slowly (the iris opening in the dark), darken a bit faster
  float speed = avg > prev ? 1.4 : 0.55;
  float a = uSnap > 0.5 ? avg : prev + (avg - prev) * (1.0 - exp(-uDt * speed));
  gl_FragColor = vec4(a, 0.0, 0.0, 1.0);
}`;

const BRIGHT_FS = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tAdapt; uniform float uKey; uniform float uThreshold; uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  float ad = texture(tAdapt, vec2(0.5)).r;
  float ex = uKey / clamp(ad, 0.04, 3.0);
  vec3 c = vec3(0.0);
  c += texture(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tScene, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture(tScene, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture(tScene, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25 * ex;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 0.6, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FS = /* glsl */ `
uniform sampler2D tIn; uniform vec2 uDir; varying vec2 vUv;
void main(){
  vec3 c = texture(tIn, vUv).rgb * 0.227;
  c += texture(tIn, vUv + uDir * 1.385).rgb * 0.316;
  c += texture(tIn, vUv - uDir * 1.385).rgb * 0.316;
  c += texture(tIn, vUv + uDir * 3.231).rgb * 0.070;
  c += texture(tIn, vUv - uDir * 3.231).rgb * 0.070;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMP_FS = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB; uniform sampler2D tAdapt; uniform sampler2D tPrev;
uniform vec2 uRes; uniform vec2 uSceneTexel; uniform float uTime;
uniform float uFilm; uniform float uKey; uniform float uBloom; uniform float uGlitch; uniform float uTunnel;
uniform float uFade; uniform vec3 uFadeColor; uniform float uSmear; uniform float uTrack; uniform float uStatic;
uniform vec3 uGrade; uniform float uSat; uniform float uContrast; uniform float uLift; uniform float uRedTint;
uniform float uNoise; uniform float uSoft; uniform float uDistortion; uniform float uFixedExposure;
varying vec2 vUv;

float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }

vec3 sampleScene(vec2 uv){
  // soft focus: small 5-tap blur, like a cheap lens never quite in focus
  vec3 c = texture(tScene, uv).rgb * 0.4;
  vec2 o = uSceneTexel * uSoft;
  c += texture(tScene, uv + vec2(o.x, 0.0)).rgb * 0.15;
  c += texture(tScene, uv - vec2(o.x, 0.0)).rgb * 0.15;
  c += texture(tScene, uv + vec2(0.0, o.y)).rgb * 0.15;
  c += texture(tScene, uv - vec2(0.0, o.y)).rgb * 0.15;
  return c;
}

vec3 rgb2yiq(vec3 c){ return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
vec3 yiq2rgb(vec3 c){ return vec3(c.x + 0.956*c.y + 0.621*c.z, c.x - 0.272*c.y - 0.647*c.z, c.x - 1.106*c.y + 1.703*c.z); }

void main(){
  vec2 uv = vUv;
  float t = uTime;
  // lens barrel distortion
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  uv = 0.5 + cc * (1.0 + uDistortion * r2 * uFilm);

  // VHS line wobble + tracking band
  float line = floor(uv.y * uRes.y / 2.0);
  float wob = (h12(vec2(line, floor(t * 30.0))) - 0.5) * 0.0009 * uFilm;
  float bandY = fract(t * 0.071 + sin(t * 0.13) * 0.3);
  float band = smoothstep(0.06, 0.0, abs(uv.y - bandY)) * uTrack;
  wob += band * (h12(vec2(line, t)) - 0.5) * 0.012;
  // sanity glitch: block displacement
  float gb = step(1.0 - uGlitch * 0.25, h12(vec2(floor(uv.y * 24.0), floor(t * 12.0))));
  wob += gb * (h12(vec2(floor(t * 12.0), 3.0)) - 0.5) * 0.08 * uGlitch;
  uv.x += wob;

  float ad = texture(tAdapt, vec2(0.5)).r;
  float ex = uKey / clamp(ad, 0.04, 3.0);
  ex = mix(ex, uKey, uFixedExposure);
  float gain = clamp(ex / uKey, 0.5, 6.0);

  // chromatic aberration grows toward the edges
  float ca = (0.0012 + r2 * 0.006 + uGlitch * 0.004 + band * 0.004) * uFilm;
  vec3 col;
  col.r = sampleScene(uv + cc * ca * 2.0).r;
  col.g = sampleScene(uv).g;
  col.b = sampleScene(uv - cc * ca * 2.0).b;

  // VHS chroma bleed: luma sharp, chroma smeared horizontally
  if (uFilm > 0.5) {
    vec3 yiq = rgb2yiq(col);
    vec3 cb = vec3(0.0);
    for (int i = -3; i <= 3; i++) cb += rgb2yiq(texture(tScene, uv + vec2(float(i) * uSceneTexel.x * 2.5 + uSceneTexel.x * 3.0, 0.0)).rgb);
    cb /= 7.0;
    col = yiq2rgb(vec3(yiq.x, cb.y, cb.z) );
  }

  col *= ex;
  vec3 bloom = texture(tBloomA, uv).rgb * 0.6 + texture(tBloomB, uv).rgb * 0.8;
  col += bloom * uBloom;

  // grade
  col *= uGrade;
  col = aces(col * 1.1);
  col = pow(col, vec3(1.0 / 2.2));
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, uSat);
  col = (col - 0.5) * uContrast + 0.5 + uLift;
  col = mix(col, col * vec3(1.25, 0.55, 0.5), uRedTint);

  // grain: camcorder gain noise rises in the dark
  float n = h12(gl_FragCoord.xy + fract(t * 7.13) * 431.0) - 0.5;
  float grain = (0.035 + 0.05 * (gain - 1.0) / 5.0) * uFilm + uNoise;
  col += n * grain * (1.2 - luma * 0.6);
  // scanlines
  col *= 1.0 - uFilm * 0.04 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));
  // tracking band noise
  col += band * (h12(vec2(gl_FragCoord.x * 0.1, line + t)) - 0.45) * 0.12;
  // static (transitions)
  float st = h12(gl_FragCoord.xy * 0.5 + t * 100.0);
  col = mix(col, vec3(st), uStatic);
  // sanity glitch colour splits
  col.rb += gb * uGlitch * vec2(0.05, -0.03);

  // vignette + stamina tunnel vision
  float vig = smoothstep(0.85, 0.25, length(cc * vec2(1.0, 0.85)) * (1.0 + uTunnel * 0.9));
  col *= mix(1.0, vig, 0.55 * uFilm + 0.45 * uTunnel + 0.1);

  // feedback smear
  if (uSmear > 0.0) {
    vec2 pu = vUv + vec2(0.0, -0.004) + (vec2(h12(vec2(t, 1.0)), h12(vec2(t, 2.0))) - 0.5) * 0.006;
    vec3 prev = texture(tPrev, pu).rgb;
    col = mix(col, max(col, prev * 0.985), uSmear);
  }

  // outside the distorted frame
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);

  col = mix(col, uFadeColor, uFade);
  col += (h12(gl_FragCoord.xy + 0.5) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const hf = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
    this.rtLum = new THREE.WebGLRenderTarget(64, 64, { ...hf, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.rtAdapt = [new THREE.WebGLRenderTarget(1, 1, { ...hf, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), new THREE.WebGLRenderTarget(1, 1, { ...hf, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })];
    this.rtB = [new THREE.WebGLRenderTarget(4, 4, hf), new THREE.WebGLRenderTarget(4, 4, hf), new THREE.WebGLRenderTarget(4, 4, hf), new THREE.WebGLRenderTarget(4, 4, hf)];
    this.rtFeed = [new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false }), new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false })];
    this.feedIdx = 0;
    this.adaptIdx = 0;
    this.snap = true;

    this.mLum = pass(LUM_FS, { tScene: { value: null } });
    this.mAdapt = pass(ADAPT_FS, { tLum: { value: this.rtLum.texture }, tPrev: { value: null }, uDt: { value: 0 }, uSnap: { value: 1 } });
    this.mBright = pass(BRIGHT_FS, { tScene: { value: null }, tAdapt: { value: null }, uKey: { value: 0.5 }, uThreshold: { value: 0.9 }, uTexel: { value: new THREE.Vector2() } });
    this.mBlur = pass(BLUR_FS, { tIn: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mCopy = pass(`uniform sampler2D tIn; varying vec2 vUv; void main(){ gl_FragColor = texture(tIn, vUv); }`, { tIn: { value: null } });
    this.u = {
      tScene: { value: this.rtScene.texture },
      tBloomA: { value: this.rtB[0].texture },
      tBloomB: { value: this.rtB[2].texture },
      tAdapt: { value: null },
      tPrev: { value: null },
      uRes: { value: new THREE.Vector2() },
      uSceneTexel: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uFilm: { value: 1 },
      uKey: { value: 0.5 },
      uBloom: { value: 0.6 },
      uGlitch: { value: 0 },
      uTunnel: { value: 0 },
      uFade: { value: 0 },
      uFadeColor: { value: new THREE.Color(0, 0, 0) },
      uSmear: { value: 0 },
      uTrack: { value: 0 },
      uStatic: { value: 0 },
      uGrade: { value: new THREE.Color(1, 1, 1) },
      uSat: { value: 0.85 },
      uContrast: { value: 1.0 },
      uLift: { value: 0.0 },
      uRedTint: { value: 0 },
      uNoise: { value: 0 },
      uSoft: { value: 1.0 },
      uDistortion: { value: 0.12 },
      uFixedExposure: { value: 0 },
    };
    this.mComp = pass(COMP_FS, this.u);
    this.bloomEnabled = true;
    this.renderScale = 0.7;
  }

  setSize(w, h, scale) {
    this.w = w;
    this.h = h;
    this.renderScale = scale;
    const sw = Math.max(2, Math.floor(w * scale)), sh = Math.max(2, Math.floor(h * scale));
    this.rtScene.setSize(sw, sh);
    const bw = Math.max(2, sw >> 2), bh = Math.max(2, sh >> 2);
    this.rtB[0].setSize(bw, bh);
    this.rtB[1].setSize(bw, bh);
    this.rtB[2].setSize(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
    this.rtB[3].setSize(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
    this.rtFeed[0].setSize(w, h);
    this.rtFeed[1].setSize(w, h);
    this.u.uRes.value.set(w, h);
    this.u.uSceneTexel.value.set(1 / sw, 1 / sh);
  }

  _run(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene, camera, dt) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // auto exposure
    this.mLum.uniforms.tScene.value = this.rtScene.texture;
    this._run(this.mLum, this.rtLum);
    const prev = this.rtAdapt[this.adaptIdx];
    const next = this.rtAdapt[1 - this.adaptIdx];
    this.mAdapt.uniforms.tPrev.value = prev.texture;
    this.mAdapt.uniforms.uDt.value = dt;
    this.mAdapt.uniforms.uSnap.value = this.snap ? 1 : 0;
    this.snap = false;
    this._run(this.mAdapt, next);
    this.adaptIdx = 1 - this.adaptIdx;
    this.u.tAdapt.value = next.texture;

    // bloom
    if (this.bloomEnabled) {
      this.mBright.uniforms.tScene.value = this.rtScene.texture;
      this.mBright.uniforms.tAdapt.value = next.texture;
      this.mBright.uniforms.uKey.value = this.u.uKey.value;
      this.mBright.uniforms.uTexel.value.set(1 / this.rtScene.width, 1 / this.rtScene.height);
      this._run(this.mBright, this.rtB[0]);
      const b0 = this.rtB[0], b1 = this.rtB[1], b2 = this.rtB[2], b3 = this.rtB[3];
      this.mBlur.uniforms.tIn.value = b0.texture;
      this.mBlur.uniforms.uDir.value.set(1 / b0.width, 0);
      this._run(this.mBlur, b1);
      this.mBlur.uniforms.tIn.value = b1.texture;
      this.mBlur.uniforms.uDir.value.set(0, 1 / b0.height);
      this._run(this.mBlur, b0);
      this.mCopy.uniforms.tIn.value = b0.texture;
      this._run(this.mCopy, b2);
      this.mBlur.uniforms.tIn.value = b2.texture;
      this.mBlur.uniforms.uDir.value.set(2 / b2.width, 0);
      this._run(this.mBlur, b3);
      this.mBlur.uniforms.tIn.value = b3.texture;
      this.mBlur.uniforms.uDir.value.set(0, 2 / b2.height);
      this._run(this.mBlur, b2);
      this.u.uBloom.value = this.u.uBloom.value;
    }
    const bloomSave = this.u.uBloom.value;
    if (!this.bloomEnabled) this.u.uBloom.value = 0;

    if (this.u.uSmear.value > 0.001) {
      const src = this.rtFeed[this.feedIdx], dst = this.rtFeed[1 - this.feedIdx];
      this.u.tPrev.value = src.texture;
      this._run(this.mComp, dst);
      this.mCopy.uniforms.tIn.value = dst.texture;
      this._run(this.mCopy, null);
      this.feedIdx = 1 - this.feedIdx;
    } else {
      this.u.tPrev.value = this.rtFeed[0].texture;
      this._run(this.mComp, null);
    }
    this.u.uBloom.value = bloomSave;
  }
}
