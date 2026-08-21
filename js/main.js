/* =====================================================================
   NESTRA — Ponto de entrada
   Sequência de abertura, tema, autenticação, navegação e atalhos.
   ===================================================================== */

import { store, SUGGESTED_ENVIRONMENTS } from './app/store.js';
import { api } from './app/api.js';
import { $, el, icon, toast, initials, openMenu, openModal } from './app/ui.js';
import { Logo3D, resolveLogoSource } from './gfx/logo3d.js';
import { Scene } from './gfx/scene.js';
import { initFx, bindRipple, bindCursorGlow, bindReveal, typewriter, bindTilt } from './gfx/fx.js';
import {
  bindGlobalClick, bindAutoLoading, bindCursorTrail,
  swapView, screenTransition, viewLoading, withLoading, celebrate,
} from './gfx/interactions.js';
import { clearOrbs } from './gfx/orb.js';
import { clearEnvHeroes } from './gfx/envhero.js';
import { device, quality } from './core/device.js';
import { renderToday, renderEnvironment, clearTodayBrand } from './app/views/today.js';
import { renderEnvironments, openEnvironmentForm } from './app/views/environments.js';
import { renderSettings, renderInbox } from './app/views/settings.js';
import { openItemDetail } from './app/views/items.js';
import { parse, humanDate, todayIn, toISODate, TYPE_LABELS } from './app/nlp.js';

const app = {
  route: { name: 'landing', param: null },
  logo: null,
  heroLogo: null,
  scene: null,
};

/* =====================================================================
   1. SEQUÊNCIA DE ABERTURA
   ===================================================================== */

const BOOT_STEPS = [
  'preparando as superfícies',
  'extrudando a marca',
  'acendendo o campo de profundidade',
  'verificando a sessão',
  'organizando os ambientes',
  'montando a tela Hoje',
];

/** Partículas que caem em direção à marca enquanto ela se forma. */
function seedBootSparks(host) {
  if (!host || device.reducedMotion) return;

  const total = device.mobile ? 10 : 16;
  for (let i = 0; i < total; i++) {
    const angle = (Math.PI * 2 * i) / total + Math.random() * 0.5;
    const distance = 90 + Math.random() * 120;
    host.appendChild(el('i', {
      style: {
        '--fx': Math.round(Math.cos(angle) * distance) + 'px',
        '--fy': Math.round(Math.sin(angle) * distance) + 'px',
        '--dur': (1.9 + Math.random() * 1.6).toFixed(2) + 's',
        '--delay': (Math.random() * 2.2).toFixed(2) + 's',
      },
    }));
  }
}

