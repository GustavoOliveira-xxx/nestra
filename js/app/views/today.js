import { store } from '../store.js';
import { el, icon } from '../ui.js';
import { renderItem } from './items.js';
import { createCapture } from './capture.js';
import { todayMeetingsStrip } from './meetings.js';
import { humanDate, todayIn, toISODate } from '../nlp.js';
import { celebrate, bumpBadge } from '../../gfx/interactions.js';
import { mountEnvHero, clearEnvHeroes } from '../../gfx/envhero.js';
import { Logo3D } from '../../gfx/logo3d.js';
import { device, glBudget } from '../../core/device.js';

function dayRing(done, total) {
  const pct = total ? done / total : 0;
  const r = 18;
  const circumference = 2 * Math.PI * r;

  const svg = `
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <circle class="day-ring__track" cx="22" cy="22" r="${r}" fill="none" stroke-width="3"/>
      <circle class="day-ring__fill" cx="22" cy="22" r="${r}" fill="none" stroke-width="3"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference * (1 - pct)}"/>
    </svg>`;

  return el('div', {
    class: 'day-ring',
    title: `${done} de ${total} concluídos hoje`,
    role: 'img',
    'aria-label': `${Math.round(pct * 100)} por cento do dia concluído`,
  }, [
    el('div', { html: svg }),
    el('span', { class: 'day-ring__label', text: Math.round(pct * 100) + '%' }),
  ]);
}

const PERIOD_ORDER = ['morning', 'afternoon', 'evening', 'night', 'any'];
const PERIOD_TITLES = {
  morning: 'Manhã',
  afternoon: 'Tarde',
  evening: 'Noite',
  night: 'Madrugada',
  any: 'Sem horário definido',
};

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return `${part}, ${String(name || '').split(' ')[0] || 'tudo bem'}`;
}

let brand = null;
const brandToken = { id: 'today-brand' };

export function clearTodayBrand() {
  if (!brand) return;
  brand.destroy();
  glBudget.release(brandToken);
  brand = null;
}

function dayLine({ overdue, dueToday, done }) {
  if (overdue) {
    return overdue === 1
      ? 'Um item passou da data. Escolher uma nova já resolve.'
      : `${overdue} itens passaram da data. É só dar uma nova data a eles.`;
  }
  if (!dueToday) return 'Nada marcado para hoje. O que aparecer, você captura aí embaixo.';
  if (done >= dueToday) return 'Tudo o que era de hoje já saiu da frente.';
  const left = dueToday - done;
  return left === 1 ? 'Falta uma coisa para hoje.' : `Faltam ${left} coisas para hoje.`;
}

function todayHero({ b, dayTotal, dayDone, onNavigate }) {
  const canvas = el('canvas', {
    class: 'today-hero__logo',
    'aria-label': 'Marca do Nestra em três dimensões',
  });

  const dateLabel = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const summary = el('p', { class: 'today-hero__line' });
  const counters = el('div', { class: 'today-hero__stats' });
  const heroTitle = el('h1', {
    class: 'today-hero__title grad-text',
    text: greeting(store.state.user?.displayName),
  });

  const paint = (data) => {
    heroTitle.textContent = greeting(store.state.user?.displayName);
    summary.textContent = dayLine({
      overdue: data.b.overdue.length,
      dueToday: data.b.dueToday.length,
      done: data.dayDone,
    });

    const stat = (value, label, modifier) =>
      el('div', { class: 'today-hero__stat' + (modifier ? ' today-hero__stat--' + modifier : '') }, [
        el('span', { class: 'today-hero__stat-n', text: String(value) }),
        el('span', { class: 'today-hero__stat-l', text: label }),
      ]);

    counters.replaceChildren(...[
      data.dayTotal ? dayRing(data.dayDone, data.dayTotal) : null,
      stat(data.b.dueToday.length, 'para hoje'),
      data.b.overdue.length
        ? stat(data.b.overdue.length, 'passaram da data', 'overdue')
        : stat(data.dayDone, 'concluídos hoje'),
      stat(store.activeEnvironments.length, 'ambientes'),
    ].filter(Boolean));
  };

  paint({ b, dayTotal, dayDone });

  const hero = el('section', { class: 'today-hero' }, [
    el('div', { class: 'today-hero__stage' }, [
      el('span', { class: 'today-hero__aura', 'aria-hidden': 'true' }),
      el('div', { class: 'today-hero__orbit', 'aria-hidden': 'true' }, [
        el('span'), el('span'), el('span'),
      ]),
      canvas,
      el('span', { class: 'today-hero__floor', 'aria-hidden': 'true' }),
    ]),

    el('div', { class: 'today-hero__body' }, [
      el('span', { class: 'today-hero__kicker' }, [
        el('b', { text: 'NESTRA' }),
        el('i', { 'aria-hidden': 'true' }),
        el('span', { text: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1) }),
      ]),
      heroTitle,
      summary,
      counters,
      el('div', { class: 'today-hero__actions' }, [
        el('button', {
          class: 'btn btn--ghost btn--sm',
          html: icon('search', 15) + 'Buscar',
          onClick: () => window.dispatchEvent(new CustomEvent('nestra:palette')),
        }),
        el('button', {
          class: 'btn btn--ghost btn--sm',
          html: icon('layers', 15) + 'Ambientes',
          onClick: () => onNavigate('environments'),
        }),
      ]),
    ]),
  ]);

  hero.updateDay = paint;
  hero.dataset.alive = 'pending';

  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;

    const roomy = !device.reducedMotion && glBudget.claim(brandToken);

    brand = new Logo3D(canvas, {
      src: window.nestraLogoSrc || 'assets/logo/nestra-mark.png',
      depth: 0.36,
      bevel: 0.032,
      glow: 0.30,
      zoom: 1.34,
      autoSpin: 0.3,
      colorSide: 1600,
      sdfSide: 620,
      interactive: true,
      sharp: true,
      forceFallback: !roomy,
    });

    brand.init().then((ok) => {
      hero.dataset.alive = ok ? 'gl' : 'css';
      if (!ok && roomy) glBudget.release(brandToken);
    });
  });

  return hero;
}

