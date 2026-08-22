/* =====================================================================
   NESTRA — Tela "Hoje" (§7.2)

   A hierarquia é a recomendada no documento:
     1. Atrasados — sinalização clara, sem tom punitivo
     2. Para hoje — agrupados por período quando houver
     3. Alta prioridade — quando não estiverem acima
     4. Capturas recentes — o que a pessoa acabou de registrar
   ===================================================================== */

import { store } from '../store.js';
import { el, icon } from '../ui.js';
import { renderItem } from './items.js';
import { createCapture } from './capture.js';
import { humanDate, todayIn, toISODate } from '../nlp.js';
import { celebrate, bumpBadge } from '../../gfx/interactions.js';
import { mountEnvHero, clearEnvHeroes } from '../../gfx/envhero.js';
import { Logo3D } from '../../gfx/logo3d.js';
import { device, glBudget } from '../../core/device.js';

/** Anel de progresso do dia — quanto do que vencia hoje já saiu da frente. */
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

/* ---------------------------------------------------------------------
   ABERTURA DA TELA HOJE — a marca do Nestra em três dimensões

   A logo aqui não é um PNG com sombra: é o arquivo original convertido em
   campo de distância e extrudado por ray marching, então a silhueta em 3D
   é exatamente a silhueta do desenho, com relevo, chanfro e brilho de
   borda. Ela acompanha o ponteiro e gira devagar sozinha.

   Ao lado, o retrato do dia em uma frase: quem é você, que dia é hoje e
   quanto ainda pede atenção.
   --------------------------------------------------------------------- */

let brand = null;                       // instância viva do Logo3D
const brandToken = { id: 'today-brand' };

/** Desmonta a marca da tela Hoje e devolve a vaga de contexto WebGL. */
export function clearTodayBrand() {
  if (!brand) return;
  brand.destroy();
  glBudget.release(brandToken);
  brand = null;
}

/** Uma frase que resume o dia, em vez de só repetir os números. */
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

  const paint = (data) => {
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
      el('h1', { class: 'today-hero__title grad-text', text: greeting(store.state.user?.displayName) }),
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

  // O canvas precisa estar no documento para ter tamanho medido
  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;

    // Sem vaga de contexto (ou com menos movimento pedido), o plano B em
    // CSS empilha a própria imagem em profundidade — continua com volume.
    const roomy = !device.reducedMotion && glBudget.claim(brandToken);

    brand = new Logo3D(canvas, {
      src: window.nestraLogoSrc || 'assets/logo/nestra-mark.png',
      // Mais espessura = mais leitura de totem, sem custar nitidez
      depth: 0.36,
      bevel: 0.032,
      /* Brilho contido de propósito. Esta é a peça em que a marca precisa
         estar legível — as hachuras, as estrelinhas, o nome. Glow alto
         aqui competia com o próprio desenho. */
      glow: 0.30,
      // A câmera fica mais perto: a marca é o assunto desta abertura,
      // não um selo no canto.
      zoom: 1.34,
      autoSpin: 0.3,
      colorSide: 1600,
      sdfSide: 620,
      interactive: true,
      sharp: true,           // pede mais pixels: o desenho tem detalhe fino
      forceFallback: !roomy,
    });

    brand.init().then((ok) => {
      hero.dataset.alive = ok ? 'gl' : 'css';
      if (!ok && roomy) glBudget.release(brandToken);
    });
  });

  return hero;
}