async function boot() {
  const bootEl = $('.boot');
  const meter = $('.boot__meter');
  const pct = $('.boot__pct');
  const task = $('.boot__taskName');
  const log = $('.boot__log');
  const arc = $('.boot__arc-fill');

  const SEGMENTS = 32;
  for (let i = 0; i < SEGMENTS; i++) {
    meter.appendChild(el('span', { class: 'boot__seg' }));
  }
  const segs = Array.from(meter.children);

  seedBootSparks($('.boot__sparks'));

  // Comprimento do arco: 2πr com r = 56, como no viewBox do SVG
  const ARC = 2 * Math.PI * 56;

  let progress = 0;
  const setProgress = (value, label) => {
    progress = Math.max(progress, Math.min(1, value));
    const lit = Math.round(progress * SEGMENTS);
    segs.forEach((s, i) => {
      s.dataset.on = String(i < lit);
      s.dataset.head = String(i === lit - 1 && progress < 1);
    });
    pct.textContent = Math.round(progress * 100) + '%';
    if (arc) arc.style.strokeDashoffset = String(ARC * (1 - progress));
    if (label) {
      task.textContent = label;
      const line = el('li', { text: label });
      log.appendChild(line);
      while (log.children.length > 6) log.firstChild.remove();
    }
    if (app.logo) app.logo.setReveal(progress);
  };

  setProgress(0.04, BOOT_STEPS[0]);
  applyPrefs();

  // O vigia de quadros começa junto com a abertura: se o aparelho já
  // sofrer aqui, a decoração entra num degrau mais leve desde o início.
  quality.watch();
  window.nestraQuality = quality;   // visível no console, como a cena

  /* A marca sendo construída dentro do próprio carregamento */
  setProgress(0.14, BOOT_STEPS[1]);

  // Descobre qual arquivo de logo existe na pasta e usa ele em tudo
  app.logoSrc = await resolveLogoSource();
  window.nestraLogoSrc = app.logoSrc;   // usado pelo carregador de rota
  document.querySelectorAll('img[data-logo]').forEach((img) => {
    img.src = app.logoSrc;
  });

  app.logo = new Logo3D($('#bootLogo'), {
    src: app.logoSrc,
    depth: 0.20,
    bevel: 0.028,
    glow: 0.85,
    zoom: 1.05,
    autoSpin: 0.5,
    reveal: 0,
    interactive: false,
    colorSide: 1400,
    sdfSide: 520,
  });
  await app.logo.init();
  setProgress(0.42);

  /* Cena de fundo */
  setProgress(0.5, BOOT_STEPS[2]);
  const sceneCanvas = $('#scene');
  if (!device.reducedMotion) {
    // A quantidade de peças não é mais decidida pela largura da tela: o
    // governo de qualidade mede o aparelho e ajusta quadro a quadro.
    app.scene = new Scene(sceneCanvas, { accent: hexToRgb(store.state.prefs.accent) });
    if (app.scene.init()) {
      window.nestraScene = app.scene;
      sceneCanvas.dataset.ready = 'true';
    }
  }
  setProgress(0.66);

  /* Sessão */
  setProgress(0.72, BOOT_STEPS[3]);
  let logged = false;
  try {
    logged = await store.restoreSession();
  } catch {
    logged = false;
  }

  // As preferências só existem depois da sessão: cor de destaque,
  // densidade e movimento precisam ser aplicados de novo agora, senão a
  // pessoa vê o padrão até abrir as configurações.
  if (logged) applyPrefs();

  setProgress(0.86, BOOT_STEPS[4]);

  await sleep(220);
  setProgress(1, BOOT_STEPS[5]);
  await sleep(560);

  /* Fecho */
  bootEl.dataset.done = 'true';
  setTimeout(() => {
    bootEl.remove();
    app.logo?.destroy();
    app.logo = null;
  }, 900);

  startApp(logged);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =====================================================================
   2. TEMA E PREFERÊNCIAS
   ===================================================================== */

function applyPrefs() {
  const p = store.state.prefs;
  const root = document.documentElement;

  root.dataset.density = p.density;
  root.dataset.motion = p.motion;
  root.dataset.contrast = p.highContrast ? 'high' : 'normal';
  root.dataset.corners = p.cornerStyle;
  root.style.setProperty('--accent', p.accent);
  root.style.setProperty('--glow-strength', String(p.glowIntensity / 100));

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = p.highContrast ? '#000000' : '#070911';

  // A cena e a logo acompanham a cor escolhida
  const rgb = hexToRgb(p.accent);
  if (app.scene) app.scene.opts.accent = rgb;
  if (app.heroLogo) app.heroLogo.opts.accent = rgb;
  if (app.logo) app.logo.opts.accent = rgb;
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#2F6BFF');
  if (!m) return [0.184, 0.42, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/* =====================================================================
   3. INÍCIO
   ===================================================================== */

function startApp(logged) {
  bindRipple(document);

  // Resposta física em toda a interface
  bindGlobalClick();
  bindAutoLoading(document);
  bindCursorTrail();

  window.addEventListener('hashchange', route);

  store.addEventListener('auth', () => {
    applyPrefs();
    renderShell();
    route();
  });
  store.addEventListener('sync', (ev) => paintSync(ev.detail));
  store.addEventListener('items', scheduleNotifications);

  /* Chegou coisa nova do servidor — provavelmente feita no outro
     aparelho. A tela atual se redesenha sozinha, sem recarregar nada. */
  store.addEventListener('pulled', () => {
    if (!store.state.user) return;
    // As preferências também viajam entre aparelhos
    applyPrefs();
    repaintWhenIdle();
    scheduleNotifications();
  });

  // Mantém computador e celular olhando para os mesmos dados
  store.startAutoSync();

  if (!location.hash) {
    location.hash = logged ? '#/hoje' : '#/';
  }
  route();

  registerServiceWorker();
  bindGlobalKeys();
  scheduleNotifications();
  setInterval(scheduleNotifications, 60000);

  window.addEventListener('online', () => { store.setSync('syncing'); store.flush(); });
  window.addEventListener('offline', () => store.setSync('offline'));

  // Troca de marca feita nas configurações: reconstrói o 3D na hora
  window.addEventListener('nestra:logo-changed', reloadLogo);
}

/** Recarrega a marca em todo lugar depois de uma troca. */
async function reloadLogo() {
  app.logoSrc = await resolveLogoSource();

  document.querySelectorAll('img[data-logo]').forEach((img) => {
    img.src = app.logoSrc;
  });

  if (app.heroLogo) {
    app.heroLogo.destroy();
    app.heroLogo = null;
  }

  const heroCanvas = $('#heroLogo');
  if (heroCanvas) {
    heroCanvas.parentElement.querySelector('.logo-css3d')?.remove();
    heroCanvas.style.display = '';
    app.heroLogo = new Logo3D(heroCanvas, {
      src: app.logoSrc,
      depth: 0.24,
      bevel: 0.026,
      glow: 0.72,
      zoom: 1.08,
      autoSpin: 0.22,
      colorSide: 1400,
      sdfSide: 520,
      accent: hexToRgb(store.state.prefs.accent),
    });
    app.heroLogo.init();
  }
}

/* =====================================================================
   4. NAVEGAÇÃO
   ===================================================================== */

const ROUTES = {
  '': { name: 'landing' },
  '/': { name: 'landing' },
  '/entrar': { name: 'auth', mode: 'login' },
  '/criar-conta': { name: 'auth', mode: 'register' },
  '/hoje': { name: 'today', guard: true },
  '/ambientes': { name: 'environments', guard: true },
  '/entrada': { name: 'inbox', guard: true },
  '/config': { name: 'settings', guard: true },
};

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, param] = (() => {
    const m = hash.match(/^\/ambiente\/(.+)$/);
    if (m) return ['/ambiente', m[1]];
    return [hash, null];
  })();

  const def = path === '/ambiente'
    ? { name: 'environment', guard: true }
    : ROUTES[path] || { name: 'landing' };

  const logged = Boolean(store.state.user);

  if (def.guard && !logged) {
    location.hash = '#/entrar';
    return;
  }
  if (def.name === 'landing' && logged) {
    location.hash = '#/hoje';
    return;
  }
  if (def.name === 'auth' && logged) {
    location.hash = '#/hoje';
    return;
  }

  const previousScreen = app.route.name === 'landing' ? 'landing'
    : app.route.name === 'auth' ? 'auth' : 'app';
  const nextScreen = def.name === 'landing' ? 'landing'
    : def.name === 'auth' ? 'auth' : 'app';

  const changedScreen = previousScreen !== nextScreen;
  const previousName = app.route.name;

  app.route = { name: def.name, param, mode: def.mode };

  const paint = () => {
    document.querySelectorAll('.screen').forEach((s) => (s.dataset.active = 'false'));

    // A cena de fundo sabe em que tela estamos: as placas ficam grandes
    // na apresentação e recuam dentro do app, sem apagar a aurora.
    app.scene?.setMood(nextScreen);

    if (def.name === 'landing') {
      document.body.dataset.view = 'landing';
      $('#screen-landing').dataset.active = 'true';
      initLanding();
    } else if (def.name === 'auth') {
      document.body.dataset.view = 'auth';
      $('#screen-auth').dataset.active = 'true';
      renderAuth(def.mode);
    } else {
      document.body.dataset.view = 'app';
      $('#screen-app').dataset.active = 'true';
      renderShell();
      renderCurrentView({ animate: previousName !== def.name || param });
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
    document.body.dataset.sidebar = 'closed';
  };

  // Sair da apresentação para o app (ou o contrário) merece uma cortina;
  // navegar dentro do app usa a transição mais leve, dentro do conteúdo.
  if (changedScreen) {
    const reveal = screenTransition();
    setTimeout(() => {
      paint();
      reveal();
    }, 250);
  } else {
    paint();
  }
}

function navigate(name, param) {
  const map = {
    today: '#/hoje',
    environments: '#/ambientes',
    environment: '#/ambiente/' + param,
    inbox: '#/entrada',
    settings: '#/config',
    landing: '#/',
  };
  const target = map[name] || '#/hoje';

  /* Clicar na seção em que já se está.
     Antes isso não fazia absolutamente nada: o endereço não mudava, o
     `hashchange` não disparava e a tela ficava parada — que é a
     definição de botão quebrado, do ponto de vista de quem clicou.
     Agora a seção é remontada, com o mesmo carregamento das outras
     trocas, e a página volta ao topo. */
  if (location.hash === target) {
    if (store.state.user) renderCurrentView({ animate: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.dataset.sidebar = 'closed';
    return;
  }

  location.hash = target;
}

/* =====================================================================
   5. PÁGINA DE ENTRADA
   ===================================================================== */

let landingReady = false;

function initLanding() {
  bindReveal(document);
  initFx(document);

  // Preenche os ícones declarados no HTML
  document.querySelectorAll('[data-icon]').forEach((node) => {
    if (node.childElementCount) return;
    node.innerHTML = icon(node.dataset.icon, 20);
  });

  if (landingReady) return;
  landingReady = true;

  bindCursorGlow();

  /* A marca em 3D, grande, na abertura */
  const heroCanvas = $('#heroLogo');
  if (heroCanvas) {
    app.heroLogo = new Logo3D(heroCanvas, {
      src: app.logoSrc || 'assets/logo/nestra-mark.png',
      depth: 0.24,
      bevel: 0.026,
      glow: 0.72,
      zoom: 1.08,
      autoSpin: 0.22,
      colorSide: 1400,
      sdfSide: 520,
    });
    app.heroLogo.init();
  }

  /* Demonstração viva da captura: escreve e mostra o que foi entendido */
  const demoText = $('#demoText');
  const demoChips = $('#demoChips');

  if (demoText && demoChips) {
    const phrases = [
      'Lavar o tênis no sábado.',
      'Anexar atestado no trabalho amanhã de manhã.',
      'Reunião com o professor às 19h.',
      'Ideia: criar uma rotina de revisão semanal.',
      'Comprar benefício, prioridade alta.',
      'Atualizar o sistema hoje — incluir detalhes da atualização.',
    ];

    const fakeEnvs = SUGGESTED_ENVIRONMENTS.map((e, i) => ({ ...e, id: 'demo-' + i }));

    typewriter(demoText, phrases, {
      onPhraseDone: (phrase) => {
        const parsed = parse(phrase, { environments: fakeEnvs, timezone: store.state.prefs.timezone });
        demoChips.replaceChildren();

        const chips = [];
        chips.push(['sparkle', TYPE_LABELS[parsed.type]]);
        const quando = humanDate(parsed.dueDate, store.state.prefs.timezone);
        if (quando) chips.push(['calendar', quando]);
        if (parsed.dueTime) chips.push(['clock', parsed.dueTime]);
        if (parsed.timePeriod !== 'any' && !parsed.dueTime) chips.push(['moon', parsed.timePeriod === 'morning' ? 'manhã' : parsed.timePeriod === 'afternoon' ? 'tarde' : 'noite']);
        if (parsed.priority !== 'normal') chips.push(['flag', 'prioridade ' + parsed.priority]);
        if (parsed.environmentName) chips.push(['layers', parsed.environmentName]);
        if (parsed.description) chips.push(['list', 'com descrição']);

        chips.forEach(([ic, label], i) => {
          demoChips.appendChild(el('span', {
            class: 'chip',
            style: { animationDelay: (i * 0.07) + 's' },
            html: icon(ic, 12) + `<span>${label}</span>`,
          }));
        });
      },
      onErase: () => demoChips.replaceChildren(),
    });
  }
}

/* =====================================================================
   6. ACESSO
   ===================================================================== */

function renderAuth(mode) {
  const host = $('#screen-auth');
  const isRegister = mode === 'register';

  host.replaceChildren();

  const nameField = el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Nome de exibição' }),
    el('input', { class: 'input', name: 'displayName', autocomplete: 'name', placeholder: 'Como quer ser chamado' }),
  ]);

  const emailInput = el('input', {
    class: 'input', type: 'email', name: 'email', required: true,
    autocomplete: 'email', placeholder: 'voce@exemplo.com',
  });

  const passInput = el('input', {
    class: 'input', type: 'password', name: 'password', required: true,
    autocomplete: isRegister ? 'new-password' : 'current-password',
    placeholder: '••••••••',
  });

  const meter = el('div', { class: 'pw-meter', dataset: { score: '0' } }, [
    el('i'), el('i'), el('i'), el('i'),
  ]);

  passInput.addEventListener('input', () => {
    const v = passInput.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v) || v.length >= 14) score++;
    meter.dataset.score = String(score);
  });

  const errorBox = el('p', { class: 'field__error', style: { display: 'none' } });

  const submit = el('button', {
    class: 'btn btn--primary btn--block btn--lg',
    type: 'submit',
    html: icon('chevron', 17) + (isRegister ? 'Criar minha conta' : 'Entrar'),
  });

  const form = el('form', { class: 'auth__form', novalidate: true }, [
    isRegister ? nameField : null,
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'E-mail' }),
      emailInput,
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Senha' }),
      passInput,
      isRegister ? meter : null,
      isRegister ? el('span', { class: 'field__hint', text: 'Pelo menos 8 caracteres.' }) : null,
    ]),
    errorBox,
    submit,
  ]);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorBox.style.display = 'none';
    emailInput.removeAttribute('aria-invalid');
    passInput.removeAttribute('aria-invalid');

    const displayName = form.displayName?.value.trim();
    const email = emailInput.value.trim();
    const password = passInput.value;

    if (isRegister && (!displayName || displayName.length < 2)) {
      return fail('Escreva um nome com pelo menos 2 letras.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.setAttribute('aria-invalid', 'true');
      return fail('Confira o e-mail digitado.');
    }
    if (password.length < 8) {
      passInput.setAttribute('aria-invalid', 'true');
      return fail('A senha precisa de pelo menos 8 caracteres.');
    }

    submit.disabled = true;
    submit.innerHTML = isRegister ? 'Criando…' : 'Entrando…';

    try {
      if (isRegister) {
        await store.register({ displayName, email, password });
        store.seedEnvironments();
        // Sem ambiente padrão: o que a frase não indicar fica na caixa de
        // entrada, em vez de cair em "Trabalho" por acidente.
        store.setPrefs({ defaultEnvironmentId: null });
        toast(`Bem-vindo ao Nestra, ${displayName.split(' ')[0]}.`, { kind: 'success' });
        showWelcome();
      } else {
        await store.login({ email, password });
        toast('Que bom te ver de novo.', { kind: 'success' });
      }
      location.hash = '#/hoje';
    } catch (err) {
      fail(err.message || 'Não foi possível concluir.');
    } finally {
      submit.disabled = false;
      submit.innerHTML = icon('chevron', 17) + (isRegister ? 'Criar minha conta' : 'Entrar');
    }
  });

  function fail(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'flex';
  }

  const card = el('div', { class: 'auth__card' }, [
    el('img', { class: 'auth__logo', 'data-logo': true, src: app.logoSrc || 'assets/logo/nestra-mark.png', alt: 'Nestra' }),
    el('h1', { class: 'auth__title', text: isRegister ? 'Criar sua conta' : 'Entrar no Nestra' }),
    el('p', {
      class: 'auth__sub',
      text: isRegister
        ? 'Só o necessário para funcionar. O resto fica nas configurações.'
        : 'Seu espaço para o que importa.',
    }),
    form,
    el('p', { class: 'auth__foot' }, [
      el('span', { text: isRegister ? 'Já tem conta? ' : 'Ainda não tem conta? ' }),
      el('a', {
        href: isRegister ? '#/entrar' : '#/criar-conta',
        text: isRegister ? 'Entrar' : 'Criar agora',
      }),
    ]),
    /* Onde a conta vai morar — dito antes de a pessoa digitar a senha.
       Em modo local isso não é um detalhe técnico: a conta criada aqui
       não existe em nenhum outro aparelho, e descobrir isso só depois de
       tentar entrar no celular é a pior hora possível. */
    store.state.mode === 'remote'
      ? el('p', {
          class: 'auth__note auth__note--ok',
          html: icon('devices', 14) +
            '<span>Sua conta vale em qualquer aparelho: entre com o mesmo e-mail no celular e verá os mesmos itens.</span>',
        })
      : el('p', {
          class: 'auth__note auth__note--warn',
          html: icon('alert', 14) + '<span>' + (api.degraded
            // A API existe: o problema é outro, e dá para nomear
            ? `<b>O servidor respondeu, mas o banco não.</b> ${api.degraded.message} ` +
              'Enquanto isso, a conta criada aqui fica só neste navegador.'
            : '<b>Este endereço guarda os dados só neste navegador.</b> ' +
              'A conta criada aqui não vai existir no celular — e entrar com ela lá abriria um espaço vazio. ' +
              'Para a mesma conta valer nos dois, o site precisa ser publicado junto da API.'
          ) + '</span>',
        }),
    el('p', { class: 'auth__foot', style: { marginTop: 'var(--s-4)' } }, [
      el('a', { href: '#/', text: '← Voltar para a apresentação' }),
    ]),
  ]);

  host.appendChild(el('div', { class: 'auth' }, [card]));
  setTimeout(() => (isRegister ? form.displayName : emailInput).focus(), 160);
}