function keepTodayHero(root, data) {
  const cached = root.__todayHero;

  if (cached && cached.dataset.alive && brand) {
    cached.updateDay(data);
    return cached;
  }

  if (cached) clearTodayBrand();

  const fresh = todayHero(data);
  root.__todayHero = fresh;
  return fresh;
}

export function renderToday(root, { onNavigate }) {
  const rerender = () => renderToday(root, { onNavigate });
  const b = store.todayBuckets();
  const tz = store.state.prefs.timezone;

  root.captureBox?.stopVoice?.();
  root.captureBox = null;
  root.replaceChildren();

  const dayTotal = b.dueToday.length + b.overdue.length;
  const dayDone = b.dueToday.filter((i) => i.status === 'done').length;

  root.appendChild(keepTodayHero(root, { b, dayTotal, dayDone, onNavigate }));

  const meetings = todayMeetingsStrip({ onNavigate, compact: true });
  if (meetings) root.appendChild(meetings);

  const capture = createCapture({ onCreated: rerender });
  root.appendChild(capture);
  root.captureBox = capture;

  const groups = el('div', {});
  root.appendChild(groups);

  const shown = new Set();

  const section = (title, items, color, extra) => {
    items = items.filter((i) => !shown.has(i.id));
    if (!items.length) return;
    items.forEach((i) => shown.add(i.id));
    const wrap = el('div', { class: 'item-group', style: { '--group-color': color } });

    wrap.appendChild(el('div', { class: 'group-head' }, [
      el('h2', { class: 'group-head__title', text: title }),
      extra ? el('span', { class: 'text-dim', style: { fontSize: 'var(--fs-xs)' }, text: extra }) : null,
      el('span', { class: 'group-head__meta', text: `${items.length} ${items.length === 1 ? 'item' : 'itens'}` }),
    ]));

    const list = el('div', { class: 'item-list stagger', role: 'list' });
    items.forEach((it) => list.appendChild(renderItem(it, { onChange: rerender })));
    wrap.appendChild(list);
    groups.appendChild(wrap);
  };

  section(
    'Passaram da data',
    b.overdue,
    'var(--overdue)',
    b.overdue.length ? 'continuam pendentes, é só escolher uma nova data' : null,
  );

  const hasToday = b.dueToday.length > 0;
  if (hasToday) {
    const withPeriods = PERIOD_ORDER.filter((p) => b.byPeriod[p].length);
    const singleGroup = withPeriods.length === 1 && withPeriods[0] === 'any';

    if (singleGroup) {
      section('Para hoje', b.byPeriod.any, 'var(--accent)');
    } else {
      withPeriods.forEach((p) => {
        section(PERIOD_TITLES[p], b.byPeriod[p], p === 'any' ? 'var(--text-3)' : 'var(--accent)');
      });
    }
  }

  section('Merece atenção', b.highPriority, 'var(--danger)', 'prioridade alta com outra data');

  section('Capturado agora há pouco', b.recent, 'var(--cyan)');

  section('Sem prazo', b.undated, 'var(--text-3)');

  if (!groups.children.length) {
    const finishedToday = store.live.some(
      (i) => i.status === 'done' && i.completedAt &&
        i.completedAt.slice(0, 10) === toISODate(todayIn(tz)),
    );
    if (finishedToday && !root.dataset.celebrated) {
      root.dataset.celebrated = 'true';
      setTimeout(celebrate, 320);
    }

    groups.appendChild(el('div', { class: 'empty anim-fade' }, [
      el('div', { class: 'empty__glyph', html: icon('target', 26) }),
      el('p', { class: 'empty__title', text: 'Nada exige sua atenção agora' }),
      el('p', {
        class: 'empty__text',
        text: 'Esta tela mostra o que vence hoje, o que passou da data e o que você acabou de registrar. Escreva uma frase acima e ela aparece aqui.',
      }),
      el('button', {
        class: 'btn btn--outline btn--sm',
        html: icon('bolt', 15) + 'Escrever alguma coisa',
        onClick: () => capture.focusInput(),
      }),
    ]));
  }

  const today = toISODate(todayIn(tz));
  const upcoming = store.live
    .filter((i) => i.status === 'pending' && i.dueDate && i.dueDate > today && !shown.has(i.id))
    .sort((a, b2) => a.dueDate.localeCompare(b2.dueDate))
    .slice(0, 5);

  if (upcoming.length) {
    const wrap = el('div', { class: 'item-group', style: { '--group-color': 'var(--text-3)' } });
    wrap.appendChild(el('div', { class: 'group-head' }, [
      el('h2', { class: 'group-head__title', text: 'Depois de hoje' }),
      el('span', { class: 'group-head__meta', text: 'os próximos' }),
    ]));

    const list = el('div', { class: 'item-list', role: 'list' });
    upcoming.forEach((it) => {
      const row = renderItem(it, { onChange: rerender });
      row.style.opacity = '.72';
      list.appendChild(row);
    });
    wrap.appendChild(list);
    groups.appendChild(wrap);
  }
}

