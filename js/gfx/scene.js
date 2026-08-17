/* =====================================================================
   NESTRA — Cena de fundo

   Não é um papel de parede genérico: o que flutua ali atrás são placas
   com a própria interface do Nestra desenhada nelas — a faixa de tipo,
   a caixa de conclusão, o título, os metadados. Pensamentos capturados
   atravessando o espaço até encontrarem seu lugar.

   Camadas, de trás para frente:
     1. aurora     — brilho volumétrico lento, procedural
     2. constelação— fios ligando placas próximas
     3. placas      — caixas instanciadas com mini-interface nas faces
     4. poeira      — partículas com cintilação

   Tudo reage ao ponteiro e ao clique.
   ===================================================================== */

import { M4, program } from '../core/gl.js';
import { device, quality, sizeCanvas, glBudget } from '../core/device.js';

/* ------------------------------------------------------------------ */
/* 1. AURORA                                                           */
/* ------------------------------------------------------------------ */

const AURORA_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const AURORA_FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uAccent;
uniform vec2  uPointer;
uniform float uPulse;
uniform float uScroll;   // rolagem da página, em telas
uniform int   uOct;      // oitavas do ruído — cai em aparelho mais fraco
uniform float uWarp;     // 0..1 — quanto o campo se dobra sobre si mesmo

// ruído de valor com interpolação suave
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= uOct) break;
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);

  // o ponteiro entorta o campo; a rolagem desliza a cortina para cima
  p += uPointer * 0.07;
  p.y += uScroll * 0.14;

  float t = uTime * 0.055;

  /* Deformação do domínio: em vez de duas faixas correndo em linha reta,
     o campo é dobrado por outro ruído antes de ser lido. É o que faz a
     luz enrolar e desenrolar em vez de só deslizar. */
  vec2 w = vec2(
    fbm(p * 1.35 + vec2(t * 1.2, -t * 0.8)),
    fbm(p * 1.35 + vec2(5.2 - t * 0.6, 1.3 + t * 0.9)));
  vec2 q = mix(p, p + (w - 0.5) * 1.5, uWarp);

  float band1 = fbm(vec2(q.x * 1.5 + t * 1.5, q.y * 2.2 - t * 0.9));
  float band2 = fbm(vec2(q.x * 2.4 - t * 1.2, q.y * 1.6 + t * 0.8));

  float curtain = smoothstep(0.38, 0.90, band1) * 0.80
                + smoothstep(0.46, 0.96, band2) * 0.55;

  // feixes verticais atravessando devagar, atrás das cortinas
  float beams = pow(0.5 + 0.5 * sin(q.x * 3.1 - uTime * 0.20 + band1 * 4.5), 8.0) * 0.55;

  // concentra a luz em cima e nas laterais, deixando o meio legível
  float shape = smoothstep(1.02, 0.04, abs(p.y * 1.2 + 0.26));
  shape *= 0.32 + 0.68 * smoothstep(0.0, 0.62, abs(p.x));

  vec3 cool = mix(uAccent, vec3(0.31, 0.85, 1.0), 0.50);
  vec3 warm = mix(uAccent, vec3(0.63, 0.45, 1.0), 0.60);

  // a cor migra de um lado para o outro ao longo de um minuto
  float drift = sin(uTime * 0.075) * 0.5 + 0.5;
  vec3 tint = mix(cool, warm, smoothstep(-0.75, 0.75, q.x + drift * 1.1 - 0.55));

  float glow = (curtain + beams) * shape * (0.19 + uPulse * 0.26);

  // brilho difuso ao redor do ponteiro
  float halo = exp(-length(p - uPointer * 0.5) * 2.4) * 0.055;

  // horizonte respirando na base da tela
  float horizon = exp(-abs(p.y + 0.66) * 6.5) * (0.045 + 0.025 * sin(uTime * 0.45));

  outColor = vec4(tint * glow + uAccent * halo + tint * horizon, 1.0);
}`;

/* ------------------------------------------------------------------ */
/* 2. PLACAS COM INTERFACE                                             */
/* ------------------------------------------------------------------ */

const CARD_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec2 aUv;

in vec3 aOffset;    // posição, calculada na CPU
in vec3 aRot;       // rotação, calculada na CPU
in vec3 aScale;
in vec3 aTint;
in float aSeed;

uniform mat4 uProj;
uniform mat4 uView;

out vec3 vNormal;
out vec2 vUv;
out vec3 vTint;
out float vDepth;
out float vSeed;
out float vFace;

mat3 euler(vec3 a) {
  float cx = cos(a.x), sx = sin(a.x);
  float cy = cos(a.y), sy = sin(a.y);
  float cz = cos(a.z), sz = sin(a.z);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  return rz * ry * rx;
}

void main() {
  mat3 rot = euler(aRot);
  vec3 world = rot * (aPos * aScale) + aOffset;

  vNormal = normalize(rot * aNormal);
  vUv = aUv;
  vTint = aTint;
  vSeed = aSeed;
  vFace = step(0.5, abs(aNormal.z));

  vec4 viewPos = uView * vec4(world, 1.0);
  vDepth = -viewPos.z;
  gl_Position = uProj * viewPos;
}`;

