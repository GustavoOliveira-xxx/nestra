/* =====================================================================
   NESTRA — Efeitos de interface
   Inclinação 3D, botões magnéticos, ondulação, revelação ao rolar e
   contadores animados. Tudo respeita a preferência de movimento (§22).
   ===================================================================== */

const reduced = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  (document.documentElement.dataset.motion !== 'full' &&
   window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ---------------------------------------------------------------------
   Inclinação 3D dos cartões, acompanhando o ponteiro
   --------------------------------------------------------------------- */
export function bindTilt(root = document, selector = '[data-tilt]') {
  root.querySelectorAll(selector).forEach((el) => {
    if (el.__tilt) return;
    el.__tilt = true;

    const max = parseFloat(el.dataset.tilt) || 9;
    let raf = 0;

    const move = (ev) => {
      if (reduced()) return;
      const r = el.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width;
      const py = (ev.clientY - r.top) / r.height;

      el.style.setProperty('--px', (px * 100) + '%');
      el.style.setProperty('--py', (py * 100) + '%');

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform =
          `perspective(900px) rotateX(${(0.5 - py) * max}deg) ` +
          `rotateY(${(px - 0.5) * max}deg) translateZ(6px)`;
      });
    };

    const leave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = '';
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
  });
}

/* ---------------------------------------------------------------------
   Botões magnéticos: o alvo se aproxima levemente do ponteiro
   --------------------------------------------------------------------- */
export function bindMagnetic(root = document, selector = '[data-magnetic]') {
  root.querySelectorAll(selector).forEach((el) => {
    if (el.__mag) return;
    el.__mag = true;

    const strength = parseFloat(el.dataset.magnetic) || 0.28;

    el.addEventListener('pointermove', (ev) => {
      if (reduced()) return;
      const r = el.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width / 2);
      const dy = ev.clientY - (r.top + r.height / 2);
      el.style.setProperty('--mx', (dx * strength) + 'px');
      el.style.setProperty('--my', (dy * strength) + 'px');
    });

    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--mx', '0px');
      el.style.setProperty('--my', '0px');
    });
  });
}

/* ---------------------------------------------------------------------
   Ondulação no clique
   --------------------------------------------------------------------- */
export function bindRipple(root = document) {
  root.addEventListener('pointerdown', (ev) => {
    const btn = ev.target.closest('.btn, .side-link, .menu__item');
    if (!btn || reduced()) return;

    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.1;
    const ink = document.createElement('span');
    ink.className = 'ripple';
    ink.style.width = ink.style.height = size + 'px';
    ink.style.left = (ev.clientX - r.left - size / 2) + 'px';
    ink.style.top = (ev.clientY - r.top - size / 2) + 'px';
    btn.appendChild(ink);
    setTimeout(() => ink.remove(), 640);
  });
}

/* ---------------------------------------------------------------------
   Brilho que acompanha o cursor na página de entrada
   --------------------------------------------------------------------- */
export function bindCursorGlow() {
  if (window.matchMedia('(hover: none)').matches) return;

  const glow = document.createElement('div');
  glow.className = 'cursor-glow';
  document.body.appendChild(glow);

  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let tx = x, ty = y;

  window.addEventListener('pointermove', (ev) => {
    tx = ev.clientX;
    ty = ev.clientY;
    glow.dataset.active = 'true';
  }, { passive: true });

  const loop = () => {
    x += (tx - x) * 0.12;
    y += (ty - y) * 0.12;
    glow.style.transform = `translate(${x}px, ${y}px)`;
    requestAnimationFrame(loop);
  };
  if (!reduced()) loop();
}

/* ---------------------------------------------------------------------
   Revelação progressiva no rolar
   --------------------------------------------------------------------- */
export function bindReveal(root = document) {
  const targets = root.querySelectorAll('[data-reveal]:not([data-reveal="in"])');
  if (!targets.length) return;

  if (reduced() || !('IntersectionObserver' in window)) {
    targets.forEach((el) => (el.dataset.reveal = 'in'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const delay = parseFloat(el.dataset.revealDelay || '0');
      setTimeout(() => (el.dataset.reveal = 'in'), delay * 1000);
      io.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  targets.forEach((el) => io.observe(el));
}

/* ---------------------------------------------------------------------
   Contadores que sobem até o valor final
   --------------------------------------------------------------------- */
export function countUp(el, to, duration = 1100) {
  const from = parseFloat(el.dataset.from || '0');
  if (reduced()) {
    el.textContent = String(to);
    return;
  }

  el.dataset.counting = 'true';
  const t0 = performance.now();

  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      delete el.dataset.counting;
    }
  };
  requestAnimationFrame(step);
}

export function bindCounters(root = document) {
  const els = root.querySelectorAll('[data-count]:not([data-counted])');
  if (!els.length) return;

  const run = (el) => {
    el.dataset.counted = 'true';
    countUp(el, parseFloat(el.dataset.count));
  };

  if (!('IntersectionObserver' in window)) {
    els.forEach(run);
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        run(e.target);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.4 });

  els.forEach((el) => io.observe(el));
}

/* ---------------------------------------------------------------------
   Máquina de escrever, usada na demonstração da captura
   --------------------------------------------------------------------- */
export function typewriter(el, phrases, opts = {}) {
  const {
    typeSpeed = 46,
    eraseSpeed = 22,
    hold = 1900,
    onPhraseDone = null,
    onErase = null,
  } = opts;

  let i = 0;
  let stopped = false;

  const write = async () => {
    while (!stopped) {
      const phrase = phrases[i % phrases.length];

      for (let c = 1; c <= phrase.length; c++) {
        if (stopped) return;
        el.textContent = phrase.slice(0, c);
        await sleep(typeSpeed + Math.random() * 34);
      }

      if (onPhraseDone) onPhraseDone(phrase);
      await sleep(hold);
      if (stopped) return;
      if (onErase) onErase();

      for (let c = phrase.length; c >= 0; c--) {
        if (stopped) return;
        el.textContent = phrase.slice(0, c);
        await sleep(eraseSpeed);
      }

      i++;
      await sleep(280);
    }
  };

  if (!reduced()) {
    write();
  } else {
    el.textContent = phrases[0];
    if (onPhraseDone) onPhraseDone(phrases[0]);
  }

  return () => { stopped = true; };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------
   Partículas de conclusão: o item que sai da lista vira luz
   --------------------------------------------------------------------- */
export function burstAt(x, y, color = '#2F6BFF', count = 14) {
  if (reduced()) return;

  const host = document.createElement('div');
  host.style.cssText =
    `position:fixed;left:${x}px;top:${y}px;width:0;height:0;` +
    'pointer-events:none;z-index:95';
  document.body.appendChild(host);

  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 26 + Math.random() * 54;
    const size = 2 + Math.random() * 3;

    p.style.cssText =
      `position:absolute;width:${size}px;height:${size}px;background:${color};` +
      `box-shadow:0 0 8px ${color};opacity:1;transform:translate(0,0)`;
    host.appendChild(p);

    p.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      {
        transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0)`,
        opacity: 0,
      },
    ], {
      duration: 480 + Math.random() * 320,
      easing: 'cubic-bezier(.16,1,.3,1)',
      fill: 'forwards',
    });
  }

  setTimeout(() => host.remove(), 900);
}

/* ---------------------------------------------------------------------
   Liga tudo de uma vez
   --------------------------------------------------------------------- */
export function initFx(root = document) {
  bindTilt(root);
  bindMagnetic(root);
  bindReveal(root);
  bindCounters(root);
}