/**
 * Reaproveita a marca já montada.
 *
 * A tela Hoje se redesenha a cada item concluído, adiado ou capturado.
 * Reconstruir a marca junto significaria refazer o campo de distância e
 * abrir um contexto WebGL novo a cada clique — caro e, pior, visível: a
 * marca piscaria o tempo todo. Aqui o mesmo nó volta para a tela, só com
 * os números do dia atualizados.
 */
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

  // Um re-render também é uma saída da captura anterior.
  root.captureBox?.stopVoice?.();
  root.captureBox = null;
  root.replaceChildren();

  const dayTotal = b.dueToday.length + b.overdue.length;
  const dayDone = b.dueToday.filter((i) => i.status === 'done').length;

  /* Abertura: a marca em 3D e o retrato do dia */
  root.appendChild(keepTodayHero(root, { b, dayTotal, dayDone, onNavigate }));

  /* Captura rápida */
  const capture = createCapture({ onCreated: rerender });
  root.appendChild(capture);
  root.captureBox = capture;

  const groups = el('div', {});
  root.appendChild(groups);

  /** Ids já desenhados: nenhum item aparece duas vezes na mesma tela. */
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

  /* 1. Atrasados — sinalizados, nunca culpabilizadores (§22) */
  section(
    'Passaram da data',
    b.overdue,
    'var(--overdue)',
    b.overdue.length ? 'continuam pendentes, é só escolher uma nova data' : null,
  );

  /* 2. Para hoje, por período */
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

  /* 3. Alta prioridade fora da data de hoje */
  section('Merece atenção', b.highPriority, 'var(--danger)', 'prioridade alta com outra data');

  /* 4. Capturas recentes */
  section('Capturado agora há pouco', b.recent, 'var(--cyan)');

  /* 5. Sem prazo — opcional (§21) */
  section('Sem prazo', b.undated, 'var(--text-3)');

  /* Vazio */
  if (!groups.children.length) {
    // Terminou o dia com coisas concluídas? vale uma comemoração curta.
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

  /* Próximos dias — respeita o futuro sem trazer para o presente */
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

/* ---------------------------------------------------------------------
   Abertura da tela de ambiente

   A peça em 3D não é enfeite solto: a forma vem do ícone, a cor vem do
   ambiente e o brilho interno vem de quanta coisa está pendente ali. Em
   volta dela ficam o nome, a descrição e os números do ambiente.
   --------------------------------------------------------------------- */
function environmentHero(env, stats, { onEditEnvironment, onNavigate }) {
  const canvas = el('canvas', { class: 'env-hero__canvas', 'aria-hidden': 'true' });
  const kickerIcon = el('span', { class: 'env-hero__kicker-icon', html: icon(env.icon, 13) });
  const title = el('h1', { class: 'env-hero__title', text: env.name });
  const description = el('p', {
    class: 'env-hero__desc',
    text: env.description || 'Tudo o que pertence a este contexto fica reunido aqui.',
  });

  const number = (value, label, modifier) =>
    el('div', { class: 'env-hero__stat' + (modifier ? ' env-hero__stat--' + modifier : '') }, [
      el('span', { class: 'env-hero__stat-n', text: String(value) }),
      el('span', { class: 'env-hero__stat-l', text: label }),
    ]);

  const statsRow = el('div', { class: 'env-hero__stats' });

  /* O número de concluídos é o placar do ambiente. Quando ele sobe, o
     número pulsa: quem acabou de marcar um item vê onde a conta foi
     parar, em vez de ter que procurar a diferença na tela. */
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
          html: icon('edit', 15) + 'Editar ambiente',
          onClick: () => onEditEnvironment?.(env),
        }),
        el('a', {
          class: 'btn btn--ghost btn--sm',
          href: '#/ambientes',
          html: icon('layers', 15) + 'Todos os ambientes',
          onClick: (ev) => {
            ev.preventDefault();
            onNavigate?.('environments');
          },
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
  hero.updateEnvironment = (next) => {
    title.textContent = next.name;
    description.textContent = next.description || 'Tudo o que pertence a este contexto fica reunido aqui.';
    kickerIcon.innerHTML = icon(next.icon, 13);
    hero.style.setProperty('--env-color', next.color);
  };

  // O canvas precisa estar no documento para ter tamanho medido
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

/**
 * Reaproveita a peça já montada.
 *
 * Marcar um item como concluído redesenha a tela inteira. Se a abertura
 * fosse reconstruída junto, cada clique jogaria fora um contexto WebGL e
 * abriria outro — o caminho mais curto para o navegador começar a
 * descartar contextos e a peça sumir. Aqui o mesmo nó volta para a tela,
 * com os números atualizados; só a troca de ambiente (ou de cor e ícone)
 * constrói uma peça nova.
 */
function keepEnvironmentHero(root, env, stats, options) {
  const cached = root.__envHero;
  const look = env.color + '·' + env.icon;

  if (cached &&
      cached.dataset.env === env.id &&
      cached.dataset.look === look &&
      cached.dataset.alive) {
    cached.updateEnvironment?.(env);
    cached.updateStats(stats);
    return cached;
  }

  // Trocou de ambiente: a peça anterior sai antes, senão as duas
  // disputam a mesma vaga de contexto WebGL e a nova cai no plano B.
  if (cached) clearEnvHeroes();

  const fresh = environmentHero(env, stats, options);
  root.__envHero = fresh;
  return fresh;
}

/* ---------------------------------------------------------------------
   Tela de um ambiente (§7.3)
   --------------------------------------------------------------------- */
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

  /* Filtros básicos */
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
