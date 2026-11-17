import * as THREE from 'three';
import { LIGHT_TEX_W } from './lights.js';

// One shared uniform block for every world material, so the flashlight, fog,
// sanity "breathing", noclip jitter etc. are set once per frame.
export const G = {
  uTime: { value: 0 },
  uLightTex: { value: null },
  uAmbient: { value: new THREE.Color(0.05, 0.05, 0.04) },
  uFogColor: { value: new THREE.Color(0.5, 0.45, 0.3) },
  uFogDensity: { value: 0.03 },
  uFogLit: { value: 0.8 },
  uCamPos: { value: new THREE.Vector3() },
  uFlashPos: { value: new THREE.Vector3() },
  uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
  uFlashColor: { value: new THREE.Color(0, 0, 0) },
  uFlashCos: { value: new THREE.Vector2(0.9, 0.97) },
  uFlashRange: { value: 16 },
  uBreath: { value: 0 },
  uJitter: { value: 0 },
  uJitterCenter: { value: new THREE.Vector3() },
  uStretch: { value: 0 },
  uPanelGain: { value: 2.2 },
  uWaterLevel: { value: -100 },
  uCaustics: { value: 0 },
  uWetness: { value: 0 },
};

const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform float uJitter;
uniform vec3 uJitterCenter;
uniform float uStretch;
float h13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
`;

const VERT = /* glsl */ `
${COMMON}
uniform sampler2D uLightTex;
uniform vec2 uTile;
uniform float uBreath;
uniform vec3 uAmbient;
uniform float uPanelGain;
uniform vec3 uObjLight;
uniform float uSway;
#ifdef BAKED
attribute vec4 aLid0; attribute vec4 aLid1; attribute vec4 aLw0; attribute vec4 aLw1;
attribute vec3 aAmb; attribute float aEmit; attribute vec3 aCol;
#endif
varying vec2 vUv; varying vec3 vLight; varying vec3 vWorld; varying vec3 vNormal; varying vec3 vEmit; varying vec3 vCol;
vec3 Lf(float id){ int i = int(id + 0.5); return texelFetch(uLightTex, ivec2(i % ${LIGHT_TEX_W}, i / ${LIGHT_TEX_W}), 0).rgb; }
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  #ifdef SWAY
    wp.x += sin(uTime*1.3 + wp.y*2.0 + position.x) * uSway * max(position.y, 0.0);
    wp.z += cos(uTime*1.1 + wp.y*1.7) * uSway * max(position.y, 0.0);
  #endif
  #ifdef BREATHE
  if (uBreath > 0.0) {
    float b = sin(uTime*0.8 + wp.y*1.1 + (wp.x + wp.z)*0.45) * 0.5 + 0.5;
    float m = smoothstep(0.1, 0.8, wp.y) * (1.0 - smoothstep(2.0, 2.6, wp.y));
    wp.xyz += n * uBreath * b * m * 0.07;
  }
  #endif
  if (uJitter > 0.0) {
    float dj = distance(wp.xyz, uJitterCenter);
    float k = uJitter * (1.0 - smoothstep(0.0, 9.0, dj));
    vec3 cell = floor(wp.xyz * 2.0) + floor(uTime * 24.0);
    wp.xyz += (vec3(h13(cell), h13(cell + 7.1), h13(cell + 3.7)) - 0.5) * k * 0.5;
  }
  vUv = uv / uTile;
  if (uStretch > 0.0) {
    float dj = distance(wp.xyz, uJitterCenter);
    float k = uStretch * (1.0 - smoothstep(0.0, 12.0, dj));
    vUv.x += k * (wp.y * 1.7 + sin(wp.y * 9.0 + uTime*3.0)) ;
    vUv.y *= 1.0 + k * 4.0;
  }
  #ifdef BAKED
    vLight = aAmb * uAmbient
      + aLw0.x * Lf(aLid0.x) + aLw0.y * Lf(aLid0.y) + aLw0.z * Lf(aLid0.z) + aLw0.w * Lf(aLid0.w)
      + aLw1.x * Lf(aLid1.x) + aLw1.y * Lf(aLid1.y) + aLw1.z * Lf(aLid1.z) + aLw1.w * Lf(aLid1.w);
    vEmit = aEmit > 0.5 ? Lf(aEmit) * uPanelGain : vec3(0.0);
    vCol = aCol;
  #else
    vLight = uObjLight + uAmbient;
    vEmit = vec3(0.0);
    vCol = vec3(1.0);
  #endif
  vWorld = wp.xyz;
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON}
uniform sampler2D map;
uniform vec3 uTint;
uniform vec3 uEmissive;
uniform vec3 uFogColor; uniform float uFogDensity; uniform float uFogLit;
uniform vec3 uFlashPos; uniform vec3 uFlashDir; uniform vec3 uFlashColor; uniform vec2 uFlashCos; uniform float uFlashRange;
uniform float uWaterLevel; uniform float uCaustics; uniform float uWetness;
uniform float uOpacity;
varying vec2 vUv; varying vec3 vLight; varying vec3 vWorld; varying vec3 vNormal; varying vec3 vEmit; varying vec3 vCol;

