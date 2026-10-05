const mq = (q) => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia(q)
  : { matches: false, addEventListener() {} });

const coarse = mq('(hover: none), (pointer: coarse)');
const small = mq('(max-width: 820px)');

function detectTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || (coarse.matches ? 4 : 8);
  const pixels = (window.screen?.width || 1280) * (window.screen?.height || 800)
    * Math.min(window.devicePixelRatio || 1, 3);

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
  get touch() { return coarse.matches; },

  get compact() { return small.matches; },

  get mobile() { return coarse.matches && small.matches; },

  tier: 'high',

  get baseDprCap() {
    if (this.tier === 'low') return 1;
    if (this.tier === 'medium') return 1.35;
    return this.mobile ? 1.6 : 2;
  },

  get reducedMotion() {
    const declared = document.documentElement.dataset.motion;
    if (declared === 'reduced') return true;
    if (declared === 'full') return false;
    return mq('(prefers-reduced-motion: reduce)').matches;
  },

  get saveData() {
    return Boolean(navigator.connection?.saveData);
  },
};

device.tier = detectTier();

const LEVELS = ['low', 'medium', 'high'];

class Quality extends EventTarget {
  constructor() {
    super();
    const start = device.saveData ? 'low' : device.tier;
    this.level = start;
    this.ceiling = start;
    this._frames = 0;
    this._acc = 0;
    this._slow = 0;
    this._fast = 0;
    this._last = 0;
    this._watching = false;
    this._apply();
  }

  get index() { return LEVELS.indexOf(this.level); }

  get dprCap() {
    const base = device.baseDprCap;
    if (this.level === 'low') return Math.min(base, 1);
    if (this.level === 'medium') return Math.min(base, 1.35);
    return base;
  }

  get scale() {
    return this.level === 'low' ? 0.45 : this.level === 'medium' ? 0.72 : 1;
  }

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

      if (this._slow >= 2 && this.index > 0) {
        this._slow = 0;
        this._set(LEVELS[this.index - 1]);
        return;
      }

      if (this._fast >= 12 && this.index < LEVELS.indexOf(this.ceiling)) {
        this._fast = 0;
        this._set(LEVELS[this.index + 1]);
      }
    };

    requestAnimationFrame(tick);
  }
}

export const quality = new Quality();

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

export function onResize(element, callback) {
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', callback, { passive: true });
    return () => window.removeEventListener('resize', callback);
  }
  const ro = new ResizeObserver(callback);
  ro.observe(element);
  return () => ro.disconnect();
}

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

class ContextBudget {
  constructor() {
    this.taken = new Set();
    this.extra = 0;
  }

  get limit() {
    const base = device.mobile
      ? (quality.level === 'low' ? 2 : 3)
      : (quality.level === 'low' ? 3 : 8);
    return base + this.extra;
  }

  lend() {
    this.extra++;
    let returned = false;
    return () => {
      if (returned) return;
      returned = true;
      this.extra = Math.max(0, this.extra - 1);
    };
  }

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
