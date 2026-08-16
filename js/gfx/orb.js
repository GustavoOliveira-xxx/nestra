/* =====================================================================
   NESTRA — Peça 3D do ambiente

   Cada ambiente ganha um sólido próprio, girando na cor dele. A forma
   vem do ícone escolhido, então Trabalho, Estudos e Pessoal nascem
   diferentes sem ninguém precisar configurar nada.

   Tudo é traçado por ray marching sobre formas arredondadas — nenhuma
   aresta viva, para combinar com o traço mais limpo da interface.
   ===================================================================== */

import { program, fullscreenQuad } from '../core/gl.js';

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
uniform vec3  uColor;
uniform int   uShape;
uniform vec2  uTilt;
uniform float uHover;
uniform float uEnergy;   // 0..1 — quanto o ambiente está "carregado"

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}
float sdOctahedron(vec3 p, float s, float r) {
  p = abs(p);
  return (p.x + p.y + p.z - s) * 0.57735027 - r;
}
float sdCapsule(vec3 p, float h, float r) {
  p.y -= clamp(p.y, -h, h);
  return length(p) - r;
}
float sdHexPrism(vec3 p, vec2 h, float r) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  vec2 d = vec2(
    length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x),
    p.z - h.y);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

float map(vec3 p) {
  // uma respiração lenta, para a peça nunca parecer congelada
  float breathe = 1.0 + sin(uTime * 1.1) * 0.035 + uHover * 0.08;
  p /= breathe;

  float d;
  if (uShape == 0) {
    d = sdRoundBox(p, vec3(0.46, 0.34, 0.30), 0.14);
  } else if (uShape == 1) {
    d = sdTorus(p, vec2(0.46, 0.18));
  } else if (uShape == 2) {
    d = sdOctahedron(p, 0.62, 0.10);
  } else if (uShape == 3) {
    d = sdCapsule(p, 0.28, 0.36);
  } else if (uShape == 4) {
    // esfera com ondulação — a peça mais orgânica do conjunto
    float wob = sin(p.x * 6.0 + uTime) * sin(p.y * 6.0 - uTime * 0.7) * sin(p.z * 6.0) * 0.05;
    d = length(p) - 0.58 + wob;
  } else {
    d = sdHexPrism(p, vec2(0.44, 0.22), 0.10);
  }
  return d * breathe;
}

