/* =====================================================================
   NESTRA — Peça 3D do cartão de ambiente

   O mesmo sólido que abre a tela do ambiente, agora pequeno, dentro do
   cartão da grade: quem olha a lista reconhece o ambiente pela forma
   antes de ler o nome. As formas vêm de gfx/shapes.js — uma para cada
   ícone do formulário — e cada uma tem o movimento próprio, então a
   grade inteira fica viva sem nenhuma peça repetida.

   Tudo é traçado por ray marching sobre formas arredondadas — nenhuma
   aresta viva, para combinar com o traço mais limpo da interface.
   ===================================================================== */

import { program, fullscreenQuad } from '../core/gl.js';
import { device, quality, sizeCanvas, renderWhenVisible, onResize, glBudget } from '../core/device.js';
import { SHAPES_GLSL, shapeOf } from './shapes.js';

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
uniform int   uSteps;    // passos de ray marching, conforme o aparelho

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }

${SHAPES_GLSL}

vec2 map(vec3 p) {
  // uma respiração lenta, para a peça nunca parecer congelada
  float breathe = 1.0 + sin(uTime * 1.1) * 0.032 + uHover * 0.08;
  vec2 res = envShape(p / breathe, uShape, uTime, uEnergy);
  res.x *= breathe;
  return res;
}

