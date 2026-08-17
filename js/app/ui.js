/* =====================================================================
   NESTRA — Utilitários de interface
   Ícones, avisos, modais e ajudantes de DOM.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Ícones — traço de 1.6, cantos retos, coerentes com a linguagem visual
   --------------------------------------------------------------------- */
const PATHS = {
  check:     '<polyline points="20 6 9 17 4 12"/>',
  plus:      '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  x:         '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  calendar:  '<rect x="3" y="4" width="18" height="17"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>',
  clock:     '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  layers:    '<polygon points="12 3 21 8 12 13 3 8"/><polyline points="21 13 12 18 3 13"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14"/><path d="M8 7V4h8v3"/><line x1="2" y1="12" x2="22" y2="12"/>',
  book:      '<path d="M4 3h13a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2z"/><line x1="9" y1="7" x2="15" y2="7"/>',
  heart:     '<path d="M12 20s-7-4.6-7-9.4A4 4 0 0 1 12 8a4 4 0 0 1 7-2.6C19 15.4 12 20 12 20z"/>',
  home:      '<path d="M3 10.5 12 3l9 7.5V21H3z"/><rect x="9.5" y="14" width="5" height="7"/>',
  wallet:    '<rect x="3" y="6" width="18" height="14"/><path d="M3 10h18"/><rect x="15" y="12" width="4" height="4"/>',
  star:      '<polygon points="12 3 14.8 9.2 21 10 16.5 14.6 17.8 21 12 17.8 6.2 21 7.5 14.6 3 10 9.2 9.2"/>',
  bulb:      '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
  bell:      '<path d="M18 15V10a6 6 0 1 0-12 0v5l-2 3h16z"/><path d="M10 21h4"/>',
  trash:     '<polyline points="3 6 21 6"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/>',
  edit:      '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  search:    '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
  settings:  '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  logout:    '<path d="M10 4H5v16h5"/><polyline points="16 8 20 12 16 16"/><line x1="20" y1="12" x2="9" y2="12"/>',
  chevron:   '<polyline points="9 6 15 12 9 18"/>',
  chevronD:  '<polyline points="6 9 12 15 18 9"/>',
  menu:      '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  inbox:     '<polyline points="21 13 15 13 14 16 10 16 9 13 3 13"/><path d="M4 4h16l1 9v7H3v-7z"/>',
  archive:   '<rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8"/><line x1="10" y1="12" x2="14" y2="12"/>',
  download:  '<path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><path d="M4 20h16"/>',
  alert:     '<path d="M12 4 2 20h20z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  flag:      '<path d="M5 21V4h13l-2.5 4L18 12H5"/>',
  sparkle:   '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  grid:      '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  list:      '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><rect x="3" y="5" width="2" height="2"/><rect x="3" y="11" width="2" height="2"/><rect x="3" y="17" width="2" height="2"/>',
  bolt:      '<polygon points="13 2 4 14 11 14 10 22 20 9 13 9"/>',
  moon:      '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>',
  shield:    '<path d="M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z"/>',
  user:      '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  clockBack: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/><polyline points="12 8 12 12 15 14"/>',
  target:    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  lock:      '<rect x="4" y="10" width="16" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  refresh:   '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><polyline points="20 3 20 8 15 8"/>',
  devices:   '<rect x="2" y="5" width="13" height="10"/><path d="M6 19h7"/><rect x="17" y="9" width="5" height="11"/>',
};

export function icon(name, size = 18, extra = '') {
  const body = PATHS[name] || PATHS.layers;
  // Traço arredondado nas pontas e nas junções: o desenho fica mais
  // limpo e menos duro do que com terminação reta.
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" ${extra}>${body}</svg>`;
}

export const ICON_CHOICES = [
  'layers', 'briefcase', 'book', 'heart', 'home', 'wallet',
  'star', 'bulb', 'target', 'bolt', 'shield', 'grid',
];

export const COLOR_CHOICES = [
  '#2F6BFF', '#4FD8FF', '#9B7BFF', '#3ED9A4',
  '#FFC96B', '#FFA23D', '#FF5F6B', '#8FB4FF',
];

/* ---------------------------------------------------------------------
   DOM
   --------------------------------------------------------------------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      // Object.assign não escreve custom properties: elas precisam de setProperty
      for (const [prop, value] of Object.entries(v)) {
        if (value == null) continue;
        if (prop.startsWith('--')) node.style.setProperty(prop, String(value));
        else node.style[prop] = value;
      }
    }
    else node.setAttribute(k, v === true ? '' : v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null || c === false) return;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return node;
}

/** Escapa texto do usuário antes de entrar em innerHTML. */
export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------------------
   Avisos flutuantes
   --------------------------------------------------------------------- */
let toastHost = null;