vec3 normalAt(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0025;
  return normalize(
    e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

void main() {
  vec2 uv = vUv;
  uv.x *= uRes.x / uRes.y;

  vec3 ro = vec3(0.0, 0.0, 2.5);
  vec3 rd = normalize(vec3(uv * 0.82, -1.0));

  mat3 rot = rotY(uTime * 0.55 + uTilt.x) * rotX(sin(uTime * 0.4) * 0.28 + uTilt.y);
  mat3 inv = transpose(rot);
  ro = inv * ro;
  rd = inv * rd;

  float t = 0.0;
  bool hit = false;
  vec3 p = vec3(0.0);
  float glow = 0.0;

  for (int i = 0; i < 64; i++) {
    p = ro + rd * t;
    float d = map(p);
    glow += exp(-d * 20.0) * 0.03;
    if (d < 0.0012) { hit = true; break; }
    t += d * 0.9;
    if (t > 5.0) break;
  }

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (hit) {
    vec3 n = normalAt(p);
    vec3 key = normalize(vec3(-0.5, 0.8, 0.7));

    float diff = max(dot(n, key), 0.0);
    float fres = pow(clamp(1.0 - dot(n, -rd), 0.0, 1.0), 2.4);
    vec3 h = normalize(key - rd);
    float spec = pow(max(dot(n, h), 0.0), 64.0);

    vec3 base = pow(uColor, vec3(2.2));

    color  = base * (0.14 + diff * 0.80);
    color += base * fres * 1.5;
    color += vec3(1.0) * spec * 0.55;

    // faixas internas girando, como um núcleo vivo
    float rings = sin(p.y * 12.0 - uTime * 2.2) * 0.5 + 0.5;
    color += base * smoothstep(0.86, 1.0, rings) * (0.28 + uEnergy * 0.5);

    // reflexo de céu falso
    vec3 refl = reflect(rd, n);
    color += mix(vec3(0.02, 0.03, 0.07), base * 0.5, refl.y * 0.5 + 0.5) * 0.4;

    alpha = 1.0;
  }

  color += pow(uColor, vec3(2.2)) * glow * (0.6 + uHover * 0.8);
  alpha = clamp(alpha + glow * 0.55, 0.0, 1.0);

  color = pow(max(color, 0.0), vec3(0.4545));
  outColor = vec4(color * alpha, alpha);
}`;

/* Quantas peças com WebGL podem existir ao mesmo tempo. Acima disso o
   navegador começa a descartar contextos, então o resto usa o plano B. */
const MAX_LIVE = 6;
let live = 0;

const SHAPE_BY_ICON = {
  briefcase: 0, grid: 0, layers: 5,
  book: 5, target: 1, bolt: 2,
  star: 2, bulb: 4, heart: 4,
  home: 0, wallet: 0, shield: 3,
};

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#2F6BFF');
  if (!m) return [0.184, 0.42, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export class EnvOrb {
  constructor(canvas, { color = '#2F6BFF', icon = 'layers', energy = 0 } = {}) {
    this.canvas = canvas;
    this.color = hexToRgb(color);
    this.shape = SHAPE_BY_ICON[icon] ?? 0;
    this.energy = Math.max(0, Math.min(1, energy));
    this.tilt = { x: 0, y: 0, tx: 0, ty: 0 };
    this.hover = 0;
    this.targetHover = 0;
    this.running = false;
    this._t0 = performance.now() + Math.random() * 4000;
  }

  init() {
    if (live >= MAX_LIVE) return false;

    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      depth: false,
      powerPreference: 'low-power',
    });
    if (!gl) return false;

    try {
      this.prog = program(gl, VS, FS);
    } catch {
      return false;
    }

    this.gl = gl;
    this.quad = fullscreenQuad(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.prog.a.aPos);
    gl.vertexAttribPointer(this.prog.a.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    live++;
    this._bindHost();
    this.resize();
    this.start();
    return true;
  }

  _bindHost() {
    const host = this.canvas.closest('.env-card') || this.canvas.parentElement;
    if (!host) return;

    this._onMove = (ev) => {
      const r = host.getBoundingClientRect();
      this.tilt.tx = ((ev.clientX - r.left) / r.width - 0.5) * 2.2;
      this.tilt.ty = ((ev.clientY - r.top) / r.height - 0.5) * -1.4;
      this.targetHover = 1;
    };
    this._onLeave = () => {
      this.tilt.tx = 0;
      this.tilt.ty = 0;
      this.targetHover = 0;
    };

    host.addEventListener('pointermove', this._onMove, { passive: true });
    host.addEventListener('pointerleave', this._onLeave, { passive: true });
    this._host = host;
  }

  resize() {
    if (!this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round((r.width || 64) * dpr));
    const h = Math.max(1, Math.round((r.height || 64) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  start() {
    if (this.running || !this.gl) return;
    this.running = true;
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
    if (!this.canvas.isConnected) { this.destroy(); return; }

    const time = (performance.now() - this._t0) / 1000;

    this.tilt.x += (this.tilt.tx - this.tilt.x) * 0.09;
    this.tilt.y += (this.tilt.ty - this.tilt.y) * 0.09;
    this.hover += (this.targetHover - this.hover) * 0.08;

    this.resize();

    const u = this.prog.u;
    gl.useProgram(this.prog.p);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uColor, this.color);
    gl.uniform1i(u.uShape, this.shape);
    gl.uniform2f(u.uTilt, this.tilt.x, this.tilt.y);
    gl.uniform1f(u.uHover, this.hover);
    gl.uniform1f(u.uEnergy, this.energy);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stop();
    if (this._host) {
      this._host.removeEventListener('pointermove', this._onMove);
      this._host.removeEventListener('pointerleave', this._onLeave);
    }
    if (this.gl) {
      live = Math.max(0, live - 1);
      const lose = this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      this.gl = null;
    }
  }
}

/* --------------------------------------------------------------------
   Registro das peças vivas, para trocar de tela sem vazar contextos
   -------------------------------------------------------------------- */
const active = new Set();

export function mountOrb(canvas, options) {
  const orb = new EnvOrb(canvas, options);
  if (orb.init()) {
    active.add(orb);
    return orb;
  }
  // Sem WebGL disponível: um sólido em CSS mantém a ideia de peça 3D
  const host = canvas.parentElement;
  if (host) {
    canvas.style.display = 'none';
    const cube = document.createElement('div');
    cube.className = 'orb-css';
    cube.style.setProperty('--orb-color', options?.color || '#2F6BFF');
    for (let i = 0; i < 6; i++) cube.appendChild(document.createElement('i'));
    host.appendChild(cube);
  }
  return null;
}

export function clearOrbs() {
  active.forEach((orb) => orb.destroy());
  active.clear();
}