vec3 normalAt(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0025;
  return normalize(
    e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
    e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

void main() {
  vec2 uv = vUv;
  uv.x *= uRes.x / uRes.y;

  vec3 ro = vec3(0.0, 0.0, 2.5);
  vec3 rd = normalize(vec3(uv * 0.68, -1.0));

  mat3 rot = rotY(sin(uTime * 0.34) * 0.62 + uTilt.x) * rotX(-0.16 + sin(uTime * 0.4) * 0.12 + uTilt.y);
  mat3 inv = transpose(rot);
  ro = inv * ro;
  rd = inv * rd;

  float t = 0.0;
  bool hit = false;
  vec3 p = vec3(0.0);
  float glow = 0.0;
  float mat = 0.0;

  for (int i = 0; i < 72; i++) {
    if (i >= uSteps) break;
    p = ro + rd * t;
    vec2 d = map(p);
    glow += exp(-max(d.x, 0.0) * 20.0) * 0.028;
    if (d.x < 0.0014) { hit = true; mat = d.y; break; }
    t += d.x * 0.85;
    if (t > 5.0) break;
  }

  vec3 color = vec3(0.0);
  float alpha = 0.0;
  vec3 gBase = pow(max(uColor, 0.0), vec3(2.2));

  if (hit) {
    vec3 n = normalAt(p);
    vec3 key = normalize(vec3(-0.5, 0.8, 0.7));

    float diff = max(dot(n, key), 0.0);
    float fres = pow(clamp(1.0 - dot(n, -rd), 0.0, 1.0), 2.4);
    vec3 h = normalize(key - rd);
    float spec = pow(max(dot(n, h), 0.0), 64.0);

    /* Mesma leitura de material da peça grande: corpo na cor do
       ambiente, detalhe em metal claro, núcleo aceso por dentro. */
    vec3 base = gBase;
    float lit = 0.0;
    if (mat > 1.5) {
      base = mix(gBase, vec3(1.0), 0.20);
      lit = envGlow(uShape, uTime, uEnergy);
    } else if (mat > 0.5) {
      base = mix(gBase, vec3(0.86, 0.91, 1.0), 0.55);
    }

    color  = base * (0.14 + diff * 0.82);
    color += base * fres * 1.5;
    color += vec3(1.0) * spec * 0.55;
    color += base * lit * (0.75 + (1.0 - fres) * 0.80);

    if (mat < 0.5) {
      // faixas internas girando, como um núcleo vivo
      float rings = sin(p.y * 12.0 - uTime * 2.2) * 0.5 + 0.5;
      color += base * smoothstep(0.86, 1.0, rings) * (0.28 + uEnergy * 0.5);

      // reflexo de céu falso
      vec3 refl = reflect(rd, n);
      color += mix(vec3(0.02, 0.03, 0.07), base * 0.5, refl.y * 0.5 + 0.5) * 0.4;
    }

    alpha = 1.0;
  }

  color += gBase * glow * (0.6 + uHover * 0.8);
  alpha = clamp(alpha + glow * 0.55, 0.0, 1.0);

  color = pow(max(color, 0.0), vec3(0.4545));
  outColor = vec4(color * alpha, alpha);
}`;

/* Quantas peças com WebGL podem existir ao mesmo tempo é decidido pelo
   orçamento compartilhado em core/device.js — ele conhece o aparelho e
   já conta a cena de fundo e a peça do topo do ambiente. O que não
   couber usa o plano B em CSS, que continua girando. */

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#2F6BFF');
  if (!m) return [0.184, 0.42, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export class EnvOrb {
  constructor(canvas, { color = '#2F6BFF', icon = 'layers', energy = 0 } = {}) {
    this.canvas = canvas;
    this.hexColor = color;
    this.color = hexToRgb(color);
    this.shape = shapeOf(icon);
    this.energy = Math.max(0, Math.min(1, energy));
    this.tilt = { x: 0, y: 0, tx: 0, ty: 0 };
    this.hover = 0;
    this.targetHover = 0;
    this.running = false;
    this._t0 = performance.now() + Math.random() * 4000;
  }

  init() {
    if (device.reducedMotion) return false;
    if (!glBudget.claim(this)) return false;

    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      depth: false,
      powerPreference: 'low-power',
    });
    if (!gl) { glBudget.release(this); return false; }

    try {
      this.prog = program(gl, VS, FS);
    } catch {
      glBudget.release(this);
      return false;
    }

    this.gl = gl;
    this.quad = fullscreenQuad(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.prog.a.aPos);
    gl.vertexAttribPointer(this.prog.a.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

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

    /* Cartão fora da tela não desenha. Numa lista com muitos ambientes é
       a diferença entre rolar liso e rolar aos trancos no celular. */
    this._unwatch = renderWhenVisible(host, {
      onEnter: () => { this.offscreen = false; if (!document.hidden) this.start(); },
      onLeave: () => { this.offscreen = true; this.stop(); },
    });

    this._onVis = () => {
      if (document.hidden) this.stop();
      else if (!this.offscreen) this.start();
    };
    document.addEventListener('visibilitychange', this._onVis);

    // Só remede quando o tamanho realmente muda
    this._unobserve = onResize(this.canvas, () => { this._dirty = true; });
    this._onQuality = () => { this._dirty = true; };
    quality.addEventListener('change', this._onQuality);

    // Contexto perdido pelo navegador: some o canvas e entra o cubo em CSS
    this._onLost = (ev) => {
      ev.preventDefault();
      this.stop();
      this.gl = null;
      glBudget.release(this);
      this.canvas.style.display = 'none';
      mountCssCube(this.canvas, this.hexColor);
    };
    this.canvas.addEventListener('webglcontextlost', this._onLost);
  }

  /**
   * Troca a aparência sem trocar a peça.
   *
   * Quem está criando um ambiente muda de ícone e de cor várias vezes
   * seguidas. Cada troca destruir e recriar um contexto WebGL seria o
   * caminho mais curto para o navegador começar a descartar contextos —
   * forma e cor são uniformes, então basta escrevê-los de novo.
   */
  setLook({ color, icon } = {}) {
    if (color) {
      this.hexColor = color;
      this.color = hexToRgb(color);
      const css = this.canvas.parentElement?.querySelector('.orb-css');
      if (css) css.style.setProperty('--orb-color', color);
    }
    if (icon) this.shape = shapeOf(icon);
  }

  resize() {
    if (!this.gl) return;
    // A peça é pequena: um teto um pouco mais generoso do que o da cena
    // de fundo mantém a silhueta limpa sem pesar.
    const { w, h, changed } = sizeCanvas(this.canvas, {
      cap: Math.min(2, quality.dprCap + 0.4),
    });
    if (changed) this.gl.viewport(0, 0, w, h);
    this._dirty = false;
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

    if (this._dirty) this.resize();

    const u = this.prog.u;
    gl.useProgram(this.prog.p);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uColor, this.color);
    gl.uniform1i(u.uShape, this.shape);
    gl.uniform2f(u.uTilt, this.tilt.x, this.tilt.y);
    gl.uniform1f(u.uHover, this.hover);
    gl.uniform1f(u.uEnergy, this.energy);
    // A peça é pequena na tela: no degrau mais baixo ela pode marchar
    // menos sem que ninguém perceba a diferença.
    gl.uniform1i(u.uSteps, quality.level === 'low' ? 40 : (quality.level === 'medium' ? 56 : 72));

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
    document.removeEventListener('visibilitychange', this._onVis);
    quality.removeEventListener('change', this._onQuality);
    this._unwatch?.();
    this._unobserve?.();
    this.canvas.removeEventListener('webglcontextlost', this._onLost);

    if (this.gl) {
      glBudget.release(this);
      const lose = this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      this.gl = null;
    }

    // Canvas sem contexto sai de cena: nunca um retângulo vazio no lugar
    this.canvas.style.display = 'none';
    active.delete(this);
  }
}

/* --------------------------------------------------------------------
   Registro das peças vivas, para trocar de tela sem vazar contextos
   -------------------------------------------------------------------- */
const active = new Set();

/** Sem WebGL disponível: um sólido em CSS mantém a ideia de peça 3D. */
function mountCssCube(canvas, color) {
  const host = canvas.parentElement;
  if (!host) return null;
  const existing = host.querySelector('.orb-css');
  if (existing) return existing;

  canvas.style.display = 'none';
  const cube = document.createElement('div');
  cube.className = 'orb-css';
  cube.setAttribute('aria-hidden', 'true');
  cube.style.setProperty('--orb-color', color || '#2F6BFF');
  for (let i = 0; i < 6; i++) cube.appendChild(document.createElement('i'));
  host.appendChild(cube);
  return cube;
}

export function mountOrb(canvas, options) {
  const orb = new EnvOrb(canvas, options);
  if (orb.init()) {
    active.add(orb);
    return orb;
  }

  /* Sem WebGL a peça é o cubo em CSS. Quem chamou continua recebendo
     algo com `setLook` e `destroy`, para não precisar saber qual dos
     dois caminhos acabou de acontecer. */
  const cube = mountCssCube(canvas, options?.color);
  return {
    fallback: true,
    setLook({ color } = {}) {
      if (color) cube?.style.setProperty('--orb-color', color);
    },
    destroy() { cube?.remove(); },
  };
}

export function clearOrbs() {
  active.forEach((orb) => orb.destroy());
  active.clear();
}