function environmentHero(env, stats, { onEditEnvironment, onNavigate }) {
  const canvas = el('canvas', { class: 'env-hero__canvas', 'aria-hidden': 'true' });
  const kickerIcon = el('span', { class: 'env-hero__kicker-icon', html: icon(env.icon, 13) });
  const title = el('h1', { class: 'env-hero__title', text: env.name });
  const description = el('p', {
    class: 'env-hero__desc',
    text: env.description || 'Tudo o que pertence a este contexto fica reunido aqui.',
  });
  let actions = { onEditEnvironment, onNavigate };

  const number = (value, label, modifier) =>
    el('div', { class: 'env-hero__stat' + (modifier ? ' env-hero__stat--' + modifier : '') }, [
      el('span', { class: 'env-hero__stat-n', text: String(value) }),
      el('span', { class: 'env-hero__stat-l', text: label }),
    ]);

  const statsRow = el('div', { class: 'env-hero__stats' });

  let lastDone = stats.done;

  const paintStats = (s) => {
    const doneCell = number(s.done, 'concluídos');
    statsRow.replaceChildren(
      number(s.pending, 'pendentes'),
      s.overdue ? number(s.overdue, 'atrasados', 'overdue') : number(s.today, 'para hoje'),
      doneCell,
    );
    if (s.done > lastDone) bumpBadge(doneCell.firstChild);
    lastDone = s.done;
  };
  paintStats(stats);

  const hero = el('section', {
    class: 'env-hero',
    style: { '--env-color': env.color },
  }, [
    el('div', { class: 'env-hero__stage' }, [
      canvas,
      el('span', { class: 'env-hero__aura', 'aria-hidden': 'true' }),
    ]),

    el('div', { class: 'env-hero__body' }, [
      el('span', { class: 'env-hero__kicker' }, [
        kickerIcon,
        el('span', { text: 'Ambiente' }),
      ]),
      title,
      description,
      statsRow,
      el('div', { class: 'env-hero__actions' }, [
        el('button', {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          html: icon('edit', 15) + 'Editar ambiente',
          onClick: () => actions.onEditEnvironment?.(store.environmentById(env.id) || env),
        }),
        el('button', {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          html: icon('layers', 15) + 'Todos os ambientes',
          onClick: () => actions.onNavigate?.('environments'),
        }),
      ]),
    ]),

    el('span', {
      class: 'env-hero__hint',
      'aria-hidden': 'true',
      text: device.touch ? 'arraste a peça' : 'mova o ponteiro · arraste para girar',
    }),
  ]);

  hero.dataset.env = env.id;
  hero.dataset.look = env.color + '·' + env.icon;
  hero.dataset.alive = 'pending';
  hero.updateStats = paintStats;
  hero.updateActions = (next) => { actions = next; };
  hero.updateEnvironment = (next) => {
    title.textContent = next.name;
    description.textContent = next.description || 'Tudo o que pertence a este contexto fica reunido aqui.';
    kickerIcon.innerHTML = icon(next.icon, 13);
    hero.style.setProperty('--env-color', next.color);
  };

  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;
    mountEnvHero(canvas, {
      color: env.color,
      icon: env.icon,
      energy: Math.min(1, (stats.pending + stats.overdue * 2) / 14),
    });
  });

  return hero;
}

