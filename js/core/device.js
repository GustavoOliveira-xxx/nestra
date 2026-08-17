/* =====================================================================
   NESTRA — Perfil do aparelho e governo de qualidade

   O site tem bastante decoração em 3D. Num computador isso é barato; num
   celular de entrada, não. Em vez de desligar tudo no celular — o pedido
   foi justamente que a decoração continue rodando — aqui existe um
   perfil por aparelho e um vigia de quadros por segundo.

   O vigia observa o tempo real de cada quadro. Se a taxa cai, a
   qualidade desce um degrau (menos pixels, menos peças, menos passos de
   ray marching) e a animação continua fluida. Se a taxa se mantém alta
   por bastante tempo, ele devolve um degrau. Nada some da tela: só muda
   a resolução do que é desenhado.
   ===================================================================== */

const mq = (q) => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia(q)
  : { matches: false, addEventListener() {} });

const coarse = mq('(hover: none), (pointer: coarse)');
const small = mq('(max-width: 820px)');

/* ---------------------------------------------------------------------
   Perfil estático — o que dá para saber sem medir nada
   --------------------------------------------------------------------- */
function detectTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || (coarse.matches ? 4 : 8);
  const pixels = (window.screen?.width || 1280) * (window.screen?.height || 800)
    * Math.min(window.devicePixelRatio || 1, 3);

  // Muitos pixels com pouco núcleo é a combinação que trava celular.
  let score = 0;
  score += cores >= 8 ? 2 : cores >= 6 ? 1.5 : cores >= 4 ? 1 : 0;
  score += memory >= 8 ? 2 : memory >= 4 ? 1 : 0;
  score += pixels > 4.5e6 ? -1 : 0;
  score += coarse.matches ? -0.5 : 0.5;

  if (score >= 3) return 'high';
  if (score >= 1.5) return 'medium';
  return 'low';
}

export const device = {
  /** Aparelho sem cursor: celular, tablet, quiosque. */
  get touch() { return coarse.matches; },

  /** Tela pequena o bastante para a interface trocar de forma. */
  get compact() { return small.matches; },

  /** Celular de verdade: sem cursor E tela pequena. */
  get mobile() { return coarse.matches && small.matches; },

  /** 'high' | 'medium' | 'low' — perfil inicial, antes de medir. */
  tier: 'high',

  /** Reduz o custo do 3D em telas com muitos pixels e pouco fôlego. */
  get baseDprCap() {
    if (this.tier === 'low') return 1;
    if (this.tier === 'medium') return 1.35;
    return this.mobile ? 1.6 : 2;
  },

  /** A pessoa (ou o sistema) pediu menos movimento. */
  get reducedMotion() {
    const declared = document.documentElement.dataset.motion;
    if (declared === 'reduced') return true;
    if (declared === 'full') return false;
    return mq('(prefers-reduced-motion: reduce)').matches;
  },

  /** Economia de bateria/dados ligada no navegador. */
  get saveData() {
    return Boolean(navigator.connection?.saveData);
  },
};

device.tier = detectTier();

/* ---------------------------------------------------------------------
   Governo de qualidade — mede e ajusta enquanto o site roda
   --------------------------------------------------------------------- */

const LEVELS = ['low', 'medium', 'high'];

class Quality extends EventTarget {
  constructor() {
    super();
    const start = device.saveData ? 'low' : device.tier;
    this.level = start;
    this.ceiling = start;            // teto: nunca sobe acima do perfil do aparelho
    this._frames = 0;
    this._acc = 0;
    this._slow = 0;
    this._fast = 0;
    this._last = 0;
    this._watching = false;
    this._apply();
  }

  get index() { return LEVELS.indexOf(this.level); }

  /** Multiplicador de resolução: quantos pixels reais por pixel de CSS. */
  get dprCap() {
    const base = device.baseDprCap;
    if (this.level === 'low') return Math.min(base, 1);
    if (this.level === 'medium') return Math.min(base, 1.35);
    return base;
  }

  /** Escala genérica de quantidade (peças, partículas, passos). */
  get scale() {
    return this.level === 'low' ? 0.45 : this.level === 'medium' ? 0.72 : 1;
  }

  /** Efeitos caros que só ficam de pé quando sobra fôlego. */
  get heavy() { return this.level === 'high'; }

