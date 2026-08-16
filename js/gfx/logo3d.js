/* =====================================================================
   NESTRA — Logo em 3D

   A logo NÃO é redesenhada em vetor. O arquivo PNG original é convertido
   num campo de distância com sinal e depois extrudado por ray marching,
   de modo que a silhueta em 3D é exatamente a silhueta dos pixels do
   arquivo — inclusive contra-formas e detalhes internos. As cores também
   vêm da própria imagem. Para trocar a logo, basta substituir o PNG.

   Se o navegador não tiver WebGL2, entra um plano B em CSS que empilha
   cópias da mesma imagem em profundidade — continua sendo a logo original.
   ===================================================================== */

import {
  program, fullscreenQuad, buildSDF, rasterize, trimAlpha, toHalf,
  dematte, downscaleRGBA,
} from '../core/gl.js';

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform sampler2D uSdf;
uniform sampler2D uCol;
uniform float uAspect;    // proporção do campo de distância
uniform vec2  uRot;       // guinada e inclinação
uniform float uDepth;     // metade da espessura
uniform float uBevel;     // raio do chanfro
uniform float uErode;     // >0 encolhe a forma (usado na montagem)
uniform float uReveal;    // 0..1 progresso da montagem
uniform vec3  uAccent;
uniform float uGlow;
uniform float uZoom;

const int  MAX_STEPS = 128;
const float MAX_DIST = 9.0;

// --- silhueta lida do arquivo original -------------------------------
float sdf2d(vec2 q) {
  vec2 ext = vec2(uAspect, 1.0);
  vec2 d = abs(q) - ext;
  float outside = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  if (outside > 0.0) return outside + 0.03;
  vec2 uv = vec2(q.x / uAspect * 0.5 + 0.5, 0.5 - q.y * 0.5);
  return texture(uSdf, uv).r;
}

// --- extrusão com chanfro --------------------------------------------
float map(vec3 p) {
  float d2 = sdf2d(p.xy) + uBevel + uErode;
  vec2 w = vec2(d2, abs(p.z) - max(uDepth - uBevel, 0.001));
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - uBevel;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0016;
  return normalize(
    e.xyy * map(p + e.xyy) +
    e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) +
    e.xxx * map(p + e.xxx));
}

float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.012 + 0.11 * float(i) / 4.0;
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.4 * occ, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.03;
  for (int i = 0; i < 24; i++) {
    float h = map(ro + rd * t);
    res = min(res, 9.0 * h / t);
    t += clamp(h, 0.012, 0.14);
    if (res < 0.005 || t > 3.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}
mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

// Céu falso: dá ao metal algo para refletir
vec3 environment(vec3 rd) {
  float up = rd.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.016, 0.024, 0.05), vec3(0.05, 0.09, 0.20), up);
  sky += uAccent * pow(max(rd.y, 0.0), 3.0) * 0.42;
  sky += vec3(0.10, 0.16, 0.34) * pow(max(-rd.y, 0.0), 2.0) * 0.5;
  return sky;
}