function keepEnvironmentHero(root, env, stats, options) {
  const cached = root.__envHero;
  const look = env.color + '·' + env.icon;

  if (cached &&
      cached.dataset.env === env.id &&
      cached.dataset.look === look &&
      cached.dataset.alive) {
    cached.updateEnvironment?.(env);
    cached.updateStats(stats);
    cached.updateActions?.(options);
    return cached;
  }

  if (cached) clearEnvHeroes();

  const fresh = environmentHero(env, stats, options);
  root.__envHero = fresh;
  return fresh;
}

export function renderEnvironment(root, envId, { onNavigate, onEditEnvironment }) {
  const rerender = () => renderEnvironment(root, envId, { onNavigate, onEditEnvironment });
  const env = store.environmentById(envId);

  root.captureBox?.stopVoice?.();
  root.captureBox = null;
  root.replaceChildren();

  if (!env) {
    root.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__glyph', html: icon('alert', 24) }),
      el('p', { class: 'empty__title', text: 'Ambiente não encontrado' }),
      el('button', {
        class: 'btn btn--outline btn--sm',
        text: 'Ver ambientes',
        onClick: () => onNavigate('environments'),
      }),
    ]));
    return;
  }

  const stats = store.environmentStats(envId);

  root.appendChild(keepEnvironmentHero(root, env, stats, { onEditEnvironment, onNavigate }));

  const capture = createCapture({ environmentId: envId, onCreated: rerender });
  root.appendChild(capture);
  root.captureBox = capture;

  const state = { filter: root.dataset.filter || 'pending' };
  const filters = el('div', { class: 'filters' });

  [
    ['pending', 'Pendentes'],
    ['overdue', 'Atrasados'],
    ['undated', 'Sem prazo'],
    ['done', 'Concluídos'],
    ['all', 'Tudo'],
  ].forEach(([key, label]) => {
    const chip = el('button', {
      class: 'chip chip--interactive',
      'aria-pressed': String(state.filter === key),
      text: label,
      onClick: () => { root.dataset.filter = key; rerender(); },
    });
    filters.appendChild(chip);
  });
  root.appendChild(filters);

  const today = toISODate(todayIn(store.state.prefs.timezone));
  let items = store.live.filter((i) => i.environmentId === envId);

  if (state.filter === 'pending') items = items.filter((i) => i.status === 'pending');
  else if (state.filter === 'overdue') items = items.filter((i) => i.status === 'pending' && i.dueDate && i.dueDate < today);
  else if (state.filter === 'undated') items = items.filter((i) => i.status === 'pending' && !i.dueDate);
  else if (state.filter === 'done') items = items.filter((i) => i.status === 'done');

  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return b.createdAt.localeCompare(a.createdAt);
  });

  if (!items.length) {
    root.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__glyph', html: icon(env.icon, 24) }),
      el('p', { class: 'empty__title', text: 'Nada por aqui' }),
      el('p', { class: 'empty__text', text: 'Use a caixa acima para registrar algo neste ambiente.' }),
    ]));
    return;
  }

  const list = el('div', { class: 'item-list stagger', role: 'list' });
  items.forEach((it) => list.appendChild(renderItem(it, { onChange: rerender, showEnvironment: false })));
  root.appendChild(list);
}