export function toast(message, options = {}) {
  const { kind = '', action = null, onAction = null, duration = 4200 } = options;

  if (!toastHost) {
    toastHost = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }

  const node = el('div', { class: 'toast' + (kind ? ' toast--' + kind : '') }, [
    el('span', { class: 'toast__msg', text: message }),
  ]);

  if (action && onAction) {
    node.appendChild(el('button', {
      class: 'toast__action',
      text: action,
      onClick: () => { onAction(); dismiss(); },
    }));
  }

  toastHost.appendChild(node);

  // Nunca mais de três avisos ao mesmo tempo: além disso vira ruído
  while (toastHost.children.length > 3) {
    toastHost.firstElementChild.remove();
  }

  let timer = setTimeout(dismiss, duration);
  node.addEventListener('pointerenter', () => clearTimeout(timer));
  node.addEventListener('pointerleave', () => { timer = setTimeout(dismiss, 1600); });

  function dismiss() {
    clearTimeout(timer);
    if (!node.isConnected) return;
    node.dataset.leaving = 'true';
    setTimeout(() => node.remove(), 300);
  }

  return dismiss;
}

/* ---------------------------------------------------------------------
   Modal genérico com foco preso e fechamento por Esc
   --------------------------------------------------------------------- */
export function openModal({ title, body, footer, wide = false, onClose = null }) {
  const overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const modal = el('div', { class: 'modal' + (wide ? ' modal--wide' : '') });

  const head = el('div', { class: 'modal__head' }, [
    el('h3', { class: 'modal__title', text: title }),
    el('button', {
      class: 'btn btn--ghost btn--icon btn--sm',
      'aria-label': 'Fechar',
      html: icon('x', 16),
      onClick: () => close(),
    }),
  ]);

  const bodyNode = el('div', { class: 'modal__body' });
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body) bodyNode.appendChild(body);

  modal.append(head, bodyNode);

  if (footer) {
    const foot = el('div', { class: 'modal__foot' });
    (Array.isArray(footer) ? footer : [footer]).forEach((f) => foot.appendChild(f));
    modal.appendChild(foot);
  }

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => (overlay.dataset.open = 'true'));

  const previouslyFocused = document.activeElement;
  const focusables = () => $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modal)
    .filter((n) => !n.disabled && n.offsetParent !== null);

  setTimeout(() => {
    const first = focusables().find((n) => !n.classList.contains('btn--icon')) || focusables()[0];
    first?.focus();
  }, 90);

  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  };

  overlay.addEventListener('keydown', onKey);
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) close();
  });

  function close() {
    overlay.dataset.open = 'false';
    document.body.style.overflow = '';
    setTimeout(() => overlay.remove(), 260);
    previouslyFocused?.focus?.();
    onClose?.();
  }

  return { overlay, modal, body: bodyNode, close };
}

/** Confirmação para ações destrutivas (§24). */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const cancel = el('button', { class: 'btn btn--ghost', text: 'Cancelar' });
    const ok = el('button', {
      class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'),
      text: confirmLabel,
    });

    const dialog = openModal({
      title,
      body: el('p', { class: 'text-body', text: message }),
      footer: [cancel, ok],
      onClose: () => done(false),
    });

    cancel.addEventListener('click', () => { done(false); dialog.close(); });
    ok.addEventListener('click', () => { done(true); dialog.close(); });
  });
}

/* ---------------------------------------------------------------------
   Menu suspenso ancorado a um botão
   --------------------------------------------------------------------- */
export function openMenu(anchor, entries) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());

  const menu = el('div', { class: 'menu', role: 'menu' });

  entries.forEach((entry) => {
    if (entry === '-') {
      menu.appendChild(el('div', { class: 'menu__sep' }));
      return;
    }
    const btn = el('button', {
      class: 'menu__item' + (entry.danger ? ' menu__item--danger' : ''),
      role: 'menuitem',
      onClick: () => { close(); entry.onSelect?.(); },
    }, [
      entry.icon ? el('span', { html: icon(entry.icon, 16) }) : null,
      el('span', { text: entry.label }),
      entry.key ? el('span', { class: 'menu__key', text: entry.key }) : null,
    ]);
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 10);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 10) top = Math.max(10, r.top - mh - 6);
  menu.style.left = Math.max(10, left) + 'px';
  menu.style.top = top + 'px';

  const off = (ev) => {
    if (!menu.contains(ev.target) && ev.target !== anchor) close();
  };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };

  setTimeout(() => {
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', onKey);
  }, 0);

  function close() {
    menu.remove();
    document.removeEventListener('pointerdown', off);
    document.removeEventListener('keydown', onKey);
  }

  return close;
}

/* ---------------------------------------------------------------------
   Download de arquivo gerado no cliente (exportação, §18)
   --------------------------------------------------------------------- */
export function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Iniciais para o avatar. */
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