const CARD_FS = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec2 vUv;
in vec3 vTint;
in float vDepth;
in float vSeed;
in float vFace;

uniform float uTime;
uniform vec3  uAccent;
uniform float uFogNear;
uniform float uFogFar;
uniform float uPulse;

out vec4 outColor;

// retângulo com bordas suaves — o traço fica arredondado, não serrilhado
float bar(vec2 uv, vec4 r, float soft) {
  vec2 a = smoothstep(r.xy - soft, r.xy + soft, uv);
  vec2 b = smoothstep(r.zw + soft, r.zw - soft, uv);
  return a.x * a.y * b.x * b.y;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 lightA = normalize(vec3(-0.4, 0.8, 0.6));
  vec3 lightB = normalize(vec3(0.7, -0.3, 0.5));

  float diff = max(dot(n, lightA), 0.0) * 0.72 + max(dot(n, lightB), 0.0) * 0.28;
  float rim  = pow(1.0 - abs(n.z), 2.6);

  vec3 base = vTint * (0.07 + diff * 0.36);
  base += uAccent * rim * 0.42;

  /* --- a mini-interface, desenhada na face da placa --- */
  float soft = 0.006;
  float titleLen = 0.34 + fract(vSeed * 7.3) * 0.30;
  float done = step(0.72, fract(vSeed * 3.1));

  // faixa de tipo, na lateral esquerda
  float ui = bar(vUv, vec4(0.035, 0.12, 0.062, 0.88), soft) * 1.70;

  // caixa de conclusão
  float boxOuter = bar(vUv, vec4(0.105, 0.615, 0.195, 0.815), soft);
  float boxInner = bar(vUv, vec4(0.122, 0.645, 0.178, 0.785), soft);
  ui += (boxOuter - boxInner) * 1.15;
  ui += boxInner * done * 1.05;                       // já concluída

  // título
  ui += bar(vUv, vec4(0.24, 0.665, 0.24 + titleLen, 0.775), soft) * mix(0.95, 0.34, done);

  // metadados
  ui += bar(vUv, vec4(0.24, 0.455, 0.395, 0.545), soft) * 0.46;
  ui += bar(vUv, vec4(0.425, 0.455, 0.545, 0.545), soft) * 0.30;

  // pílula de data, à direita
  ui += bar(vUv, vec4(0.755, 0.625, 0.935, 0.775), soft) * 0.42;

  // separador inferior
  ui += bar(vUv, vec4(0.105, 0.245, 0.935, 0.262), soft) * 0.22;

  vec3 uiTint = mix(vec3(0.72, 0.82, 1.0), uAccent, 0.45);
  base += uiTint * ui * 0.16 * vFace;

  // moldura luminosa da placa
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = 1.0 - smoothstep(0.0, 0.05, min(e.x, e.y));
  base += uAccent * edge * (0.20 + 0.16 * sin(uTime * 1.4 + vSeed * 6.28));

  base += uAccent * uPulse * 0.16;

  float fog = 1.0 - clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  fog = pow(fog, 1.45);

  float alpha = fog * (0.24 + rim * 0.42 + edge * 0.34 + ui * 0.10 * vFace);
  outColor = vec4(base * fog, clamp(alpha, 0.0, 0.9));
}`;

/* ------------------------------------------------------------------ */
/* 3. CONSTELAÇÃO                                                      */
/* ------------------------------------------------------------------ */

const LINE_VS = `#version 300 es
in vec3 aLinePos;
in float aLineAlpha;