  _apply() {
    document.documentElement.dataset.gfx = this.level;
  }

  _set(level) {
    if (level === this.level) return;
    this.level = level;
    this._apply();
    this.dispatchEvent(new CustomEvent('change', { detail: level }));
  }

  /**
   * O vigia roda um único requestAnimationFrame para o site inteiro —
   * as cenas não precisam medir nada por conta própria.
   */
  watch() {
    if (this._watching || device.reducedMotion) return;
    this._watching = true;

    const tick = (now) => {
      if (!this._watching) return;
      requestAnimationFrame(tick);

      if (document.hidden) { this._last = 0; return; }
      if (!this._last) { this._last = now; return; }

      const dt = now - this._last;
      this._last = now;

      // Quadros absurdos (aba voltando, janela arrastada) não contam
      if (dt > 500) return;

      this._acc += dt;
      this._frames++;
      if (this._acc < 1000) return;

      const fps = (this._frames * 1000) / this._acc;
      this._acc = 0;
      this._frames = 0;

      if (fps < 42) {
        this._slow++;
        this._fast = 0;
      } else if (fps > 56) {
        this._fast++;
        this._slow = 0;
      } else {
        this._slow = Math.max(0, this._slow - 1);
      }

      // Dois segundos ruins seguidos: desce um degrau na hora.
      if (this._slow >= 2 && this.index > 0) {
        this._slow = 0;
        this._set(LEVELS[this.index - 1]);
        return;
      }

      // Doze segundos folgados: devolve um degrau, sem passar do teto.
      if (this._fast >= 12 && this.index < LEVELS.indexOf(this.ceiling)) {
        this._fast = 0;
        this._set(LEVELS[this.index + 1]);
      }
    };

    requestAnimationFrame(tick);
  }
}

export const quality = new Quality();

/* ---------------------------------------------------------------------
   Ajudantes usados pelas cenas
   --------------------------------------------------------------------- */

/** Tamanho do canvas em pixels reais, já com o teto de resolução. */
export function sizeCanvas(canvas, { width, height, cap } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, cap ?? quality.dprCap);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round((width ?? rect.width ?? 1) * dpr));
  const h = Math.max(1, Math.round((height ?? rect.height ?? 1) * dpr));

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return { w, h, dpr, changed: true };
  }
  return { w, h, dpr, changed: false };
}

/**
 * Avisa quando o elemento muda de tamanho.
 *
 * Medir o canvas dentro do laço de desenho parece inofensivo, mas
 * `getBoundingClientRect()` obriga o navegador a recalcular o layout —
 * a cada quadro, para cada peça. Com meia dúzia de peças na tela é o
 * bastante para a rolagem começar a engasgar no celular. Aqui a medida
 * só acontece quando o tamanho realmente muda.
 */
export function onResize(element, callback) {
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', callback, { passive: true });
    return () => window.removeEventListener('resize', callback);
  }
  const ro = new ResizeObserver(callback);
  ro.observe(element);
  return () => ro.disconnect();
}

/**
 * Só desenha o que está à vista.
 *
 * Num celular, três peças 3D fora da tela custam o mesmo que três na
 * tela — e é isso que faz a rolagem engasgar. Devolve uma função que
 * desfaz a observação.
 */
export function renderWhenVisible(element, { onEnter, onLeave }) {
  if (!('IntersectionObserver' in window)) {
    onEnter?.();
    return () => {};
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => (entry.isIntersecting ? onEnter?.() : onLeave?.()));
  }, { rootMargin: '120px' });

  io.observe(element);
  return () => io.disconnect();
}

/**
 * Contextos WebGL são um recurso escasso: o navegador começa a descartar
 * os mais antigos depois de um punhado deles, e no celular esse punhado é
 * bem menor. Quem quiser um contexto pede aqui.
 */
class ContextBudget {
  constructor() {
    this.taken = new Set();
  }

  get limit() {
    if (device.mobile) return quality.level === 'low' ? 2 : 3;
    return quality.level === 'low' ? 3 : 8;
  }

  /** @returns {boolean} verdadeiro se couber mais um. */
  claim(owner) {
    if (this.taken.size >= this.limit) return false;
    this.taken.add(owner);
    return true;
  }

  release(owner) {
    this.taken.delete(owner);
  }

  get used() { return this.taken.size; }
}

export const glBudget = new ContextBudget();
