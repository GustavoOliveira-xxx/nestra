/* =====================================================================
   NESTRA — Peça 3D do topo do ambiente

   Cada ambiente abre com o sólido dele flutuando sobre um piso
   refletivo, com satélites em órbita e a luz vindo de onde está o
   ponteiro. A forma vem do ícone escolhido — maleta, livro, coração,
   casa, lâmpada — e a cor vem do ambiente: entrar em "Trabalho" e entrar
   em "Estudos" são experiências visuais diferentes sem ninguém precisar
   configurar nada. Os sólidos moram em gfx/shapes.js, compartilhados com
   os cartões da grade de ambientes.

   Traçado por ray marching em um único passe de fragment shader — sem
   biblioteca externa, porque o app precisa abrir offline.

   O custo se ajusta sozinho: o número de passos, o reflexo do piso e a
   sombra suave entram ou saem conforme o fôlego do aparelho, medido pelo
   governo de qualidade. No celular a peça continua girando, só que com
   menos pixels por quadro.
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
uniform vec2  uSpin;      // giro acumulado: ponteiro + rotação própria
uniform vec2  uPointer;   // -1..1 dentro do painel
uniform float uHover;
uniform float uPress;
uniform float uEnergy;    // 0..1 — quanto o ambiente está carregado
uniform int   uQuality;   // 0 baixo · 1 médio · 2 alto
uniform float uAppear;    // 0..1 — a peça se montando ao abrir a tela
uniform float uZoom;      // compensa painéis largos e baixos
uniform float uOrbit;     // fase acumulada dos satélites
uniform float uCharge;    // 0..1 — acabou de receber uma conclusão
uniform float uWave;      // segundos desde a conclusão, para a onda

const float FLOOR_Y = -0.86;

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }

mat3 gRot;      // orientação do corpo, montada no main
vec3 gBase;     // cor do ambiente já em espaço linear

${SHAPES_GLSL}

/* O corpo do ambiente, já com a respiração lenta, o recuo do clique e o
   susto da conclusão. */
vec2 bodySDF(vec3 p) {
  float breathe = 1.0
    + sin(uTime * 0.85) * 0.026
    + uHover * 0.05
    - uPress * 0.055
    + uCharge * 0.07;

  vec2 s = envShape(p / breathe, uShape, uTime, uEnergy);

  // Enquanto a tela entra, a peça vem de dentro para fora.
  s.x = s.x * breathe - (1.0 - uAppear) * 0.22;
  return s;
}

/* x = distância · y = material (0 corpo · 1 detalhe · 2 núcleo · 3 satélite) */
vec2 mapScene(vec3 p) {
  vec2 res = bodySDF(gRot * p);

  // Satélites: órbita própria, independente do giro do corpo — é o que
  // dá a leitura de espaço em volta do objeto, e não só de um objeto.
  // Ao concluir alguma coisa eles aceleram e se abrem por um instante.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float a = uOrbit * (1.0 + fi * 0.36) + fi * 2.0944;
    float radius = (1.02 + fi * 0.14 + uCharge * 0.20) * mix(0.6, 1.0, uAppear);
    vec3 c = vec3(cos(a) * radius,
                  sin(a * 0.8 + fi * 1.7) * 0.26,
                  sin(a) * radius);
    float s = length(p - c) - (0.068 - fi * 0.011) * (1.0 + uCharge * 0.40);
    if (s < res.x) res = vec2(s, 3.0);
  }
  return res;
}

vec3 normalAt(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0022;
  return normalize(
    e.xyy * mapScene(p + e.xyy).x + e.yyx * mapScene(p + e.yyx).x +
    e.yxy * mapScene(p + e.yxy).x + e.xxx * mapScene(p + e.xxx).x);
}

float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 26; i++) {
    float h = mapScene(ro + rd * t).x;
    res = min(res, k * h / t);
    t += clamp(h, 0.025, 0.28);
    if (res < 0.005 || t > maxt) break;
  }
  return clamp(res, 0.0, 1.0);
}

float occlusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.012 + 0.09 * float(i);
    occ += (h - mapScene(p + n * h).x) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  uv.x *= uRes.x / uRes.y;

  gRot = rotY(uSpin.x) * rotX(uSpin.y);
  gBase = pow(max(uColor, 0.0), vec3(2.2));

  // A câmera desliza um pouco com o ponteiro: o objeto ganha paralaxe
  // de verdade, não só uma rotação.
  vec3 ro = vec3(uPointer.x * 0.20, 0.10 - uPointer.y * 0.14, 2.55);
  // Mira um pouco abaixo do centro: a peça sobe no quadro e sobra
  // espaço para o reflexo no piso, que senão morre cortado na borda.
  vec3 ta = vec3(0.0, -0.10, 0.0);
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(uv.x * rt + uv.y * up + 2.05 * uZoom * fw);

  vec3 light = normalize(vec3(-0.5 + uPointer.x * 0.55, 0.82, 0.62));

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float glow = 0.0;

  int steps = uQuality == 0 ? 44 : (uQuality == 1 ? 68 : 96);

  float t = 0.0;
  float mat = -1.0;
  vec3 p = ro;
  bool hit = false;

  for (int i = 0; i < 96; i++) {
    if (i >= steps) break;
    p = ro + rd * t;
    vec2 h = mapScene(p);
    glow += exp(-max(h.x, 0.0) * 15.0) * 0.013;
    if (h.x < 0.0013 * t) { hit = true; mat = h.y; break; }
    t += h.x * 0.82;
    if (t > 7.0) break;
  }

  if (hit) {
    vec3 n = normalAt(p);
    float diff = max(dot(n, light), 0.0);
    float fres = pow(clamp(1.0 - dot(n, -rd), 0.0, 1.0), 3.0);
    vec3 hv = normalize(light - rd);
    float spec = pow(max(dot(n, hv), 0.0), 96.0);
    float ao = occlusion(p, n);
    float sh = uQuality > 0 ? softShadow(p + n * 0.02, light, 0.03, 3.2, 9.0) : 1.0;

    /* Cada material tem seu jeito de receber a luz: o corpo é a cor do
       ambiente, o detalhe é metal claro, o núcleo é aceso por dentro. */
    vec3 base = gBase;
    float lit = 0.0;

    if (mat > 2.5) {
      base = mix(gBase, vec3(0.62, 0.85, 1.0), 0.42);
      lit = 0.55 + uCharge * 0.85;
    } else if (mat > 1.5) {
      base = mix(gBase, vec3(1.0), 0.20);
      lit = envGlow(uShape, uTime, uEnergy) * (1.0 + uCharge * 1.3);
    } else if (mat > 0.5) {
      base = mix(gBase, vec3(0.86, 0.91, 1.0), 0.55);
    }

    col  = base * (0.13 + diff * 1.02 * sh) * ao;
    col += base * fres * (1.35 + uHover * 0.8);
    col += vec3(1.0) * spec * (0.70 + uPress * 0.5) * sh;
    col += base * lit * (0.80 + (1.0 - fres) * 0.85);
    if (mat > 1.5 && mat < 2.5) col += vec3(1.0) * lit * (1.0 - fres) * 0.20;

    if (mat < 0.5) {
      // faixas percorrendo o corpo, como um núcleo em funcionamento
      vec3 q = gRot * p;
      float rings = sin(q.y * 13.0 - uTime * 1.9) * 0.5 + 0.5;
      col += base * smoothstep(0.72, 1.0, rings) * (0.32 + uEnergy * 0.6);

      // a conclusão sobe pelo corpo como um pulso de energia
      float sweep = exp(-abs((q.y + 0.62) - uWave * 1.9) * 5.5) * exp(-uWave * 1.3);
      col += mix(base, vec3(1.0), 0.55) * sweep * 1.7;

      // céu falso refletido: dá peso de material sem custar um segundo passe
      vec3 refl = reflect(rd, n);
      col += mix(vec3(0.015, 0.025, 0.06), base * 0.55, refl.y * 0.5 + 0.5) * 0.34;
    }

    alpha = 1.0;
  } else if (rd.y < -0.001) {
    /* --- piso: grade, varredura de luz, sombra de contato e reflexo --- */
    float ft = (FLOOR_Y - ro.y) / rd.y;
    if (ft > 0.0 && ft < 11.0) {
      vec3 fp = ro + rd * ft;
      float fade = 1.0 - smoothstep(1.1, 4.2, length(fp.xz));

      if (fade > 0.001) {
        vec2 g = abs(fract(fp.xz * 1.15) - 0.5);
        float line = 1.0 - smoothstep(0.0, 0.04, min(g.x, g.y));
        float band = smoothstep(0.86, 1.0, sin(fp.z * 0.9 - uTime * 0.55) * 0.5 + 0.5);

        float sh = uQuality > 0
          ? softShadow(fp + vec3(0.0, 0.012, 0.0), light, 0.03, 3.0, 7.0)
          : 1.0;

        // onda de choque da conclusão, abrindo a partir da peça
        float shock = exp(-abs(length(fp.xz) - uWave * 2.2) * 5.5) * exp(-uWave * 1.25);

        vec3 fcol = gBase * (line * 0.42 + band * 0.20) * fade;
        float refl = 0.0;

        if (uQuality == 2) {
          vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
          float rt2 = 0.06;
          for (int i = 0; i < 46; i++) {
            vec2 h = mapScene(fp + rr * rt2);
            if (h.x < 0.004) { refl = 1.0; break; }
            rt2 += h.x * 0.92;
            if (rt2 > 4.2) break;
          }
          // o reflexo desaparece com a distância, como em piso polido
          refl *= fade * (1.0 - smoothstep(0.4, 2.6, rt2));
          fcol += gBase * refl * 0.5;
        }

        fcol *= 0.30 + 0.70 * sh;
        fcol += mix(gBase, vec3(1.0), 0.4) * shock * 1.5 * fade;
        col = fcol;
        alpha = clamp(fade * (line * 0.34 + refl * 0.55 + band * 0.12 + shock * 0.75 + 0.05), 0.0, 0.82);
      }
    }
  }

  // halo geral em volta da peça
  col += gBase * glow * (0.65 + uHover * 0.85 + uCharge * 1.1);
  alpha = clamp(alpha + glow * 0.55, 0.0, 1.0);
  alpha *= uAppear;

  col = pow(max(col, 0.0), vec3(0.4545));
  outColor = vec4(col * alpha, alpha);
}`;

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#2F6BFF');
  if (!m) return [0.184, 0.42, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

const QUALITY_CODE = { low: 0, medium: 1, high: 2 };

export class EnvHero {
  constructor(canvas, { color = '#2F6BFF', icon = 'layers', energy = 0 } = {}) {
    this.canvas = canvas;
    this.host = canvas.closest('.env-hero') || canvas.parentElement;
    this.hexColor = color;
    this.color = hexToRgb(color);
    this.shape = shapeOf(icon);
    this.energy = Math.max(0, Math.min(1, energy));

    /* De frente e um pouco de cima. A peça é um objeto reconhecível —
       maleta, livro, casa —, então ela nunca vira de costas: balança em
       torno desta pose em vez de girar sem parar. */
    this.spin = { x: 0, y: -0.18 };
    this.target = { x: 0, y: -0.18 };
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.hover = 0;
    this.targetHover = 0;
    this.press = 0;
    this.targetPress = 0;
    this.appear = 0;
    this.zoom = 1;

    /* Órbita, susto e onda: a peça responde quando alguma coisa é
       concluída no ambiente (ver celebrate/pulseEnvHeroes). A fase da
       órbita é acumulada aqui, e não calculada do tempo, para que
       acelerar não faça o satélite saltar de lugar. */
    this.orbit = 0;
    this.charge = 0;
    this.wave = 60;

    this.running = false;
    this.visible = true;
    this._t0 = performance.now();
    this._lastFrame = this._t0;
  }

  init() {
    if (device.reducedMotion) return false;
    if (!glBudget.claim(this)) return false;

    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      depth: false,
      powerPreference: device.mobile ? 'low-power' : 'high-performance',
    });
    if (!gl) { glBudget.release(this); return false; }

    try {
      this.prog = program(gl, VS, FS);
    } catch (err) {
      console.warn('[nestra] peça 3D do ambiente indisponível:', err);
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

    this._bind();
    this.resize();
    this.start();
    return true;
  }

  /* ------------------------------------------------------------------
     Ponteiro, toque e visibilidade
     ------------------------------------------------------------------ */
  _bind() {
    const host = this.host;

    /* O ponteiro comanda a peça. Dentro do painel ele manda de verdade;
       fora dele resta uma influência fraca, só para o objeto não parecer
       preso enquanto o resto da página se mexe. */
    this._onMove = (ev) => {
      // Em tela de toque não existe "passar por cima": só o arrasto conta.
      // Sem isso, rolar a página faria a peça girar junto.
      if (device.touch && !this.dragging) return;

      const r = host.getBoundingClientRect();
      const inside =
        ev.clientX >= r.left && ev.clientX <= r.right &&
        ev.clientY >= r.top && ev.clientY <= r.bottom;

      const nx = (ev.clientX - r.left) / Math.max(1, r.width) - 0.5;
      const ny = (ev.clientY - r.top) / Math.max(1, r.height) - 0.5;

      if (this.dragging) return;

      const weight = inside ? 1 : 0.28;
      this.target.x = nx * 1.9 * weight;
      this.target.y = -0.18 + ny * 0.95 * weight;
      this.pointer.tx = Math.max(-1, Math.min(1, nx * 2)) * weight;
      this.pointer.ty = Math.max(-1, Math.min(1, ny * 2)) * weight;
      this.targetHover = inside ? 1 : 0;
    };

    /* Arrastar gira à mão — o caminho natural em tela de toque, onde não
       existe "passar o ponteiro por cima". */
    this._onDown = (ev) => {
      this.dragging = true;
      this._dragFrom = { x: ev.clientX, y: ev.clientY, sx: this.target.x, sy: this.target.y };
      this.targetPress = 1;
      this.targetHover = 1;
      host.setPointerCapture?.(ev.pointerId);
    };

    this._onDrag = (ev) => {
      if (!this.dragging) return;
      const r = host.getBoundingClientRect();
      this.target.x = this._dragFrom.sx + (ev.clientX - this._dragFrom.x) / Math.max(1, r.width) * 5.2;
      this.target.y = this._dragFrom.sy + (ev.clientY - this._dragFrom.y) / Math.max(1, r.height) * 2.4;
      this.target.y = Math.max(-1.05, Math.min(1.05, this.target.y));
    };

    this._onUp = () => {
      this.dragging = false;
      this.targetPress = 0;
      if (device.touch) this.targetHover = 0;
    };

    this._onLeave = () => {
      if (this.dragging) return;
      this.targetHover = 0;
      this.pointer.tx = 0;
      this.pointer.ty = 0;
    };

    window.addEventListener('pointermove', this._onMove, { passive: true });
    host.addEventListener('pointerdown', this._onDown, { passive: true });
    window.addEventListener('pointermove', this._onDrag, { passive: true });
    window.addEventListener('pointerup', this._onUp, { passive: true });
    window.addEventListener('pointercancel', this._onUp, { passive: true });
    host.addEventListener('pointerleave', this._onLeave, { passive: true });

    this._onVis = () => (document.hidden ? this.stop() : this.visible && this.start());
    document.addEventListener('visibilitychange', this._onVis);

    // O canvas é medido só quando muda de tamanho, nunca dentro do laço
    this._unobserve = onResize(this.canvas, () => { this._dirty = true; });

    // Rolou para fora da tela: para de desenhar. É o que segura a rolagem
    // fluida no celular.
    this._unwatch = renderWhenVisible(host, {
      onEnter: () => { this.visible = true; if (!document.hidden) this.start(); },
      onLeave: () => { this.visible = false; this.stop(); },
    });

    this._onQuality = () => { this._dirty = true; };
    quality.addEventListener('change', this._onQuality);

    /* O navegador pode tomar de volta o contexto WebGL a qualquer momento
       — troca de GPU, aba em segundo plano por muito tempo, memória
       apertada. Sem tratar isso, o canvas fica na tela sem nada dentro.
       Aqui ele sai de cena e o plano B em CSS entra no lugar. */
    this._onLost = (ev) => {
      ev.preventDefault();
      this.stop();
      this.gl = null;
      glBudget.release(this);
      mountCssFallback(this.canvas, { color: this.hexColor });
    };
    this.canvas.addEventListener('webglcontextlost', this._onLost);
  }

  resize() {
    if (!this.gl) return;

    /* A peça é o assunto da página, e o canvas dela é pequeno perto da
       cena de fundo. Vale mais pixel aqui do que ali: mesmo no degrau
       mais baixo a silhueta não pode sair serrilhada. */
    const { w, h, changed } = sizeCanvas(this.canvas, {
      cap: Math.min(2, quality.dprCap + 0.5),
    });
    if (changed) this.gl.viewport(0, 0, w, h);

    /* Painel largo e baixo — que é como ele fica no celular — deixaria a
       peça pequena no meio de muito vazio. O enquadramento fecha na
       mesma proporção em que o painel se alarga. */
    const aspect = w / Math.max(1, h);
    this.zoom = aspect > 1.5 ? Math.min(1.28, 0.72 + aspect * 0.26) : 1;

    this._dirty = false;
  }

  /**
   * Uma conclusão aconteceu neste ambiente.
   *
   * A peça leva o susto: cresce um instante, os satélites aceleram e se
   * abrem, o núcleo acende e uma onda sai dela pelo piso. É o mesmo
   * gesto do resto da interface, só que em três dimensões.
   */
  celebrate(strength = 1) {
    this.charge = Math.min(1.2, this.charge + strength);
    this.wave = 0;
    if (!this.running && this.visible && !document.hidden) this.start();
  }

  start() {
    if (this.running || !this.gl) return;
    this.running = true;
    this._lastFrame = performance.now();
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

    const now = performance.now();
    const time = (now - this._t0) / 1000;
    // Quadro perdido (aba parada, janela arrastada) não pode empurrar a
    // órbita meio giro de uma vez.
    const dt = Math.min(0.05, Math.max(0, (now - this._lastFrame) / 1000));
    this._lastFrame = now;

    /* Balanço próprio somado ao que o ponteiro pede: a peça nunca fica
       parada, e também nunca gira até ficar de costas — quem chega na
       tela precisa reconhecer a maleta, o livro ou a casa de imediato. */
    const drift = Math.sin(time * 0.23) * 0.46 + Math.sin(time * 0.11) * 0.14;
    this.spin.x += ((this.target.x + drift) - this.spin.x) * 0.075;
    this.spin.y += (this.target.y + Math.sin(time * 0.5) * 0.055 - this.spin.y) * 0.075;

    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.07;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.07;
    this.hover += (this.targetHover - this.hover) * 0.08;
    this.press += (this.targetPress - this.press) * 0.16;
    this.appear += (1 - this.appear) * 0.045;

    this.orbit += dt * (0.42 + this.charge * 2.1);
    this.charge = Math.max(0, this.charge - dt * 1.35);
    if (this.wave < 60) this.wave += dt;

    if (this._dirty) this.resize();

    const u = this.prog.u;
    gl.useProgram(this.prog.p);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uColor, this.color);
    gl.uniform1i(u.uShape, this.shape);
    gl.uniform2f(u.uSpin, this.spin.x, this.spin.y);
    gl.uniform2f(u.uPointer, this.pointer.x, this.pointer.y);
    gl.uniform1f(u.uHover, this.hover);
    gl.uniform1f(u.uPress, this.press);
    gl.uniform1f(u.uEnergy, this.energy);
    gl.uniform1i(u.uQuality, QUALITY_CODE[quality.level] ?? 2);
    gl.uniform1f(u.uAppear, Math.min(1, this.appear * 1.02));
    gl.uniform1f(u.uZoom, this.zoom || 1);
    gl.uniform1f(u.uOrbit, this.orbit);
    gl.uniform1f(u.uCharge, Math.min(1, this.charge));
    gl.uniform1f(u.uWave, this.wave);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stop();

    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointermove', this._onDrag);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    document.removeEventListener('visibilitychange', this._onVis);
    quality.removeEventListener('change', this._onQuality);
    this.host?.removeEventListener('pointerdown', this._onDown);
    this.host?.removeEventListener('pointerleave', this._onLeave);
    this._unwatch?.();
    this._unobserve?.();
    this.canvas.removeEventListener('webglcontextlost', this._onLost);

    if (this.gl) {
      glBudget.release(this);
      const lose = this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      this.gl = null;
    }

    /* Um canvas sem contexto não desenha nada, mas continua ocupando o
       espaço dele — e em alguns navegadores aparece como um retângulo
       claro. Tirá-lo de cena junto com o contexto fecha esse buraco de
       uma vez, mesmo que o nó ainda demore para sair do documento. */
    this.canvas.style.display = 'none';

    // Sem a marca, quem reaproveita o nó sabe que precisa montar de novo
    if (this.host?.dataset?.alive === 'gl') delete this.host.dataset.alive;
    active.delete(this);
  }
}

/* ---------------------------------------------------------------------
   Plano B em CSS

   Sem WebGL — ou com o orçamento de contextos esgotado — a página não
   pode ficar com um buraco no topo. Um sólido em CSS 3D mantém a ideia,
   inclusive reagindo ao ponteiro e à conclusão de um item.
   --------------------------------------------------------------------- */
const fallbacks = new Set();

function mountCssFallback(canvas, { color = '#2F6BFF' } = {}) {
  const host = canvas.closest('.env-hero') || canvas.parentElement;
  if (!host || host.querySelector('.hero3d-css')) return null;

  canvas.style.display = 'none';

  const stage = document.createElement('div');
  stage.className = 'hero3d-css';
  stage.style.setProperty('--piece-color', color);
  stage.setAttribute('aria-hidden', 'true');

  const solid = document.createElement('div');
  solid.className = 'hero3d-css__solid';
  for (let i = 0; i < 6; i++) solid.appendChild(document.createElement('i'));

  const rings = document.createElement('div');
  rings.className = 'hero3d-css__rings';
  for (let i = 0; i < 3; i++) rings.appendChild(document.createElement('i'));

  stage.append(rings, solid);
  host.appendChild(stage);
  fallbacks.add(stage);

  if (!device.reducedMotion) {
    const move = (ev) => {
      const r = host.getBoundingClientRect();
      const nx = (ev.clientX - r.left) / Math.max(1, r.width) - 0.5;
      const ny = (ev.clientY - r.top) / Math.max(1, r.height) - 0.5;
      stage.style.setProperty('--rx', (-ny * 26) + 'deg');
      stage.style.setProperty('--ry', (nx * 40) + 'deg');
    };
    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerleave', () => {
      stage.style.setProperty('--rx', '0deg');
      stage.style.setProperty('--ry', '0deg');
    }, { passive: true });
  }

  return stage;
}

/* ---------------------------------------------------------------------
   Registro das peças vivas — trocar de tela não pode vazar contexto
   --------------------------------------------------------------------- */
const active = new Set();

export function mountEnvHero(canvas, options) {
  const host = canvas.closest('.env-hero');
  const hero = new EnvHero(canvas, options);

  if (hero.init()) {
    active.add(hero);
    // Marca de "esta peça está viva", lida por quem reaproveita o nó
    if (host) host.dataset.alive = 'gl';
    return hero;
  }

  mountCssFallback(canvas, options);
  if (host) host.dataset.alive = 'css';
  return null;
}

/**
 * A peça do ambiente reage a uma conclusão.
 *
 * Quem marca um item como concluído não precisa saber se a peça é WebGL
 * ou o plano B em CSS: chama daqui e cada uma responde do jeito dela.
 */
export function pulseEnvHeroes(strength = 1) {
  active.forEach((hero) => hero.celebrate(strength));

  fallbacks.forEach((stage) => {
    if (!stage.isConnected) { fallbacks.delete(stage); return; }
    stage.dataset.charged = 'true';
    clearTimeout(stage.__chargeTimer);
    stage.__chargeTimer = setTimeout(() => delete stage.dataset.charged, 760);
  });
}

export function clearEnvHeroes() {
  active.forEach((hero) => hero.destroy());
  active.clear();
  fallbacks.forEach((stage) => { if (!stage.isConnected) fallbacks.delete(stage); });
}