/** Primeiro contato: explica os ambientes sugeridos, todos editáveis. */
function showWelcome() {
  const body = el('div', { class: 'stack gap-4' }, [
    el('p', { class: 'text-body', text: 'Criamos três ambientes de exemplo para você começar. Eles são só sugestões — renomeie, mude a cor ou apague à vontade.' }),
    el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } },
      store.activeEnvironments.map((e) =>
        el('span', {
          class: 'chip',
          style: { borderColor: e.color, color: e.color },
          html: icon(e.icon, 13) + `<span>${e.name}</span>`,
        }))),
    el('p', { class: 'text-body', text: 'Agora escreva uma frase natural na caixa de captura — por exemplo, "lavar o tênis no sábado" — e o Nestra descobre o tipo, a data e o ambiente.' }),
  ]);

  const ok = el('button', { class: 'btn btn--primary', text: 'Começar' });
  const dialog = openModal({ title: 'Seu espaço está pronto', body, footer: [ok] });
  ok.addEventListener('click', () => dialog.close());
}

/* =====================================================================
   7. ESTRUTURA DA APLICAÇÃO
   ===================================================================== */

function renderShell() {
  const host = $('#screen-app');
  if (!store.state.user) return;

  if (host.dataset.built === 'true') {
    paintSidebar();
    return;
  }
  host.dataset.built = 'true';
  host.classList.add('app-screen');
  host.replaceChildren();

  /* Barra superior */
  const burger = el('button', {
    class: 'btn btn--ghost btn--icon topbar__burger',
    'aria-label': 'Abrir menu',
    html: icon('menu', 18),
    onClick: () => {
      document.body.dataset.sidebar =
        document.body.dataset.sidebar === 'open' ? 'closed' : 'open';
    },
  });

  const clock = el('div', { class: 'topbar__clock' });
  const tickClock = () => {
    const now = new Date();
    clock.innerHTML = `${now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · <b>${
      now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>`;
  };
  tickClock();
  setInterval(tickClock, 15000);

  const avatar = el('button', {
    class: 'avatar',
    'aria-label': 'Menu da conta',
    text: initials(store.state.user.displayName),
  });
  avatar.addEventListener('click', () => {
    openMenu(avatar, [
      { label: store.state.user.displayName, icon: 'user' },
      '-',
      { label: 'Configurações', icon: 'settings', key: ',', onSelect: () => navigate('settings') },
      { label: 'Buscar', icon: 'search', key: '/', onSelect: openPalette },
      '-',
      { label: 'Sair', icon: 'logout', danger: true, onSelect: async () => {
        await store.logout();
        location.hash = '#/';
      } },
    ]);
  });

  const topbar = el('header', { class: 'topbar' }, [
    burger,
    el('a', { class: 'brand', href: '#/hoje' }, [
      el('img', { class: 'brand__mark', 'data-logo': true, src: app.logoSrc || 'assets/logo/nestra-mark.png', alt: '', width: 42, height: 42 }),
      el('span', { class: 'brand__name', text: 'NESTRA' }),
    ]),
    el('span', { class: 'topbar__spacer' }),
    el('button', {
      class: 'btn btn--ghost btn--icon tip',
      'data-tip': 'Buscar  /',
      'aria-label': 'Buscar',
      html: icon('search', 17),
      onClick: openPalette,
    }),
    clock,
    avatar,
  ]);

  /* Barra lateral */
  const sidebar = el('nav', { class: 'sidebar', 'aria-label': 'Navegação principal' });
  const scrim = el('div', {
    class: 'sidebar__scrim',
    onClick: () => (document.body.dataset.sidebar = 'closed'),
  });

  const main = el('main', { class: 'main', id: 'main' }, [
    el('div', { class: 'main__inner', id: 'viewRoot' }),
  ]);

  /* Barra inferior no celular */
  const mobileBar = el('div', { class: 'mobile-bar' }, [
    el('button', {
      class: 'btn btn--primary grow',
      html: icon('bolt', 16) + 'Capturar',
      onClick: () => {
        navigate('today');
        setTimeout(() => $('#viewRoot')?.captureBox?.focusInput(), 220);
      },
    }),
    el('button', {
      class: 'btn btn--ghost btn--icon',
      'aria-label': 'Ambientes',
      html: icon('layers', 17),
      onClick: () => navigate('environments'),
    }),
    el('button', {
      class: 'btn btn--ghost btn--icon',
      'aria-label': 'Configurações',
      html: icon('settings', 17),
      onClick: () => navigate('settings'),
    }),
  ]);

  host.append(topbar, el('div', { class: 'shell' }, [sidebar, main]), scrim, mobileBar);
  app.sidebar = sidebar;
  paintSidebar();

  window.addEventListener('nestra:palette', openPalette);
}