float caust(vec2 p, float t){
  vec2 q = p * 1.7;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    q += vec2(sin(q.y*1.3 + t*0.7), cos(q.x*1.1 - t*0.6)) * 0.55;
    c += abs(sin(q.x + q.y));
  }
  return pow(1.0 - c / 3.0, 3.0);
}

void main(){
  vec4 tex = texture(map, vUv);
  #ifdef ALPHATEST
    if (tex.a < 0.5) discard;
  #endif
  vec3 alb = tex.rgb * uTint * vCol;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 col;
  #ifdef UNLIT
    col = alb * uEmissive;
  #else
    vec3 light = vLight;
    vec3 d = vWorld - uFlashPos;
    float dist = length(d);
    vec3 ld = d / max(dist, 1e-3);
    float ca = dot(ld, uFlashDir);
    float spot = smoothstep(uFlashCos.x, uFlashCos.y, ca);
    // uneven reflector: a hot centre and a faint ring, like a cheap torch
    spot *= 0.75 + 0.25 * smoothstep(uFlashCos.y, 1.0, ca) + 0.12 * sin(ca * 900.0);
    float fl = spot * max(dot(n, -ld), 0.0) / (1.0 + dist * dist * 0.16) * (1.0 - smoothstep(uFlashRange * 0.55, uFlashRange, dist));
    light += uFlashColor * fl;
    #ifdef CAUSTICS
      if (vWorld.y < uWaterLevel) {
        float depth = clamp((uWaterLevel - vWorld.y) / 1.2, 0.0, 1.0);
        alb *= mix(vec3(1.0), vec3(0.55, 0.9, 0.95), 0.5 + 0.5 * depth);
        light += uCaustics * caust(vWorld.xz + vWorld.y * 0.3, uTime) * vec3(0.9, 1.0, 1.0) * (0.4 + depth);
      }
    #endif
    #ifdef WET
      // puddles: darker, slightly glossy where the floor texture alpha marks wetness
      float wet = (1.0 - tex.a) * uWetness;
      alb *= 1.0 - wet * 0.45;
      vec3 v = normalize(vWorld - uCamPos);
      float spec = pow(max(dot(reflect(v, n), vec3(0.0, 1.0, 0.0)), 0.0), 2.0);
      light += wet * spec * vLight * 0.6;
    #endif
    col = alb * light + vEmit * tex.rgb + uEmissive * tex.rgb;
  #endif
  float fd = distance(vWorld, uCamPos);
  float fx = fd * uFogDensity;
  float f = 1.0 - exp(-fx * fx);
  float localL = dot(vLight + vEmit * 0.15, vec3(0.3, 0.5, 0.2));
  vec3 fogC = uFogColor * mix(1.0, clamp(localL * 1.1, 0.0, 1.6), uFogLit);
  #ifdef UNLIT
    f *= 0.6;
  #endif
  col = mix(col, fogC, f);
  gl_FragColor = vec4(col, uOpacity);
}
`;

/**
 * Create a world material.
 * opts: map, tile [u,v metres per repeat], tint, emissive, baked (default true),
 * breathe, caustics, wet, unlit, alphaTest, transparent, side
 */
export function worldMaterial(opts = {}) {
  const defines = {};
  if (opts.baked !== false) defines.BAKED = 1;
  if (opts.breathe) defines.BREATHE = 1;
  if (opts.caustics) defines.CAUSTICS = 1;
  if (opts.wet) defines.WET = 1;
  if (opts.unlit) defines.UNLIT = 1;
  if (opts.alphaTest) defines.ALPHATEST = 1;
  if (opts.sway) defines.SWAY = 1;
  const tile = opts.tile || [1, 1];
  const mat = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      ...G,
      map: { value: opts.map || whiteTex() },
      uTile: { value: new THREE.Vector2(tile[0], tile[1]) },
      uTint: { value: new THREE.Color(...(opts.tint || [1, 1, 1])) },
      uEmissive: { value: new THREE.Color(...(opts.emissive || [0, 0, 0])) },
      uObjLight: { value: new THREE.Vector3(0, 0, 0) },
      uOpacity: { value: opts.opacity ?? 1 },
      uSway: { value: opts.swayAmount ?? 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent,
    depthWrite: opts.depthWrite ?? true,
  });
  if (opts.blending) mat.blending = opts.blending;
  return mat;
}

let _white = null;
export function whiteTex() {
  if (_white) return _white;
  const d = new Uint8Array([255, 255, 255, 255]);
  _white = new THREE.DataTexture(d, 1, 1);
  _white.needsUpdate = true;
  return _white;
}

// Water surface: still, turquoise, faintly rippling, reflecting the fog/sky colour.
export function waterMaterial(color = [0.25, 0.75, 0.78]) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...G,
      uColor: { value: new THREE.Color(...color) },
      uSky: { value: new THREE.Color(0.95, 0.98, 1.0) },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCamPos; uniform vec3 uColor; uniform vec3 uSky;
      uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uFlashPos; uniform vec3 uFlashDir; uniform vec3 uFlashColor; uniform vec2 uFlashCos;
      varying vec3 vWorld;
      void main(){
        vec2 p = vWorld.xz;
        float t = uTime * 0.35;
        vec3 n = normalize(vec3(
          sin(p.x * 1.7 + t) * 0.02 + sin(p.y * 2.3 - t * 1.3) * 0.015 + sin((p.x+p.y)*4.1 + t*2.0)*0.006,
          1.0,
          cos(p.y * 1.9 + t * 0.8) * 0.02 + cos(p.x * 2.9 - t) * 0.012));
        vec3 v = normalize(vWorld - uCamPos);
        float fres = pow(1.0 - max(dot(-v, n), 0.0), 3.0);
        vec3 r = reflect(v, n);
        float glint = pow(max(dot(r, normalize(vec3(0.2, 1.0, 0.1))), 0.0), 80.0);
        vec3 col = mix(uColor, uSky * 0.9, 0.08 + 0.55 * fres) + glint * 0.6;
        vec3 ld = normalize(vWorld - uFlashPos);
        col += uFlashColor * smoothstep(uFlashCos.x, uFlashCos.y, dot(ld, uFlashDir)) * 0.15;
        float fd = distance(vWorld, uCamPos) * uFogDensity;
        col = mix(col, uFogColor, 1.0 - exp(-fd*fd));
        gl_FragColor = vec4(col, 0.55 + 0.4 * fres);
      }
    `,
  });
}
