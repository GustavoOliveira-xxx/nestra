/* =====================================================================
   NESTRA — Camada de interação

   Tudo o que dá resposta física à interface: o clique que abre uma onda,
   o botão que mostra que está trabalhando, a tela que troca com
   profundidade em vez de piscar.
   ===================================================================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reduced = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  (document.documentElement.dataset.motion !== 'full' &&
   window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* =====================================================================
   1. CLIQUE GLOBAL
   Um anel que abre, faíscas que saem e a cena 3D respondendo no mesmo
   ponto. Vale para a interface inteira, não só para os botões.
   ===================================================================== */

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

    // A cena de fundo sente o clique em qualquer lugar da página
    window.nestraScene?.ripple(
      x / window.innerWidth,
      y / window.innerHeight,
      ev.target.closest('.btn, .item, .env-card, .side-link') ? 1 : 0.55,
    );

    if (reduced()) return;

    const strong = Boolean(ev.target.closest('.btn, .env-card, .item, .side-link, .chip'));
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim() || '#2F6BFF';

    // anel que abre
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

    // clarão curto no ponto
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

    // faíscas
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

/* =====================================================================
   2. CARREGAMENTO NOS BOTÕES
   ===================================================================== */

/**
 * Mostra que o botão está trabalhando enquanto `fn` roda.
 * O tempo mínimo existe para a resposta ser percebida mesmo quando a
 * ação é instantânea — sem isso o estado pisca e ninguém vê.
 */
export async function withLoading(btn, fn, { minMs = 300, mode = 'true' } = {}) {
  if (!btn || btn.dataset.loading) return;

  const t0 = performance.now();
  // 'true' bloqueia novos cliques (operação de verdade em andamento);
  // 'auto' é só o retorno visual de uma ação que já foi executada.
  btn.dataset.loading = mode;
  btn.setAttribute('aria-busy', 'true');

  const spin = document.createElement('span');
  spin.className = 'btn__spin';
  btn.appendChild(spin);

  try {
    return await fn();
  } finally {
    const elapsed = performance.now() - t0;
    if (elapsed < minMs) await sleep(minMs - elapsed);
    delete btn.dataset.loading;
    btn.removeAttribute('aria-busy');
    spin.remove();
  }
}

/**
 * Liga o carregamento automático em toda a interface.
 *
 * Qualquer botão clicado mostra o estado por um instante — inclusive as
 * ações locais, como criar um lembrete ou trocar de ambiente, que
 * respondem rápido demais para dar retorno sozinhas. Um `data-noload`
 * dispensa o efeito onde ele atrapalharia (a caixa de conclusão, por
 * exemplo, que precisa ser imediata).
 */
export function bindAutoLoading(root = document) {
  // Escuta no `click`, e não no `pointerdown`: se o estado entrasse antes,
  // o próprio clique seria bloqueado e a ação nunca aconteceria.
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.btn, .side-link, .settings-nav__tab, .segmented__opt, .chip--interactive');
    if (!btn) return;
    if (btn.hasAttribute('data-noload') || btn.dataset.loading) return;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;

    withLoading(btn, async () => {
      // Espera a interface se redesenhar antes de tirar o indicador
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, { minMs: 300, mode: 'auto' });
  }, { passive: true });
}

/* =====================================================================
   3. TROCA DE TELAS
   ===================================================================== */

/**
 * Substitui o conteúdo de um container com profundidade: o que sai recua
 * e desfoca, o que entra sobe em escada. Nada de corte seco.
 */
export async function swapView(container, render, options = {}) {
  const { direction = 'forward' } = options;

  if (reduced() || !container.children.length) {
    container.replaceChildren();
    render(container);
    return;
  }

  const sign = direction === 'back' ? -1 : 1;

  // saída
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

  container.replaceChildren();
  render(container);

  // (removido) a varredura de luz no topo causava um artefato visual
  // ao trocar de tela; a entrada em escada abaixo já dá o movimento.

  // entrada, em escada
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

/** Lâmina de luz que atravessa o container uma vez. */
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

/* =====================================================================
   4. TROCA DE TELA INTEIRA (landing → acesso → aplicação)
   ===================================================================== */

/**
 * A marca girando, do tamanho de um botão.
 *
 * É a mesma linguagem da abertura: anéis em órbita e a marca respirando
 * no meio. Serve para qualquer espera que valha ser mostrada.
 */
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

export function screenTransition() {
  if (reduced()) return () => {};

  const veil = document.createElement('div');
  veil.className = 'fx-veil';
  veil.setAttribute('aria-hidden', 'true');

  // A cortina não fica muda: a marca aparece girando enquanto a próxima
  // tela é montada por baixo.
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

/* =====================================================================
   5. RASTRO DO CURSOR
   Um ponto que persegue o ponteiro e cresce sobre o que é clicável.
   ===================================================================== */

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

/* =====================================================================
   6. NÚMERO QUE PULSA AO MUDAR
   ===================================================================== */

export function bumpBadge(node) {
  if (!node || reduced()) return;
  node.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(1.32)', offset: 0.4 },
    { transform: 'scale(1)' },
  ], { duration: 460, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}

/* =====================================================================
   7. CONFETE DE CONCLUSÃO
   Quando a tela Hoje fica vazia porque tudo foi concluído.
   ===================================================================== */

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