function paintSidebar() {
  const sidebar = app.sidebar;
  if (!sidebar) return;

  const b = store.todayBuckets();
  const inbox = store.live.filter((i) => !i.environmentId && i.status === 'pending').length;

  sidebar.replaceChildren();

  const link = (label, iconName, target, count, current) => {
    const node = el('button', {
      class: 'side-link',
      'aria-current': current ? 'page' : null,
      onClick: () => {
        navigate(target.name, target.param);
        document.body.dataset.sidebar = 'closed';
      },
    }, [
      el('span', { class: 'side-link__icon', html: icon(iconName, 17) }),
      el('span', { class: 'grow', text: label }),
      count ? el('span', { class: 'badge side-link__count', text: String(count) }) : null,
    ]);
    return node;
  };

  const r = app.route;

  const nav = el('div', { class: 'side-group' }, [
    el('div', { class: 'side-group__title', text: 'Visão' }),
    link('Hoje', 'target', { name: 'today' }, b.overdue.length + b.dueToday.length, r.name === 'today'),
    link('Caixa de entrada', 'inbox', { name: 'inbox' }, inbox, r.name === 'inbox'),
    link('Ambientes', 'layers', { name: 'environments' }, null, r.name === 'environments'),
  ]);
  sidebar.appendChild(nav);

  /* Ambientes do usuário */
  const envGroup = el('div', { class: 'side-group' });
  envGroup.appendChild(el('div', { class: 'side-group__title' }, [
    el('span', { text: 'Meus ambientes' }),
    el('button', {
      class: 'btn btn--ghost btn--icon btn--sm',
      'aria-label': 'Novo ambiente',
      html: icon('plus', 14),
      onClick: () => openEnvironmentForm(null, () => { paintSidebar(); renderCurrentView(); }),
    }),
  ]));

  const envs = store.activeEnvironments;
  if (!envs.length) {
    envGroup.appendChild(el('p', {
      class: 'field__hint',
      style: { padding: '0 12px' },
      text: 'Crie o primeiro para separar contextos.',
    }));
  }

  envs.forEach((env, envIndex) => {
    const stats = store.environmentStats(env.id);
    const node = el('button', {
      class: 'side-link',
      style: { '--env-color': env.color, '--env-symbol-delay': `${envIndex * -0.47}s` },
      'aria-current': r.name === 'environment' && r.param === env.id ? 'page' : null,
      onClick: () => {
        navigate('environment', env.id);
        document.body.dataset.sidebar = 'closed';
      },
    }, [
      el('span', { class: 'env-link__symbol', 'aria-hidden': 'true' }, [
        el('span', { class: 'env-link__symbol-body' }, [
          el('span', { class: 'env-link__symbol-depth', html: icon(env.icon, 13) }),
          el('span', { class: 'env-link__symbol-face', html: icon(env.icon, 13) }),
        ]),
      ]),
      el('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis' }, text: env.name }),
      stats.overdue
        ? el('span', { class: 'badge badge--overdue', text: String(stats.overdue) })
        : stats.pending
          ? el('span', { class: 'badge', text: String(stats.pending) })
          : null,
    ]);
    envGroup.appendChild(node);
  });
  sidebar.appendChild(envGroup);

  /* Rodapé da lateral */
  const syncPill = el('div', { class: 'sync-pill', id: 'syncPill', dataset: { state: store.state.syncState } }, [
    el('span', { class: 'sync-pill__dot' }),
    el('span', { id: 'syncLabel', text: syncLabel(store.state.syncState) }),
  ]);

  sidebar.appendChild(el('div', { class: 'sidebar__foot' }, [
    syncPill,
    el('button', {
      class: 'side-link',
      'aria-current': app.route.name === 'settings' ? 'page' : null,
      onClick: () => navigate('settings'),
    }, [
      el('span', { class: 'side-link__icon', html: icon('settings', 17) }),
      el('span', { text: 'Configurações' }),
    ]),
  ]));
}

