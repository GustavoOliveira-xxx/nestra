const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reduced = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  (document.documentElement.dataset.motion !== 'full' &&
   window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export function bindGlobalClick() {
  let layer = document.querySelector('.fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }

  document.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;

    const x = ev.clientX;
    const y = ev.clientY;

    window.nestraScene?.ripple(
      x / window.innerWidth,
      y / window.innerHeight,
      ev.target.closest('.btn, .item, .env-card, .side-link') ? 1 : 0.55,
    );

    if (reduced()) return;

    const strong = Boolean(ev.target.closest('.btn, .env-card, .item, .side-link, .chip'));
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim() || '#2F6BFF';

    const ring = document.createElement('span');
    ring.className = 'fx-ring';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    ring.style.borderColor = accent;
    layer.appendChild(ring);
    ring.animate([
      { transform: 'translate(-50%,-50%) scale(0.2)', opacity: 0.9, borderWidth: '2px' },
      { transform: `translate(-50%,-50%) scale(${strong ? 3.4 : 2.2})`, opacity: 0, borderWidth: '0.5px' },
    ], { duration: strong ? 620 : 460, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
    setTimeout(() => ring.remove(), 700);

    const flash = document.createElement('span');
    flash.className = 'fx-flash';
    flash.style.left = x + 'px';
    flash.style.top = y + 'px';
    flash.style.background = `radial-gradient(circle, ${accent}, transparent 68%)`;
    layer.appendChild(flash);
    flash.animate([
      { transform: 'translate(-50%,-50%) scale(0.4)', opacity: 0.55 },
      { transform: 'translate(-50%,-50%) scale(1.8)', opacity: 0 },
    ], { duration: 420, easing: 'ease-out', fill: 'forwards' });
    setTimeout(() => flash.remove(), 460);

    if (!strong) return;

    const n = 7;
    for (let i = 0; i < n; i++) {
      const spark = document.createElement('i');
      spark.className = 'fx-spark';
      spark.style.left = x + 'px';
      spark.style.top = y + 'px';
      spark.style.background = accent;
      layer.appendChild(spark);

      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.6;
      const dist = 22 + Math.random() * 40;
      spark.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0)`,
          opacity: 0,
        },
      ], { duration: 380 + Math.random() * 260, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
      setTimeout(() => spark.remove(), 700);
    }
  }, { passive: true });
}

function shapeLoader(el) {
  const r = el.getBoundingClientRect();
  const short = Math.min(r.width, r.height) || 32;
  const long = Math.max(r.width, r.height) || 32;

  const size = Math.max(11, Math.min(Math.round(short * 0.42), 34));
  const thickness = Math.max(1.5, Math.min(size / 7, 3.5));

  const banner = long / short > 2.6 && short < 96;

  const rail = r.width >= 72;

  return { size, thickness, banner, rail, area: r.width * r.height };
}

export async function withLoading(btn, fn, { minMs = 300, mode = 'true' } = {}) {
  if (!btn || btn.dataset.loading) return;

  const t0 = performance.now();
  btn.dataset.loading = mode;
  btn.setAttribute('aria-busy', 'true');

  const shape = shapeLoader(btn);

  const spin = document.createElement('span');
  spin.className = 'btn__spin';
  spin.style.setProperty('--spin-size', shape.size + 'px');
  spin.style.setProperty('--spin-thickness', shape.thickness + 'px');
  if (shape.banner) spin.dataset.place = 'end';
  btn.appendChild(spin);

  let rail = null;
  if (shape.rail) {
    rail = document.createElement('span');
    rail.className = 'btn__rail';
    btn.appendChild(rail);
  }

  try {
    return await fn();
  } finally {
    const elapsed = performance.now() - t0;
    if (elapsed < minMs) await sleep(minMs - elapsed);
    delete btn.dataset.loading;
    btn.removeAttribute('aria-busy');
    spin.remove();
    rail?.remove();
  }
}

const LOADABLE = [
  '.btn', '.side-link', '.settings-nav__tab', '.segmented__opt',
  '.chip--interactive', '.chip', '.item', '.env-card', '.avatar',
  '.menu__item', '.palette__row', '.color-dot', '.icon-opt',
  '.topbar__link', '.logo-drop', 'a[href]', '[role="button"]',
].join(', ');

export function bindAutoLoading(root = document) {
  root.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-noload], .check')) return;

    const btn = ev.target.closest(LOADABLE);
    if (!btn) return;
    if (btn.dataset.loading) return;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;

    if (btn.tagName === 'A' && btn.target === '_blank') return;

    const { area } = shapeLoader(btn);
    const minMs = Math.round(280 + Math.min(180, Math.sqrt(area) * 1.6));

    withLoading(btn, async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, { minMs, mode: 'auto' });
  }, { passive: true });
}

export async function swapView(container, render, options = {}) {
  const { direction = 'forward', onSwap = null } = options;

  if (reduced() || !container.children.length) {
    onSwap?.();
    container.replaceChildren();
    render(container);
    return;
  }

  const sign = direction === 'back' ? -1 : 1;

  const outgoing = Array.from(container.children);
  const outAnim = outgoing.map((node, i) =>
    node.animate([
      { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' },
      {
        opacity: 0,
        transform: `translate3d(${sign * -18}px, -8px, 0) scale(0.982)`,
        filter: 'blur(5px)',
      },
    ], {
      duration: 190,
      delay: Math.min(i * 12, 60),
      easing: 'cubic-bezier(.65,0,.35,1)',
      fill: 'forwards',
    }),
  );

  await Promise.all(outAnim.map((a) => a.finished.catch(() => {})));

  onSwap?.();

  container.replaceChildren();

  outAnim.forEach((a) => { try { a.cancel(); } catch {  } });

  render(container);

  const incoming = Array.from(container.children);
  incoming.forEach((node, i) => {
    node.animate([
      {
        opacity: 0,
        transform: `translate3d(${sign * 22}px, 20px, -40px) scale(0.975)`,
        filter: 'blur(6px)',
      },
      { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px)' },
    ], {
      duration: 520,
      delay: Math.min(i * 55, 380),
      easing: 'cubic-bezier(.16,1,.3,1)',
      fill: 'backwards',
    });
  });
}

export function sweep(container) {
  if (reduced()) return;
  const bar = document.createElement('span');
  bar.className = 'fx-sweep';
  container.style.position = container.style.position || 'relative';
  container.appendChild(bar);
  bar.animate([
    { transform: 'translateY(-40px) scaleY(0.4)', opacity: 0 },
    { transform: 'translateY(30vh) scaleY(1)', opacity: 0.85, offset: 0.3 },
    { transform: 'translateY(110vh) scaleY(0.5)', opacity: 0 },
  ], { duration: 900, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  setTimeout(() => bar.remove(), 950);
}

export function brandLoader(label) {
  const box = document.createElement('div');
  box.className = 'brand-loader';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-label', label || 'Carregando');

  const ringA = document.createElement('span');
  ringA.className = 'brand-loader__ring';
  const ringB = document.createElement('span');
  ringB.className = 'brand-loader__ring';

  const mark = document.createElement('img');
  mark.className = 'brand-loader__mark';
  mark.src = window.nestraLogoSrc || 'assets/logo/nestra-mark.png';
  mark.alt = '';

  box.append(ringA, ringB, mark);

  if (label) {
    const caption = document.createElement('span');
    caption.className = 'brand-loader__label';
    caption.textContent = label;
    box.appendChild(caption);
  }

  return box;
}

function bootPiece({ label = 'montando a tela' } = {}) {
  const stage = document.createElement('div');
  stage.className = 'boot-piece';

  stage.innerHTML = `
    <div class="boot-piece__logo">
      <div class="boot__orbit" aria-hidden="true"><span></span><span></span><span></span></div>
      <svg class="boot__arc" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="boot__arc-track" cx="60" cy="60" r="56"/>
        <circle class="boot__arc-fill" cx="60" cy="60" r="56"/>
      </svg>
      <img class="boot-piece__mark" alt="" aria-hidden="true">
    </div>
    <div class="boot__wordmark" aria-hidden="true">
      <span>N</span><span>E</span><span>S</span><span>T</span><span>R</span><span>A</span>
    </div>
    <div class="boot-piece__meter" aria-hidden="true"></div>
    <div class="boot-piece__task">${label}</div>
  `;

  stage.querySelector('.boot-piece__mark').src =
    window.nestraLogoSrc || 'assets/logo/nestra-mark.png';

  const meter = stage.querySelector('.boot-piece__meter');
  for (let i = 0; i < 24; i++) {
    const seg = document.createElement('span');
    seg.className = 'boot__seg';
    seg.style.setProperty('--i', String(i));
    meter.appendChild(seg);
  }

  const arc = stage.querySelector('.boot__arc-fill');
  const total = 2 * Math.PI * 56;
  arc.style.strokeDasharray = String(total);
  arc.style.strokeDashoffset = String(total);
  requestAnimationFrame(() => {
    arc.style.transition = 'stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)';
    arc.style.strokeDashoffset = String(total * 0.08);
  });

  return stage;
}

export function viewLoading(host, { minMs = 620 } = {}) {
  if (reduced() || !host) return async () => {};

  const t0 = performance.now();

  host.querySelectorAll(':scope > .view-loading').forEach((old) => old.remove());

  const veil = document.createElement('div');
  veil.className = 'view-loading';
  veil.setAttribute('aria-hidden', 'true');
  veil.appendChild(bootPiece());
  host.appendChild(veil);

  veil.animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: 140, easing: 'ease-out', fill: 'forwards' });

  const failsafe = setTimeout(() => veil.remove(), 6000);

  return async () => {
    const elapsed = performance.now() - t0;
    if (elapsed < minMs) await sleep(minMs - elapsed);

    clearTimeout(failsafe);
    const out = veil.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 260, easing: 'ease-out', fill: 'forwards' });
    out.finished.then(() => veil.remove()).catch(() => veil.remove());
  };
}

export function screenTransition() {
  if (reduced()) return () => {};

  const veil = document.createElement('div');
  veil.className = 'fx-veil';
  veil.setAttribute('aria-hidden', 'true');

  const loader = brandLoader();
  loader.classList.add('fx-veil__loader');
  veil.appendChild(loader);

  document.body.appendChild(veil);

  veil.animate([
    { clipPath: 'inset(0 0 100% 0)', opacity: 1 },
    { clipPath: 'inset(0 0 0 0)', opacity: 1 },
  ], { duration: 260, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });

  loader.animate([
    { opacity: 0, transform: 'scale(.82)' },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: 220, delay: 120, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });

  return () => {
    const out = veil.animate([
      { clipPath: 'inset(0 0 0 0)', opacity: 1 },
      { clipPath: 'inset(100% 0 0 0)', opacity: 1 },
    ], { duration: 380, delay: 60, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
    out.finished.then(() => veil.remove()).catch(() => veil.remove());
  };
}

export function bindCursorTrail() {
  if (window.matchMedia('(hover: none)').matches || reduced()) return;

  const dot = document.createElement('div');
  dot.className = 'fx-cursor';
  dot.setAttribute('aria-hidden', 'true');
  document.body.appendChild(dot);

  let x = innerWidth / 2, y = innerHeight / 2;
  let tx = x, ty = y;
  let scale = 1, tScale = 1;

  window.addEventListener('pointermove', (ev) => {
    tx = ev.clientX;
    ty = ev.clientY;
    dot.dataset.active = 'true';
    const over = ev.target.closest('button, a, .item, .env-card, input, textarea, select, [role="button"]');
    tScale = over ? 2.1 : 1;
    dot.dataset.over = String(Boolean(over));
  }, { passive: true });

  window.addEventListener('pointerleave', () => { dot.dataset.active = 'false'; });

  const loop = () => {
    x += (tx - x) * 0.19;
    y += (ty - y) * 0.19;
    scale += (tScale - scale) * 0.14;
    dot.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${scale})`;
    requestAnimationFrame(loop);
  };
  loop();
}

export function bumpBadge(node) {
  if (!node || reduced()) return;
  node.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(1.32)', offset: 0.4 },
    { transform: 'scale(1)' },
  ], { duration: 460, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}

export function celebrate() {
  if (reduced()) return;

  const layer = document.querySelector('.fx-layer') || document.body;
  const colors = ['#2F6BFF', '#4FD8FF', '#9B7BFF', '#3ED9A4', '#FFC96B'];

  for (let i = 0; i < 26; i++) {
    const bit = document.createElement('i');
    bit.className = 'fx-confetti';
    bit.style.left = (30 + Math.random() * 40) + 'vw';
    bit.style.top = '22vh';
    bit.style.background = colors[Math.floor(Math.random() * colors.length)];
    layer.appendChild(bit);

    const dx = (Math.random() - 0.5) * 460;
    const dy = 240 + Math.random() * 320;
    const rot = (Math.random() - 0.5) * 900;

    bit.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 },
    ], {
      duration: 1400 + Math.random() * 900,
      easing: 'cubic-bezier(.2,.6,.35,1)',
      fill: 'forwards',
    });
    setTimeout(() => bit.remove(), 2400);
  }
}