uniform mat4 uProj;
uniform mat4 uView;

out float vAlpha;
out float vDepth;

void main() {
  vec4 viewPos = uView * vec4(aLinePos, 1.0);
  vDepth = -viewPos.z;
  vAlpha = aLineAlpha;
  gl_Position = uProj * viewPos;
}`;

const LINE_FS = `#version 300 es
precision mediump float;
in float vAlpha;
in float vDepth;
uniform vec3 uAccent;
out vec4 outColor;

void main() {
  float fog = 1.0 - clamp((vDepth - 6.0) / 38.0, 0.0, 1.0);
  outColor = vec4(uAccent * vAlpha * fog * 0.9, vAlpha * fog * 0.34);
}`;

/* ------------------------------------------------------------------ */
/* 4. POEIRA                                                           */
/* ------------------------------------------------------------------ */

const DUST_VS = `#version 300 es
in vec3 aDust;
in float aDustSeed;

uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uSpread;
uniform float uDpr;

out float vAlpha;
out float vSeed;

void main() {
  float z = mod(aDust.z + uTime * (0.3 + aDustSeed * 0.65), uSpread) - uSpread + 2.0;
  vec3 world = vec3(
    aDust.x + sin(uTime * 0.36 + aDustSeed * 12.0) * 0.9,
    aDust.y + cos(uTime * 0.29 + aDustSeed * 9.0) * 0.7,
    z);

  vec4 viewPos = uView * vec4(world, 1.0);
  float depth = -viewPos.z;
  vAlpha = 1.0 - clamp(depth / 44.0, 0.0, 1.0);
  vSeed = aDustSeed;

  gl_Position = uProj * viewPos;
  gl_PointSize = (1.6 + aDustSeed * 3.4) * uDpr * (12.0 / max(depth, 1.0));
}`;

const DUST_FS = `#version 300 es
precision highp float;
in float vAlpha;
in float vSeed;
uniform vec3 uAccent;
uniform float uTime;
out vec4 outColor;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float core = smoothstep(0.5, 0.0, r);
  float twinkle = 0.5 + 0.5 * sin(uTime * 1.8 + vSeed * 20.0);
  vec3 c = mix(uAccent, vec3(0.6, 0.88, 1.0), vSeed);
  outColor = vec4(c * core * twinkle, core * vAlpha * 0.5);
}`;

/* ------------------------------------------------------------------ */

function boxGeometry() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const faces = [
    { n: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    { n: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0] },
    { n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1] },
  ];

  faces.forEach((f, fi) => {
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([cu, cv]) => {
      positions.push(
        f.n[0] * 0.5 + f.u[0] * cu * 0.5 + f.v[0] * cv * 0.5,
        f.n[1] * 0.5 + f.u[1] * cu * 0.5 + f.v[1] * cv * 0.5,
        f.n[2] * 0.5 + f.u[2] * cu * 0.5 + f.v[2] * cv * 0.5,
      );
      normals.push(f.n[0], f.n[1], f.n[2]);
      uvs.push((cu + 1) / 2, (cv + 1) / 2);
    });
    const o = fi * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

const PALETTE = [
  [0.18, 0.42, 1.00],
  [0.31, 0.85, 1.00],
  [0.61, 0.48, 1.00],
  [0.55, 0.66, 0.95],
  [1.00, 0.79, 0.42],
];

export class Scene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.opts = Object.assign({
      cards: 46,
      dust: 320,
      spread: 46,
      accent: [0.184, 0.42, 1.0],
      density: 1,
      maxLinks: 130,
      linkDistance: 7.2,
    }, options);

    this.running = false;
    this.ready = false;
    this.pulse = 0;
    this.ripples = [];
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.scroll = { v: 0, t: 0 };
    // Sem cursor não há de onde tirar movimento: a cena passa a se mover
    // sozinha, num vaivém lento que nunca repete o mesmo caminho.
    this.selfDrive = device.touch;
    this._t0 = performance.now();
  }

  /* Quantas peças e partículas cabem no fôlego atual do aparelho. */
  get activeCards() {
    return Math.max(8, Math.round(this.count * quality.scale));
  }

  get activeDust() {
    return Math.max(40, Math.round(this.dustCount * quality.scale));
  }

  init() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
    if (!gl) return false;
    this.gl = gl;

    try {
      this.auroraProg = program(gl, AURORA_VS, AURORA_FS);
      this.cardProg = program(gl, CARD_VS, CARD_FS);
      this.lineProg = program(gl, LINE_VS, LINE_FS);
      this.dustProg = program(gl, DUST_VS, DUST_FS);
    } catch (err) {
      console.warn('[nestra] cena de fundo indisponível:', err);
      return false;
    }

    const count = Math.max(10, Math.round(this.opts.cards * this.opts.density));
    this.count = count;

    /* --- aurora: um triângulo cobrindo a tela --- */
    this.auroraVao = gl.createVertexArray();
    gl.bindVertexArray(this.auroraVao);
    const abuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, abuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.auroraProg.a.aPos);
    gl.vertexAttribPointer(this.auroraProg.a.aPos, 2, gl.FLOAT, false, 0, 0);

    /* --- placas --- */
    const geo = boxGeometry();
    this.cardVao = gl.createVertexArray();
    gl.bindVertexArray(this.cardVao);

    const a = this.cardProg.a;
    const staticBuf = (loc, data, size, divisor) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      if (divisor) gl.vertexAttribDivisor(loc, divisor);
      return buf;
    };

    staticBuf(a.aPos, geo.positions, 3, 0);
    staticBuf(a.aNormal, geo.normals, 3, 0);
    staticBuf(a.aUv, geo.uvs, 2, 0);

    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);

    // Estado por placa, atualizado na CPU — assim a constelação e as ondas
    // de clique usam exatamente as mesmas posições que o shader desenha.
    this.cards = [];
    const scale = new Float32Array(count * 3);
    const tint = new Float32Array(count * 3);
    const seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const w = 1.0 + Math.random() * 2.2;
      this.cards.push({
        home: [
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 20,
          Math.random() * this.opts.spread,
        ],
        pos: [0, 0, 0],
        vel: [0, 0, 0],
        rot: [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28],
        speed: 0.5 + Math.random() * 0.85,
        seed: Math.random(),
      });

      scale[i * 3] = w;
      scale[i * 3 + 1] = w * (0.5 + Math.random() * 0.26);
      scale[i * 3 + 2] = 0.028 + Math.random() * 0.04;

      const c = PALETTE[Math.random() < 0.6 ? 0 : Math.floor(Math.random() * PALETTE.length)];
      tint[i * 3] = c[0]; tint[i * 3 + 1] = c[1]; tint[i * 3 + 2] = c[2];

      seed[i] = this.cards[i].seed;
    }

    staticBuf(a.aScale, scale, 3, 1);
    staticBuf(a.aTint, tint, 3, 1);
    staticBuf(a.aSeed, seed, 1, 1);

    // buffers dinâmicos: posição e rotação
    this.offsetData = new Float32Array(count * 3);
    this.rotData = new Float32Array(count * 3);

    this.offsetBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.offsetBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.offsetData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(a.aOffset);
    gl.vertexAttribPointer(a.aOffset, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(a.aOffset, 1);

    this.rotBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rotBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.rotData, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(a.aRot);
    gl.vertexAttribPointer(a.aRot, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(a.aRot, 1);

    /* --- constelação --- */
    this.linePositions = new Float32Array(this.opts.maxLinks * 6);
    this.lineAlphas = new Float32Array(this.opts.maxLinks * 2);
    this.lineCount = 0;

    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    this.linePosBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.linePositions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.lineProg.a.aLinePos);
    gl.vertexAttribPointer(this.lineProg.a.aLinePos, 3, gl.FLOAT, false, 0, 0);

    this.lineAlphaBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineAlphaBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.lineAlphas, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.lineProg.a.aLineAlpha);
    gl.vertexAttribPointer(this.lineProg.a.aLineAlpha, 1, gl.FLOAT, false, 0, 0);

    /* --- poeira --- */
    const dustCount = Math.round(this.opts.dust * this.opts.density);
    this.dustCount = dustCount;
    const dust = new Float32Array(dustCount * 3);
    const dustSeed = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      dust[i * 3] = (Math.random() - 0.5) * 40;
      dust[i * 3 + 1] = (Math.random() - 0.5) * 26;
      dust[i * 3 + 2] = Math.random() * this.opts.spread;
      dustSeed[i] = Math.random();
    }

    this.dustVao = gl.createVertexArray();
    gl.bindVertexArray(this.dustVao);
    const da = this.dustProg.a;
    const db = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, db);
    gl.bufferData(gl.ARRAY_BUFFER, dust, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(da.aDust);
    gl.vertexAttribPointer(da.aDust, 3, gl.FLOAT, false, 0, 0);
    const ds = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ds);
    gl.bufferData(gl.ARRAY_BUFFER, dustSeed, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(da.aDustSeed);
    gl.vertexAttribPointer(da.aDustSeed, 1, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    /* A cena ocupa uma vaga no orçamento de contextos. Ela é a primeira
       a nascer, então nunca é recusada — mas precisa ser contada, senão
       as peças dos ambientes acham que têm mais espaço do que têm. */
    glBudget.claim(this);

    this.ready = true;
    this._bind();
    this.resize();
    this.start();
    return true;
  }

  _bind() {
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('orientationchange', this._onResize, { passive: true });

    this._onPointer = (ev) => {
      this.selfDrive = false;
      this.pointer.tx = (ev.clientX / window.innerWidth - 0.5) * 2;
      this.pointer.ty = (ev.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('pointermove', this._onPointer, { passive: true });

    /* A rolagem entra na cena: a cortina de luz sobe e a câmera desce um
       pouco, então descer a página parece atravessar o espaço. */
    this._onScroll = () => {
      const h = Math.max(1, window.innerHeight);
      this.scroll.t = Math.min(3, (window.scrollY || 0) / h);
    };
    window.addEventListener('scroll', this._onScroll, { passive: true });

    this._onVis = () => (document.hidden ? this.stop() : this.start());
    document.addEventListener('visibilitychange', this._onVis);

    // Mudou o degrau de qualidade: refaz o tamanho do canvas na hora
    this._onQuality = () => this.resize();
    quality.addEventListener('change', this._onQuality);
  }

  resize() {
    if (!this.gl) return;
    // A cena de fundo é a superfície mais cara do site: um pixel a menos
    // aqui vale mais do que qualquer outro corte.
    const cap = Math.min(quality.dprCap, device.mobile ? 1.25 : 1.75);
    // Medido pela caixa real do elemento, e não por `innerHeight`: em
    // iOS a barra do navegador entra e sai ao rolar, e usar a altura da
    // janela deixaria o desenho esticado enquanto ela se mexe.
    const { w, h } = sizeCanvas(this.canvas, { cap });

    this.gl.viewport(0, 0, w, h);
    this.dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.proj = M4.perspective(Math.PI / 4, w / h, 0.1, 120);
  }

  /** Um item capturado provoca uma onda geral na cena. */
  pulseAt(strength = 1) {
    this.pulse = Math.min(1.4, this.pulse + strength);
  }

  /** Compatibilidade com o nome antigo. */
  pulse_(s) { this.pulseAt(s); }

  /**
   * Onda a partir de um ponto da tela (0..1 em x e y).
   * É o que faz a cena responder a um clique na interface.
   */
  ripple(nx, ny, strength = 1) {
    if (this.ripples.length > 6) this.ripples.shift();
    this.ripples.push({
      x: (nx - 0.5) * 34,
      y: -(ny - 0.5) * 22,
      t: 0,
      strength,
    });
    this.pulseAt(strength * 0.5);
  }

  start() {
    if (!this.ready || this.running) return;
    this.running = true;
    this._t0 = performance.now() - (this._elapsed || 0);
    this._last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this.render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  /* Atualiza posições, rotações e ondas — tudo na CPU, para a
     constelação enxergar as mesmas coordenadas. */
  _step(time, dt) {
    const spread = this.opts.spread;
    const count = this.activeCards;

    // avança as ondas de clique
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].t += dt;
      if (this.ripples[i].t > 2.6) this.ripples.splice(i, 1);
    }

    for (let i = 0; i < count; i++) {
      const c = this.cards[i];

      const z = ((c.home[2] + time * c.speed) % spread) - spread + 2;
      let x = c.home[0] + Math.sin(time * 0.22 + c.seed * 9) * 0.6;
      let y = c.home[1] + Math.cos(time * 0.18 + c.seed * 7) * 0.5;

      // empurrão das ondas de clique
      for (const r of this.ripples) {
        const dx = x - r.x;
        const dy = y - r.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const front = r.t * 13;
        const band = Math.exp(-Math.pow(dist - front, 2) * 0.05);
        const decay = Math.max(0, 1 - r.t / 2.6);
        const push = band * decay * r.strength * 1.5;
        x += (dx / dist) * push;
        y += (dy / dist) * push;
        c.rot[2] += push * 0.02;
      }

      c.pos[0] = x;
      c.pos[1] = y;
      c.pos[2] = z;

      c.rot[0] = c.seed * 6.28 + time * (0.05 + c.seed * 0.08);
      c.rot[1] = c.seed * 3.14 + time * (0.07 + c.seed * 0.11);
      c.rot[2] += (Math.sin(time * 0.3 + c.seed * 6.28) * 0.14 - c.rot[2]) * 0.02;

      this.offsetData[i * 3] = x;
      this.offsetData[i * 3 + 1] = y;
      this.offsetData[i * 3 + 2] = z;

      this.rotData[i * 3] = c.rot[0];
      this.rotData[i * 3 + 1] = c.rot[1];
      this.rotData[i * 3 + 2] = c.rot[2];
    }

    /* --- constelação: liga placas próximas e à frente da câmera --- */
    // Custa O(n²) na CPU: no degrau mais baixo os fios simplesmente saem.
    if (quality.level === 'low') { this.lineCount = 0; return; }

    const maxD = this.opts.linkDistance;
    const maxD2 = maxD * maxD;
    let n = 0;

    for (let i = 0; i < count && n < this.opts.maxLinks; i++) {
      const a = this.cards[i];
      if (a.pos[2] < -34 || a.pos[2] > 0) continue;

      for (let j = i + 1; j < count && n < this.opts.maxLinks; j++) {
        const b = this.cards[j];
        if (b.pos[2] < -34 || b.pos[2] > 0) continue;

        const dx = a.pos[0] - b.pos[0];
        const dy = a.pos[1] - b.pos[1];
        const dz = a.pos[2] - b.pos[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD2) continue;

        const alpha = 1 - Math.sqrt(d2) / maxD;
        const o = n * 6;
        this.linePositions[o] = a.pos[0];
        this.linePositions[o + 1] = a.pos[1];
        this.linePositions[o + 2] = a.pos[2];
        this.linePositions[o + 3] = b.pos[0];
        this.linePositions[o + 4] = b.pos[1];
        this.linePositions[o + 5] = b.pos[2];
        this.lineAlphas[n * 2] = alpha;
        this.lineAlphas[n * 2 + 1] = alpha;
        n++;
      }
    }
    this.lineCount = n;
  }

  render() {
    const gl = this.gl;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    this._elapsed = now - this._t0;
    const time = this._elapsed / 1000;

    /* Sem cursor, a própria cena passeia. Dois senos de períodos que não
       se dividem: o caminho leva minutos para se repetir. */
    if (this.selfDrive) {
      this.pointer.tx = Math.sin(time * 0.083) * 0.62 + Math.sin(time * 0.031) * 0.28;
      this.pointer.ty = Math.cos(time * 0.061) * 0.45 + Math.sin(time * 0.017) * 0.2;
    }

    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.045;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.045;
    this.scroll.v += (this.scroll.t - this.scroll.v) * 0.06;
    this.pulse *= 0.945;

    this._step(time, dt);

    // Deriva contínua da câmera: mesmo com o ponteiro parado, o ponto de
    // vista nunca é exatamente o mesmo de dez segundos atrás.
    const driftX = Math.sin(time * 0.069) * 0.55 + Math.sin(time * 0.023) * 0.25;
    const driftY = Math.cos(time * 0.047) * 0.40;
    const eyeX = this.pointer.x * 2.4 + driftX;
    const eyeY = -this.pointer.y * 1.7 + driftY - this.scroll.v * 1.6;

    const view = M4.lookAt(
      [eyeX, eyeY, 6],
      [this.pointer.x * 0.6 + driftX * 0.4, -this.pointer.y * 0.4 - this.scroll.v * 0.5, -12],
      [0, 1, 0],
    );

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    /* 1. aurora */
    gl.useProgram(this.auroraProg.p);
    gl.bindVertexArray(this.auroraVao);
    const au = this.auroraProg.u;
    gl.uniform2f(au.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(au.uTime, time);
    gl.uniform3fv(au.uAccent, this.opts.accent);
    gl.uniform2f(au.uPointer, this.pointer.x, -this.pointer.y);
    gl.uniform1f(au.uPulse, this.pulse);
    gl.uniform1f(au.uScroll, this.scroll.v);
    gl.uniform1i(au.uOct, quality.level === 'low' ? 3 : quality.level === 'medium' ? 4 : 5);
    gl.uniform1f(au.uWarp, quality.level === 'low' ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* 2. constelação */
    if (this.lineCount) {
      gl.useProgram(this.lineProg.p);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.linePositions, 0, this.lineCount * 6);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineAlphaBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineAlphas, 0, this.lineCount * 2);

      const lu = this.lineProg.u;
      gl.uniformMatrix4fv(lu.uProj, false, this.proj);
      gl.uniformMatrix4fv(lu.uView, false, view);
      gl.uniform3fv(lu.uAccent, this.opts.accent);
      gl.drawArrays(gl.LINES, 0, this.lineCount * 2);
    }

    /* 3. placas */
    const drawn = this.activeCards;
    gl.useProgram(this.cardProg.p);
    gl.bindVertexArray(this.cardVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.offsetBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.offsetData, 0, drawn * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rotBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.rotData, 0, drawn * 3);

    const u = this.cardProg.u;
    gl.uniformMatrix4fv(u.uProj, false, this.proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uAccent, this.opts.accent);
    gl.uniform1f(u.uFogNear, 6);
    gl.uniform1f(u.uFogFar, 42);
    gl.uniform1f(u.uPulse, this.pulse);
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, drawn);

    /* 4. poeira */
    gl.useProgram(this.dustProg.p);
    gl.bindVertexArray(this.dustVao);
    const du = this.dustProg.u;
    gl.uniformMatrix4fv(du.uProj, false, this.proj);
    gl.uniformMatrix4fv(du.uView, false, view);
    gl.uniform1f(du.uTime, time);
    gl.uniform1f(du.uSpread, this.opts.spread);
    gl.uniform1f(du.uDpr, this.dpr);
    gl.uniform3fv(du.uAccent, this.opts.accent);
    gl.drawArrays(gl.POINTS, 0, this.activeDust);

    gl.bindVertexArray(null);
  }

  destroy() {
    this.stop();
    glBudget.release(this);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    window.removeEventListener('pointermove', this._onPointer);
    window.removeEventListener('scroll', this._onScroll);
    document.removeEventListener('visibilitychange', this._onVis);
    quality.removeEventListener('change', this._onQuality);
  }
}