function syncLabel(state) {
  return {
    local: 'somente neste dispositivo',
    syncing: 'sincronizando…',
    synced: 'sincronizado',
    offline: 'sem conexão',
    error: 'falha ao sincronizar',
  }[state] || state;
}

function paintSync(state) {
  const pill = $('#syncPill');
  if (!pill) return;
  pill.dataset.state = state;
  $('#syncLabel').textContent = syncLabel(state);
}

/**
 * Redesenha quando a tela estiver livre.
 *
 * A busca automática roda a cada 45 segundos. Se ela redesenhasse a tela
 * no meio de uma frase, a frase iria embora — e perder o que a pessoa
 * estava escrevendo é justamente o que este produto existe para evitar.
 * O mesmo vale para um formulário aberto: espera fechar.
 */
let repaintTimer = 0;

function repaintWhenIdle() {
  const focused = document.activeElement;
  const typing = focused && (
    /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName) || focused.isContentEditable);
  const dialogOpen = document.querySelector('.overlay[data-open="true"], .palette[data-open="true"]');

  if (typing || dialogOpen) {
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(repaintWhenIdle, 4000);
    return;
  }

  clearTimeout(repaintTimer);
  paintSidebar();
  renderCurrentView();
}

function renderCurrentView({ animate = false } = {}) {
  const root = $('#viewRoot');
  if (!root) return;
  const r = app.route;

  const draw = (container) => {
    if (r.name === 'today') renderToday(container, { onNavigate: navigate });
    else if (r.name === 'environments') renderEnvironments(container, { onNavigate: navigate });
    else if (r.name === 'environment') renderEnvironment(container, r.param, {
      onNavigate: navigate,
      onEditEnvironment: (env) => openEnvironmentForm(env, () => {
        paintSidebar();
        renderCurrentView();
      }),
    });
    else if (r.name === 'inbox') renderInbox(container, { onNavigate: navigate });
    else if (r.name === 'settings') renderSettings(container, { onNavigate: navigate, applyPrefs });

    paintSidebar();
    initFx(container);
  };

  /* As peças 3D vivem só enquanto a tela delas existe. Sair da tela sem
     desmontá-las deixaria contextos WebGL pendurados — e o navegador tem
     um teto baixo deles, ainda mais no celular.

     Mas desmontar cedo demais é pior: o nó continua na tela durante a
     animação de saída, e um canvas sem contexto vira um retângulo em
     branco. Por isso a limpeza é entregue ao `swapView`, que a executa
     no instante exato em que o conteúdo antigo sai do documento. */
  const cleanup = () => {
    // Sair da tela com o microfone aberto seria péssimo: encerra junto
    root.captureBox?.stopVoice?.();
    clearOrbs();
    if (r.name !== 'environment') {
      clearEnvHeroes();
      root.__envHero = null;
    }
    if (r.name !== 'today') {
      clearTodayBrand();
      root.__todayHero = null;
    }
  };

  if (animate) {
    // Navegar pela barra lateral monta uma tela inteira: a marca girando
    // por cima do conteúdo mostra que isso está acontecendo.
    const done = viewLoading($('.main'));
    swapView(root, draw, { onSwap: cleanup }).then(done, done);
  } else {
    cleanup();
    root.replaceChildren();
    draw(root);
  }
}