void main() {
  vec2 uv = vUv;
  uv.x *= uRes.x / uRes.y;

  vec3 ro = vec3(0.0, 0.0, 3.25 / uZoom);
  vec3 rd = normalize(vec3(uv * 0.62, -1.0));

  mat3 rot = rotY(uRot.x) * rotX(uRot.y);
  mat3 inv = transpose(rot);
  ro = inv * ro;
  rd = inv * rd;

  // Descarta cedo o que passa longe do volume da marca
  float bound = length(vec2(uAspect, 1.0)) + uDepth + 0.25;
  float b = dot(-ro, rd);
  float c2 = dot(ro, ro) - bound * bound;
  float disc = b * b - c2;
  if (disc < 0.0) { outColor = vec4(0.0); return; }

  float t = max(b - sqrt(disc), 0.0);
  float tMax = min(b + sqrt(disc), MAX_DIST);

  float glowAccum = 0.0;
  bool hit = false;
  vec3 p = vec3(0.0);
  float lastD = 1.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    p = ro + rd * t;
    float d = map(p);
    lastD = d;
    // Brilho volumétrico: quanto mais perto a raio passa, mais acende
    glowAccum += exp(-d * 26.0) * 0.028;
    if (d < 0.0006) { hit = true; break; }
    t += d * 0.85;
    if (t > tMax) break;
  }

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (hit) {
    vec3 n = calcNormal(p);

    // Cor vinda da própria imagem da logo
    vec2 cuv = vec2(p.x / uAspect * 0.5 + 0.5, 0.5 - p.y * 0.5);
    vec4 src = texture(uCol, clamp(cuv, 0.001, 0.999));

    // A imagem está em sRGB: linearizar antes de qualquer luz incidir.
    vec3 art = pow(max(src.rgb, 0.0), vec3(2.2));
    if (src.a < 0.02) art = pow(uAccent, vec3(2.2)) * 0.7;

    float facing = abs(n.z);

    vec3 lightKey  = normalize(vec3(-0.55, 0.72, 0.86));
    vec3 lightFill = normalize(vec3(0.78, -0.22, 0.42));

    float diff = max(dot(n, lightKey), 0.0);
    float fill = max(dot(n, lightFill), 0.0);
    float rim  = pow(clamp(1.0 - dot(n, -rd), 0.0, 1.0), 2.8);

    float sh = softShadow(p + n * 0.014, lightKey);
    float ao = ambientOcclusion(p, n);

    vec3 h = normalize(lightKey - rd);
    float spec = pow(max(dot(n, h), 0.0), 78.0);

    /* A face é a arte — quase intacta.
       A luz aqui só dá volume; ela não repinta a marca. O que produz a
       sensação de 3D são a espessura, o chanfro, o giro e o aro, não uma
       reinterpretação das cores do desenho. */
    vec3 front = art * (0.90 + 0.26 * diff * mix(0.6, 1.0, sh) + 0.08 * fill);
    front += vec3(1.0) * spec * 0.30;

    /* A parede da extrusão é a única superfície inventada: uma versão
       escurecida da própria arte, para a peça ter lateral crível. */
    vec3 wall = art * 0.30 + pow(uAccent, vec3(2.2)) * 0.09;
    wall *= 0.22 + 0.92 * diff * mix(0.45, 1.0, sh);
    wall += vec3(1.0) * spec * 0.22;

    color = mix(wall, front, smoothstep(0.22, 0.72, facing));

    // Aro de luz no contorno: separa a peça do fundo sem manchar a arte
    color += uAccent * rim * 0.62;

    // Reflexo discreto, só o suficiente para a superfície não ficar chapada
    vec3 refl = reflect(rd, n);
    color += environment(refl) * 0.12 * (0.3 + 0.7 * facing);

    color *= mix(0.68, 1.0, ao);

    // Brilho que percorre a peça — o sinal de que ela está viva
    float band = sin((p.y * 3.0) - uTime * 1.1);
    color += mix(uAccent, vec3(1.0), 0.4) * smoothstep(0.988, 1.0, band) * 0.30 * facing;

    // Durante a montagem, a borda viva do corte fica incandescente
    float edge = smoothstep(0.055, 0.0, abs(sdf2d(p.xy) + uErode));
    color += mix(uAccent, vec3(0.55, 0.92, 1.0), 0.5) * edge * (1.0 - uReveal) * 3.2;

    alpha = 1.0;
  }

  // Halo: dá corpo ao brilho sem precisar de um passe de bloom
  float halo = clamp(glowAccum, 0.0, 1.0) * uGlow;
  color += uAccent * halo * 0.85;
  alpha = clamp(alpha + halo * 0.65, 0.0, 1.0);

  // Correção de gama e leve realce de contraste
  color = pow(max(color, 0.0), vec3(0.4545));
  color = (color - 0.5) * 1.06 + 0.5;

  outColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}`;

/* ------------------------------------------------------------------ */

const cache = new Map();

const PAD_FRACTION = 0.06;   // respiro em volta da marca, nos dois mapas

/**
 * Onde a marca pode estar.
 *
 * O primeiro arquivo que carregar é o usado. Assim dá para trocar a logo
 * só soltando o arquivo na pasta, com o nome e a extensão que vierem do
 * seu editor — não precisa converter nem mexer em código.
 */
export const LOGO_CANDIDATES = [
  'assets/logo/nestra-mark.png',
  'assets/logo/nestra-mark.jpg',
  'assets/logo/nestra-mark.jpeg',
  'assets/logo/nestra-mark.webp',
  'assets/logo/logo.png',
  'assets/logo/logo.jpg',
  'assets/logo/nestra-logo.png',
];

let resolvedSource = null;

/** Marca escolhida pelo usuário dentro do próprio app. */
const OVERRIDE_KEY = 'nestra:logo';

function canLoad(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

export function getLogoOverride() {
  try { return localStorage.getItem(OVERRIDE_KEY); } catch { return null; }
}

/**
 * Guarda uma marca enviada pelo usuário.
 *
 * A imagem é reduzida para no máximo 1024px e regravada como PNG antes de
 * ir para o armazenamento local — o suficiente para o 3D e pequeno o
 * bastante para caber. Nada é enviado para lugar nenhum: a marca fica no
 * navegador de quem escolheu.
 */
export async function setLogoFromFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem (PNG, JPG ou WEBP).');
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    reader.readAsDataURL(file);
  });

  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const max = 1024;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k);
  const h = Math.round(img.naturalHeight * k);

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  const png = cv.toDataURL('image/png');

  localStorage.setItem(OVERRIDE_KEY, png);
  clearLogoCache();
  return png;
}

export function clearLogoOverride() {
  try { localStorage.removeItem(OVERRIDE_KEY); } catch { /* ignora */ }
  clearLogoCache();
}

/** Esquece o que foi calculado, para a próxima marca ser processada do zero. */
export function clearLogoCache() {
  resolvedSource = null;
  cache.clear();
}

/**
 * Descobre qual marca usar, na ordem:
 *   1. a que o usuário enviou pelo próprio app
 *   2. um arquivo em assets/logo/ (vários nomes e extensões aceitos)
 */
export async function resolveLogoSource(preferred) {
  if (resolvedSource) return resolvedSource;

  const override = getLogoOverride();
  if (override && await canLoad(override)) {
    resolvedSource = override;
    return override;
  }

  const list = preferred ? [preferred, ...LOGO_CANDIDATES] : LOGO_CANDIDATES;
  for (const src of list) {
    // eslint-disable-next-line no-await-in-loop
    if (await canLoad(src)) {
      resolvedSource = src;
      return src;
    }
  }
  resolvedSource = LOGO_CANDIDATES[0];
  return resolvedSource;
}

/**
 * Carrega o arquivo da logo e prepara os dois mapas que o shader usa.
 *
 * A cor sai em alta resolução (a marca pode ter tipografia, hachura e
 * estrelas miúdas que precisam sobreviver de perto) e o campo de
 * distância sai menor, porque ele só descreve a silhueta e é consultado
 * dezenas de vezes por pixel durante o ray marching.
 *
 * Os dois compartilham exatamente o mesmo enquadramento — recorte pela
 * caixa útil mais a mesma fração de respiro —, então as coordenadas de
 * textura de um valem para o outro.
 */
async function loadSource(src, colorSide, sdfSide) {
  const key = `${src}@${colorSide}/${sdfSide}`;
  if (cache.has(key)) return cache.get(key);

  const promise = (async () => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = src;
    await img.decode();

    const raw = rasterize(img, colorSide);

    // Logo exportada sobre papel branco? o fundo externo vira transparente,
    // sem tocar nos brancos internos da marca.
    const removed = dematte(raw.data, raw.w, raw.h);
    if (removed) {
      const ctx0 = raw.canvas.getContext('2d');
      ctx0.putImageData(new ImageData(raw.data, raw.w, raw.h), 0, 0);
    }

    const box = trimAlpha(raw.data, raw.w, raw.h);
    const pad = Math.round(Math.max(box.w, box.h) * PAD_FRACTION);

    // --- textura de cor, na resolução cheia ---
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = box.w + pad * 2;
    colorCanvas.height = box.h + pad * 2;
    const cctx = colorCanvas.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(raw.canvas, box.x, box.y, box.w, box.h, pad, pad, box.w, box.h);

    // --- campo de distância, na resolução reduzida ---
    const full = cctx.getImageData(0, 0, colorCanvas.width, colorCanvas.height).data;
    const scale = Math.min(1, sdfSide / Math.max(colorCanvas.width, colorCanvas.height));
    const sw = Math.max(16, Math.round(colorCanvas.width * scale));
    const sh = Math.max(16, Math.round(colorCanvas.height * scale));

    const small = scale < 1
      ? downscaleRGBA(full, colorCanvas.width, colorCanvas.height, sw, sh)
      : full;

    const sdf = buildSDF(small, sw, sh, 0);

    return { sdf, colorCanvas };
  })();

  cache.set(key, promise);
  return promise;
}

export class Logo3D {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.opts = Object.assign({
      src: 'assets/logo/nestra-mark.png',
      depth: 0.20,
      bevel: 0.035,
      accent: [0.184, 0.42, 1.0],
      glow: 0.55,
      zoom: 1.0,
      autoSpin: 0.16,
      // A cor precisa de resolução (a marca pode ter tipografia e detalhe
      // fino); a silhueta, não — ela é consultada muitas vezes por pixel.
      colorSide: 900,
      sdfSide: 360,
      reveal: 1,
      interactive: true,
    }, options);

    this.rot = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.reveal = this.opts.reveal;
    this.running = false;
    this.ready = false;
    this._t0 = performance.now();
    this._raf = 0;
    this._dpr = 1;
  }

  async init() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      depth: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      this._fallback();
      return false;
    }
    this.gl = gl;

    let source;
    try {
      source = await loadSource(this.opts.src, this.opts.colorSide, this.opts.sdfSide);
    } catch (err) {
      console.warn('[nestra] não consegui ler a logo:', err);
      this._fallback();
      return false;
    }

    try {
      this.prog = program(gl, VS, FS);
    } catch (err) {
      console.warn('[nestra] shader da logo falhou:', err);
      this._fallback();
      return false;
    }

    this.quad = fullscreenQuad(gl);
    this.aspect = source.sdf.aspect;

    // --- textura do campo de distância (R16F, filtragem linear) ---
    const { data, w, h } = source.sdf;
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = toHalf(data[i]);

    this.sdfTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);

    // Uma linha do campo de distância tem largura×2 bytes, que quase nunca
    // é múltiplo de 4. Sem baixar o alinhamento, o WebGL lê cada linha
    // deslocada e a silhueta sai como um retângulo em vez da marca.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, half);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // --- textura de cor: os pixels originais da logo ---
    this.colTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.colTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.colorCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.prog.a.aPos);
    gl.vertexAttribPointer(this.prog.a.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.ready = true;
    this._bindEvents();
    this.resize();
    this.start();
    return true;
  }

  /* Plano B sem WebGL: a mesma imagem empilhada em profundidade. */
  _fallback() {
    const host = this.canvas.parentElement;
    if (!host || host.querySelector('.logo-css3d')) return;
    this.canvas.style.display = 'none';

    const box = document.createElement('div');
    box.className = 'logo-css3d';
    const layers = 16;
    for (let i = 0; i < layers; i++) {
      const layer = document.createElement('img');
      layer.src = this.opts.src;
      layer.alt = '';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.transform = `translateZ(${(i - layers / 2) * 1.4}px)`;
      layer.style.filter = i < layers - 1
        ? `brightness(${0.24 + (i / layers) * 0.42})`
        : 'none';
      box.appendChild(layer);
    }
    host.appendChild(box);
    this.cssFallback = box;

    if (this.opts.interactive) {
      this._cssMove = (ev) => {
        const r = host.getBoundingClientRect();
        const nx = (ev.clientX - r.left) / r.width - 0.5;
        const ny = (ev.clientY - r.top) / r.height - 0.5;
        box.style.transform = `rotateY(${nx * 34}deg) rotateX(${-ny * 26}deg)`;
      };
      host.addEventListener('pointermove', this._cssMove);
      host.addEventListener('pointerleave', () => { box.style.transform = ''; });
    }
  }

  _bindEvents() {
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize, { passive: true });

    if (this.opts.interactive) {
      this._onPointer = (ev) => {
        const r = this.canvas.getBoundingClientRect();
        const nx = (ev.clientX - r.left) / r.width - 0.5;
        const ny = (ev.clientY - r.top) / r.height - 0.5;
        this.target.x = nx * 1.15;
        this.target.y = -ny * 0.75;
      };
      window.addEventListener('pointermove', this._onPointer, { passive: true });
    }

    this._onVisibility = () => {
      if (document.hidden) this.stop();
      else this.start();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  resize() {
    if (!this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
    this._dpr = dpr;
  }

  setReveal(v) { this.reveal = Math.max(0, Math.min(1, v)); }

  start() {
    if (!this.ready || this.running) return;
    this.running = true;
    this._t0 = performance.now() - (this._elapsed || 0);
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

  render() {
    const gl = this.gl;
    const now = performance.now();
    this._elapsed = now - this._t0;
    const time = this._elapsed / 1000;

    // Balanço lento contínuo + atração suave em direção ao ponteiro
    const idleY = Math.sin(time * 0.42) * 0.19 + time * this.opts.autoSpin * 0.34;
    const idleX = Math.sin(time * 0.31) * 0.11;

    this.rot.x += ((this.target.x + idleY) - this.rot.x) * 0.055;
    this.rot.y += ((this.target.y + idleX) - this.rot.y) * 0.055;

    const u = this.prog.u;
    gl.useProgram(this.prog.p);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
    gl.uniform1i(u.uSdf, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colTex);
    gl.uniform1i(u.uCol, 1);

    const reveal = this.reveal;
    const eased = reveal * reveal * (3 - 2 * reveal);

    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uAspect, this.aspect);
    gl.uniform2f(u.uRot, this.rot.x, this.rot.y);
    gl.uniform1f(u.uDepth, this.opts.depth * (0.18 + 0.82 * eased));
    gl.uniform1f(u.uBevel, this.opts.bevel);
    gl.uniform1f(u.uErode, (1 - eased) * 0.42);
    gl.uniform1f(u.uReveal, eased);
    gl.uniform3fv(u.uAccent, this.opts.accent);
    gl.uniform1f(u.uGlow, this.opts.glow);
    gl.uniform1f(u.uZoom, this.opts.zoom);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    if (this._onPointer) window.removeEventListener('pointermove', this._onPointer);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.gl) {
      this.gl.deleteTexture(this.sdfTex);
      this.gl.deleteTexture(this.colTex);
      this.gl.deleteBuffer(this.quad);
      this.gl.deleteProgram(this.prog.p);
      const lose = this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  }
}