/* =====================================================================
   8. BUSCA / PALETA DE COMANDOS
   ===================================================================== */

let palette = null;

function openPalette() {
  if (palette) {
    palette.dataset.open = 'true';
    palette.querySelector('input').focus();
    return;
  }

  const input = el('input', {
    class: 'palette__input',
    placeholder: 'Buscar itens ou executar uma ação…',
    'aria-label': 'Buscar',
  });
  const results = el('div', { class: 'palette__results' });

  palette = el('div', { class: 'palette', dataset: { open: 'true' } }, [
    el('div', { class: 'palette__box' }, [
      input,
      results,
      el('div', { class: 'palette__foot' }, [
        el('span', { text: '↑↓ navegar' }),
        el('span', { text: '⏎ abrir' }),
        el('span', { text: 'esc fechar' }),
      ]),
    ]),
  ]);

  document.body.appendChild(palette);

  let selected = 0;
  let entries = [];

  const commands = () => [
    { label: 'Ir para Hoje', hint: 'navegação', run: () => navigate('today') },
    { label: 'Ir para Ambientes', hint: 'navegação', run: () => navigate('environments') },
    { label: 'Caixa de entrada', hint: 'navegação', run: () => navigate('inbox') },
    { label: 'Configurações', hint: 'navegação', run: () => navigate('settings') },
    { label: 'Criar ambiente', hint: 'ação', run: () => openEnvironmentForm(null, renderCurrentView) },
    { label: 'Exportar meus dados', hint: 'ação', run: () => navigate('settings') },
  ];

  const draw = () => {
    const q = input.value.trim();
    results.replaceChildren();

    const found = q ? store.search(q) : [];
    const cmds = commands().filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));

    entries = [
      ...found.map((item) => ({
        label: item.title,
        hint: TYPE_LABELS[item.type] +
          (humanDate(item.dueDate, store.state.prefs.timezone)
            ? ' · ' + humanDate(item.dueDate, store.state.prefs.timezone)
            : ''),
        run: () => openItemDetail(item.id, renderCurrentView),
      })),
      ...cmds,
    ].slice(0, 12);

    if (!entries.length) {
      results.appendChild(el('p', {
        class: 'field__hint',
        style: { padding: 'var(--s-4)' },
        text: 'Nada encontrado. Tente outras palavras.',
      }));
      return;
    }

    entries.forEach((entry, i) => {
      results.appendChild(el('button', {
        class: 'palette__row',
        'aria-selected': String(i === selected),
        onClick: () => { close(); entry.run(); },
      }, [
        el('span', { html: icon(entry.hint === 'navegação' ? 'chevron' : entry.hint === 'ação' ? 'bolt' : 'list', 15) }),
        el('span', { text: entry.label }),
        el('small', { text: entry.hint }),
      ]));
    });
  };

  input.addEventListener('input', () => { selected = 0; draw(); });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { close(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); selected = (selected + 1) % entries.length; draw(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); selected = (selected - 1 + entries.length) % entries.length; draw(); }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const entry = entries[selected];
      if (entry) { close(); entry.run(); }
    }
  });

  palette.addEventListener('pointerdown', (ev) => {
    if (ev.target === palette) close();
  });

  function close() {
    palette.dataset.open = 'false';
    /* A paleta só some da vista: o nó continua no documento. Sem soltar
       o foco, o campo de busca invisível continuava recebendo o que era
       digitado — e todos os atalhos de teclado paravam de funcionar,
       porque a interface entendia que a pessoa estava escrevendo. */
    input.blur();
  }

  draw();
  setTimeout(() => input.focus(), 80);
}

/* =====================================================================
   9. ATALHOS DE TECLADO (§22: opcionais, nunca obrigatórios)
   ===================================================================== */

function bindGlobalKeys() {
  document.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;

    if ((ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      openPalette();
      return;
    }

    if (typing) return;
    if (!store.state.user) return;

    if (ev.key === '/') { ev.preventDefault(); openPalette(); }
    if (ev.key === 'c') { ev.preventDefault(); navigate('today'); setTimeout(() => $('#viewRoot')?.captureBox?.focusInput(), 200); }
    if (ev.key === 'h') navigate('today');
    if (ev.key === 'a') navigate('environments');
    if (ev.key === ',') navigate('settings');
    if (ev.key === '?') showShortcuts();
  });
}

function showShortcuts() {
  const rows = [
    ['/', 'Buscar'],
    ['C', 'Capturar alguma coisa'],
    ['H', 'Ir para Hoje'],
    ['A', 'Ir para Ambientes'],
    [',', 'Configurações'],
    ['Ctrl/⌘ K', 'Paleta de comandos'],
    ['Enter', 'Abrir o item em foco'],
    ['Espaço', 'Concluir o item em foco'],
    ['?', 'Esta lista'],
  ];

  const body = el('div', { class: 'stack gap-2' },
    rows.map(([key, label]) =>
      el('div', { class: 'setting-row', style: { padding: '9px 0' } }, [
        el('span', { class: 'setting-row__info', text: label }),
        el('kbd', { text: key }),
      ])));

  const ok = el('button', { class: 'btn btn--primary', text: 'Entendi' });
  const dialog = openModal({ title: 'Atalhos de teclado', body, footer: [ok] });
  ok.addEventListener('click', () => dialog.close());
}

/* =====================================================================
   10. NOTIFICAÇÕES DO NAVEGADOR (§9)
   ===================================================================== */

const notified = new Set();

function scheduleNotifications() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!store.state.user) return;

  const p = store.state.prefs;
  const tz = p.timezone;
  const today = toISODate(todayIn(tz));
  const now = new Date();

  store.live.forEach((item) => {
    if (item.status !== 'pending' || notified.has(item.id)) return;

    let reason = null;

    if (p.notifyCommitments && item.type === 'commitment' && item.dueDate === today && item.dueTime) {
      const [h, m] = item.dueTime.split(':').map(Number);
      const when = new Date(now);
      when.setHours(h, m, 0, 0);
      const minutes = (when - now) / 60000;
      if (minutes > 0 && minutes <= (p.notifyLeadMinutes || 30)) {
        reason = `Começa às ${item.dueTime}`;
      }
    }

    if (!reason && p.notifyDueItems && item.dueDate === today && now.getHours() >= 8) {
      reason = 'Vence hoje';
    }

    if (!reason && p.notifyOverdue && item.dueDate && item.dueDate < today && now.getHours() >= 9) {
      reason = 'Passou da data';
    }

    if (!reason) return;

    notified.add(item.id);
    try {
      const n = new Notification('Nestra · ' + reason, {
        body: item.title,
        icon: 'assets/icons/icon-192.png',
        badge: 'assets/icons/icon-192.png',
        tag: 'nestra-' + item.id,
      });
      n.onclick = () => {
        window.focus();
        openItemDetail(item.id, renderCurrentView);
      };
    } catch { /* o navegador pode recusar em segundo plano */ }
  });
}

/* =====================================================================
   11. PWA
   ===================================================================== */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  const registrar = () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* sem service worker o app continua funcionando, só sem offline */
    });
  };

  /* Esta função é chamada lá do fim da abertura, que é assíncrona: a
     essa altura o evento `load` já disparou faz tempo. Ficar esperando
     por ele significava nunca registrar — e era o que acontecia. O app
     nunca teve service worker, e portanto nunca funcionou offline, apesar
     de se apresentar como instalável. */
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar, { once: true });
}

let installPrompt = null;

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;

  const btn = $('#installBtn');
  if (!btn) return;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    btn.hidden = true;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') toast('Nestra instalado. Ele abre como aplicativo agora.', { kind: 'success' });
    installPrompt = null;
  });
});

window.addEventListener('appinstalled', () => {
  toast('Instalado. Bom proveito.', { kind: 'success' });
});

/* ===================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  boot().catch((err) => {
    console.error('[nestra] falha na abertura:', err);
    const bootEl = $('.boot');
    if (bootEl) bootEl.dataset.done = 'true';
    startApp(false);
  });
});

export { navigate, renderCurrentView, applyPrefs };
