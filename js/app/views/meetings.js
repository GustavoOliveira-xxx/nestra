import { store, shiftDay, weekdayOf } from '../store.js';
import { api } from '../api.js';
import { el, icon, esc, toast, openModal, confirmDialog, COLOR_CHOICES } from '../ui.js';
import { VoiceCapture, voiceSupported, tidySpeech } from '../voice.js';
import { completionEffect } from '../../gfx/complete.js';
import {
  KIND_META, KIND_ORDER, TEMPLATES, planTopics, summarize, carryOver, relatedItems, recentWins,
  skeletonFor, rootOf, childrenOf, makeNode, addTopics, removeNode, progress, todayISO, dueFrom, actionTitle,
} from '../copilot.js';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function weekdaysLabel(days) {
  const set = [...days].sort().join(',');
  if (set === '1,2,3,4,5') return 'Dias úteis';
  if (set === '0,1,2,3,4,5,6') return 'Todos os dias';
  if (!days.length) return 'Sem dia fixo';
  return [...days].sort().map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(' · ');
}

function dayLabel(iso) {
  const today = todayISO();
  if (iso === today) return 'Hoje';
  if (iso === shiftDay(today, 1)) return 'Amanhã';
  if (iso === shiftDay(today, -1)) return 'Ontem';
  const label = new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function endTime(meeting) {
  if (!meeting.startTime) return null;
  const [h, m] = meeting.startTime.split(':').map(Number);
  const total = h * 60 + m + (meeting.durationMinutes || 15);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function prepState(meeting, iso) {
  const agenda = store.agendaFor(meeting.id, iso);
  const p = agenda ? progress(agenda) : { done: 0, total: 0 };
  if (agenda?.endedAt) return { key: 'done', label: `Concluída · ${p.done} de ${p.total} falados`, p };
  if (agenda?.startedAt) return { key: 'live', label: `Em andamento · ${p.done} de ${p.total}`, p };
  if (p.total) return { key: 'ready', label: `Pauta pronta · ${p.total} ${p.total === 1 ? 'tópico' : 'tópicos'}`, p };
  return { key: 'empty', label: 'Sem pauta ainda', p };
}

export function unpreparedToday() {
  const iso = todayISO();
  return store.meetingsOn(iso).filter((m) => prepState(m, iso).key === 'empty').length;
}

const meetingHref = (id, iso) => `#/reuniao/${id}${iso ? '/' + iso : ''}`;

export function todayMeetingsStrip({ onNavigate, compact = false } = {}) {
  const iso = todayISO();
  const meetings = store.meetingsOn(iso);
  if (!meetings.length) return null;

  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  const cards = meetings.map((m) => {
    const state = prepState(m, iso);
    const [h, mi] = (m.startTime || '00:00').split(':').map(Number);
    const start = h * 60 + mi;
    const live = m.startTime && minutesNow >= start - 5 && minutesNow <= start + (m.durationMinutes || 15);
    const soon = m.startTime && !live && start > minutesNow && start - minutesNow <= 60;

    return el('button', {
      class: 'mtg-today__card',
      type: 'button',
      style: { '--mtg-color': m.color },
      dataset: { state: state.key, live: String(Boolean(live)) },
      onClick: () => onNavigate('meeting', m.id),
    }, [
      el('span', { class: 'mtg-today__time', text: m.startTime || '--:--' }),
      el('span', { class: 'mtg-today__body' }, [
        el('span', { class: 'mtg-today__title', text: m.title }),
        el('span', { class: 'mtg-today__state', text: live ? 'Acontecendo agora' : soon ? `Começa em ${start - minutesNow} min` : state.label }),
      ]),
      el('span', {
        class: 'mtg-today__cta',
        html: icon(state.key === 'empty' ? 'bolt' : state.key === 'done' ? 'list' : 'target', 15) +
          `<span>${state.key === 'empty' ? 'Preparar' : state.key === 'done' ? 'Ver ata' : 'Abrir mapa'}</span>`,
      }),
    ]);
  });

  return el('section', { class: 'mtg-today' + (compact ? ' mtg-today--compact' : '') }, [
    el('div', { class: 'group-head' }, [
      el('h2', { class: 'group-head__title', text: 'Reuniões de hoje' }),
      el('span', { class: 'group-head__meta', text: `${meetings.length} ${meetings.length === 1 ? 'reunião' : 'reuniões'}` }),
    ]),
    el('div', { class: 'mtg-today__list' }, cards),
  ]);
}

export function renderMeetings(root, { onNavigate }) {
  const rerender = () => renderMeetings(root, { onNavigate });
  root.replaceChildren();

  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [
      el('h1', { class: 'view-title', text: 'Reuniões' }),
      el('p', {
        class: 'view-sub',
        text: 'Despeje o que precisa falar, o copiloto monta o mapa. Na reunião, toque em cada balão conforme fala. No fim, a ata sai pronta.',
      }),
    ]),
    el('button', {
      class: 'btn btn--primary btn--sm',
      html: icon('plus', 15) + 'Nova reunião',
      onClick: () => openMeetingForm(null, (m) => m && onNavigate('meeting', m.id)),
    }),
  ]));

  const meetings = store.activeMeetings;

  if (!meetings.length) {
    root.appendChild(el('div', { class: 'mtg-empty anim-fade' }, [
      el('div', { class: 'mtg-empty__map', 'aria-hidden': 'true', html: emptyMapArt() }),
      el('div', { class: 'mtg-empty__body' }, [
        el('p', { class: 'empty__title', text: 'Cadastre sua agenda fixa' }),
        el('p', {
          class: 'empty__text',
          text: 'Daily, 1:1, revisão de sprint. Cada reunião ganha uma pauta por dia, em forma de mapa mental, que você prepara em um minuto e acompanha durante a conversa.',
        }),
        el('div', { class: 'row gap-2', style: { flexWrap: 'wrap', justifyContent: 'center' } }, [
          el('button', {
            class: 'btn btn--primary btn--sm',
            html: icon('bolt', 15) + 'Criar minha daily',
            onClick: () => {
              const m = store.saveMeeting({
                title: 'Daily', template: 'daily', weekdays: [1, 2, 3, 4, 5],
                startTime: '09:30', durationMinutes: 15, color: '#2F6BFF',
                environmentId: store.activeEnvironments.find((e) => /trabalho/i.test(e.name))?.id || null,
              });
              toast('Daily criada para dias úteis às 09:30. Ajuste quando quiser.', { kind: 'success' });
              onNavigate('meeting', m.id);
            },
          }),
          el('button', {
            class: 'btn btn--outline btn--sm',
            html: icon('plus', 15) + 'Outra reunião',
            onClick: () => openMeetingForm(null, (m) => m && onNavigate('meeting', m.id)),
          }),
        ]),
      ]),
    ]));
    return;
  }

  const strip = todayMeetingsStrip({ onNavigate });
  if (strip) root.appendChild(strip);

  const today = todayISO();
  const week = el('div', { class: 'mtg-week' });
  for (let i = 0; i < 7; i++) {
    const iso = shiftDay(today, i);
    const list = store.meetingsOn(iso);
    week.appendChild(el('div', { class: 'mtg-week__day', dataset: { today: String(i === 0) } }, [
      el('span', { class: 'mtg-week__name', text: i === 0 ? 'Hoje' : WEEKDAY_NAMES[weekdayOf(iso)].slice(0, 3) }),
      el('span', { class: 'mtg-week__date', text: iso.slice(8, 10) }),
      el('span', { class: 'mtg-week__dots' }, list.map((m) => el('a', {
        class: 'mtg-week__dot',
        href: meetingHref(m.id, iso),
        title: `${m.title}${m.startTime ? ' às ' + m.startTime : ''}`,
        'aria-label': `${m.title} em ${dayLabel(iso)}`,
        style: { '--mtg-color': m.color },
        dataset: { state: prepState(m, iso).key },
      }))),
    ]));
  }
  root.appendChild(el('section', { class: 'item-group' }, [
    el('div', { class: 'group-head' }, [
      el('h2', { class: 'group-head__title', text: 'Próximos 7 dias' }),
      el('span', { class: 'group-head__meta', text: 'ponto cheio = pauta pronta' }),
    ]),
    week,
  ]));

  const grid = el('div', { class: 'mtg-grid stagger' });
  meetings.forEach((m) => {
    const next = store.nextOccurrence(m, today);
    const state = prepState(m, next);
    const env = m.environmentId ? store.environmentById(m.environmentId) : null;
    const history = store.agendasOf(m.id).filter((a) => a.endedAt).length;

    grid.appendChild(el('article', { class: 'mtg-card', style: { '--mtg-color': m.color } }, [
      el('a', { class: 'mtg-card__open', href: meetingHref(m.id), 'aria-label': `Abrir ${m.title}` }),
      el('div', { class: 'mtg-card__top' }, [
        el('span', { class: 'mtg-card__badge', text: TEMPLATES[m.template]?.label || 'Livre' }),
        el('button', {
          class: 'btn btn--ghost btn--icon btn--sm mtg-card__edit',
          type: 'button',
          'aria-label': `Editar ${m.title}`,
          html: icon('settings', 15),
          onClick: () => openMeetingForm(m, rerender),
        }),
      ]),
      el('h3', { class: 'mtg-card__title', text: m.title }),
      el('p', {
        class: 'mtg-card__when',
        text: `${weekdaysLabel(m.weekdays)}${m.startTime ? ' · ' + m.startTime + '–' + endTime(m) : ''}`,
      }),
      el('div', { class: 'mtg-card__foot' }, [
        el('span', { class: 'mtg-card__next' }, [
          el('b', { text: dayLabel(next) }),
          el('span', { text: state.label }),
        ]),
        env ? el('span', { class: 'chip', style: { borderColor: env.color, color: env.color }, html: icon(env.icon, 12) + `<span>${esc(env.name)}</span>` }) : null,
        history ? el('span', { class: 'text-dim mtg-card__hist', text: `${history} ${history === 1 ? 'ata' : 'atas'}` }) : null,
      ]),
    ]));
  });
  grid.appendChild(el('button', {
    class: 'mtg-card mtg-card--new',
    type: 'button',
    onClick: () => openMeetingForm(null, (m) => m && onNavigate('meeting', m.id)),
  }, [
    el('span', { html: icon('plus', 22) }),
    el('span', { class: 'mtg-card__title', text: 'Nova reunião' }),
    el('span', { class: 'text-dim', style: { fontSize: 'var(--fs-xs)' }, text: 'Daily, 1:1, revisão, planejamento…' }),
  ]));

  root.appendChild(el('section', { class: 'item-group' }, [
    el('div', { class: 'group-head' }, [
      el('h2', { class: 'group-head__title', text: 'Sua agenda fixa' }),
      el('span', { class: 'group-head__meta', text: `${meetings.length}` }),
    ]),
    grid,
  ]));
}

function emptyMapArt() {
  const balloons = [
    [150, 40, '#3ED9A4'], [262, 92, '#4FD8FF'], [240, 196, '#FF5F6B'],
    [60, 196, '#FFC96B'], [38, 92, '#9B7BFF'],
  ];
  return `<svg viewBox="0 0 300 236" width="300" height="236">
    ${balloons.map(([x, y]) => `<path d="M150 124 Q ${(150 + x) / 2} ${(124 + y) / 2 - 18} ${x} ${y}" stroke="var(--line-hi)" stroke-width="1.5" fill="none"/>`).join('')}
    <rect x="104" y="106" width="92" height="36" rx="10" fill="var(--accent-soft)" stroke="var(--accent-line)"/>
    <rect x="122" y="121" width="56" height="6" rx="3" fill="var(--blue-200)"/>
    ${balloons.map(([x, y, c], i) => `<g class="mtg-empty__b" style="animation-delay:${i * 0.18}s">
      <rect x="${x - 40}" y="${y - 15}" width="80" height="30" rx="9" fill="var(--surface-2)" stroke="${c}"/>
      <rect x="${x - 26}" y="${y - 3}" width="44" height="5" rx="2.5" fill="${c}" opacity=".7"/>
      <circle cx="${x + 28}" cy="${y}" r="5" fill="none" stroke="${c}"/></g>`).join('')}
  </svg>`;
}

export function openMeetingForm(meeting, onDone) {
  const isNew = !meeting;
  const data = {
    title: meeting?.title || '',
    template: meeting?.template || 'daily',
    weekdays: [...(meeting?.weekdays || [1, 2, 3, 4, 5])],
    startTime: meeting?.startTime || '09:30',
    durationMinutes: meeting?.durationMinutes || 15,
    color: meeting?.color || '#2F6BFF',
    environmentId: meeting ? meeting.environmentId : (store.activeEnvironments.find((e) => /trabalho/i.test(e.name))?.id || null),
  };

  const title = el('input', {
    class: 'input', name: 'title', maxlength: '80', required: true,
    placeholder: 'Daily do time, 1:1 com a Ana, Revisão de sprint…',
    value: data.title,
  });

  const templates = el('div', { class: 'mtg-form__templates', role: 'radiogroup', 'aria-label': 'Formato' });
  const paintTemplates = () => {
    templates.replaceChildren(...Object.entries(TEMPLATES).map(([key, t]) => el('button', {
      type: 'button',
      class: 'mtg-form__template',
      role: 'radio',
      'aria-checked': String(data.template === key),
      onClick: () => {
        data.template = key;
        if (!title.value.trim() || Object.values(TEMPLATES).some((x) => x.label === title.value.trim())) {
          title.value = key === 'free' ? '' : t.label;
        }
        if (key === 'daily') data.durationMinutes = 15;
        if (key === 'one_on_one') data.durationMinutes = 30;
        if (key === 'review') data.durationMinutes = 60;
        duration.value = String(data.durationMinutes);
        paintTemplates();
      },
    }, [el('b', { text: t.label }), el('span', { text: t.hint })])));
  };
  paintTemplates();

  const days = el('div', { class: 'mtg-form__days', role: 'group', 'aria-label': 'Dias da semana' });
  const paintDays = () => {
    days.replaceChildren(...WEEKDAYS.map((letter, d) => el('button', {
      type: 'button',
      class: 'mtg-form__day',
      'aria-pressed': String(data.weekdays.includes(d)),
      'aria-label': WEEKDAY_NAMES[d],
      text: letter,
      onClick: () => {
        data.weekdays = data.weekdays.includes(d) ? data.weekdays.filter((x) => x !== d) : [...data.weekdays, d];
        paintDays();
      },
    })));
  };
  paintDays();

  const time = el('input', { class: 'input', type: 'time', value: data.startTime, 'aria-label': 'Horário' });
  const duration = el('select', { class: 'select', 'aria-label': 'Duração' },
    [5, 10, 15, 20, 30, 45, 60, 90, 120].map((n) => el('option', {
      value: String(n), text: n < 60 ? `${n} min` : `${n / 60} h`.replace('.5', ',5'),
      selected: n === data.durationMinutes ? true : null,
    })));

  const envSelect = el('select', { class: 'select', 'aria-label': 'Ambiente' }, [
    el('option', { value: '', text: 'Nenhum' }),
    ...store.activeEnvironments.map((e) => el('option', {
      value: e.id, text: e.name, selected: e.id === data.environmentId ? true : null,
    })),
  ]);

  const colors = el('div', { class: 'color-picker' });
  const paintColors = () => {
    colors.replaceChildren(...COLOR_CHOICES.map((c) => el('button', {
      type: 'button',
      class: 'color-dot',
      style: { '--c': c },
      'aria-label': 'Cor ' + c,
      'aria-pressed': String(c === data.color),
      onClick: () => { data.color = c; paintColors(); },
    })));
  };
  paintColors();

  const error = el('p', { class: 'field__error', style: { display: 'none' } });

  const body = el('div', { class: 'stack gap-4 mtg-form' }, [
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Nome' }), title]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Formato' }), templates]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Quando acontece' }), days]),
    el('div', { class: 'mtg-form__row' }, [
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Horário' }), time]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Duração' }), duration]),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Ambiente ligado' }),
      envSelect,
      el('span', { class: 'field__hint', text: 'O copiloto sugere os itens desse ambiente que vencem no dia, e as tarefas que saírem da reunião vão para ele.' }),
    ]),
    el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Cor' }), colors]),
    error,
  ]);

  const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancelar' });
  const save = el('button', { class: 'btn btn--primary', type: 'button', text: isNew ? 'Criar reunião' : 'Salvar' });
  const footer = [cancel, save];

  if (!isNew) {
    footer.unshift(el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      style: { marginRight: 'auto', color: 'var(--danger)' },
      html: icon('archive', 15) + 'Arquivar',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Arquivar reunião',
          message: `"${meeting.title}" sai da agenda. As atas já feitas continuam guardadas.`,
          confirmLabel: 'Arquivar',
        });
        if (!ok) return;
        store.archiveMeeting(meeting.id);
        dialog.close();
        toast('Reunião arquivada.');
        location.hash = '#/reunioes';
      },
    }));
  }

  const dialog = openModal({ title: isNew ? 'Nova reunião' : 'Editar reunião', body, footer, wide: true });
  cancel.addEventListener('click', () => dialog.close());
  save.addEventListener('click', () => {
    const name = title.value.trim();
    if (!name) {
      error.textContent = 'Dê um nome para a reunião.';
      error.style.display = 'flex';
      title.focus();
      return;
    }
    if (!data.weekdays.length) {
      error.textContent = 'Escolha pelo menos um dia da semana.';
      error.style.display = 'flex';
      return;
    }
    const saved = store.saveMeeting({
      ...(meeting ? { id: meeting.id } : {}),
      ...data,
      title: name,
      startTime: time.value || null,
      durationMinutes: Number(duration.value),
      environmentId: envSelect.value || null,
    });
    dialog.close();
    toast(isNew ? 'Reunião criada.' : 'Reunião atualizada.', { kind: 'success' });
    onDone?.(saved);
  });
  setTimeout(() => (isNew ? title.focus() : null), 120);
}

const viewState = new Map();

export function renderMeeting(root, meetingId, isoParam, { onNavigate }) {
  const meeting = store.meetingById(meetingId);
  root.__mtgCleanup?.();
  root.replaceChildren();

  if (!meeting) {
    root.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__glyph', html: icon('alert', 24) }),
      el('p', { class: 'empty__title', text: 'Reunião não encontrada' }),
      el('button', { class: 'btn btn--outline btn--sm', text: 'Ver reuniões', onClick: () => onNavigate('meetings') }),
    ]));
    return;
  }

  const today = todayISO();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(isoParam || '') ? isoParam : store.nextOccurrence(meeting, today);
  const key = meeting.id + ':' + iso;
  const agenda = store.openAgenda(meeting.id, iso);
  const vs = viewState.get(key) || {
    mode: agenda.endedAt ? 'minutes' : agenda.startedAt ? 'live' : 'prep',
    selected: null,
  };
  viewState.set(key, vs);

  const rerender = () => renderMeeting(root, meetingId, iso, { onNavigate });
  const timers = [];
  const cleanups = [];
  root.__mtgCleanup = () => {
    timers.forEach(clearInterval);
    cleanups.forEach((fn) => fn());
    root.__mtgCleanup = null;
  };

  let saveTimer = 0;
  const save = (now = false) => {
    clearTimeout(saveTimer);
    const run = () => store.saveAgenda(agenda);
    if (now) run(); else saveTimer = setTimeout(run, 350);
  };
  cleanups.push(() => { if (saveTimer) { clearTimeout(saveTimer); store.saveAgenda(agenda); } });

  const env = meeting.environmentId ? store.environmentById(meeting.environmentId) : null;

  const prev = store.previousOccurrence(meeting, iso);
  const next = store.nextOccurrence(meeting, shiftDay(iso, 1));

  const modeTabs = el('div', { class: 'segmented mtg-modes', role: 'tablist', 'aria-label': 'Etapa' },
    [['prep', 'Preparar', 'bolt'], ['live', 'Na reunião', 'target'], ['minutes', 'Ata', 'list']].map(([m, label, ic]) =>
      el('button', {
        class: 'segmented__opt',
        role: 'tab',
        'aria-selected': String(vs.mode === m),
        html: icon(ic, 14) + `<span>${label}</span>`,
        onClick: () => {
          if (m === 'live' && !agenda.startedAt) {
            agenda.startedAt = new Date().toISOString();
            save(true);
          }
          vs.mode = m;
          rerender();
        },
      })));

  root.appendChild(el('header', { class: 'mtg-head', style: { '--mtg-color': meeting.color } }, [
    el('div', { class: 'mtg-head__left' }, [
      el('a', { class: 'mtg-head__back', href: '#/reunioes', html: icon('chevron', 14) + '<span>Reuniões</span>' }),
      el('div', { class: 'mtg-head__title-row' }, [
        el('h1', { class: 'mtg-head__title', text: meeting.title }),
        el('button', {
          class: 'btn btn--ghost btn--icon btn--sm',
          'aria-label': 'Editar reunião',
          html: icon('settings', 15),
          onClick: () => openMeetingForm(meeting, rerender),
        }),
      ]),
      el('div', { class: 'mtg-head__meta' }, [
        el('span', { class: 'mtg-head__badge', text: TEMPLATES[meeting.template]?.label || 'Livre' }),
        meeting.startTime ? el('span', { html: icon('clock', 13) + `<span>${meeting.startTime}–${endTime(meeting)}</span>` }) : null,
        env ? el('span', { style: { color: env.color }, html: icon(env.icon, 13) + `<span>${esc(env.name)}</span>` }) : null,
      ]),
    ]),
    el('div', { class: 'mtg-head__right' }, [
      el('div', { class: 'mtg-date' }, [
        el('a', { class: 'btn btn--ghost btn--icon btn--sm mtg-date__prev', href: meetingHref(meeting.id, prev), 'aria-label': 'Ocorrência anterior', html: icon('chevron', 16) }),
        el('span', { class: 'mtg-date__label' }, [
          el('b', { text: dayLabel(iso) }),
          el('small', { text: new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }) }),
        ]),
        el('a', { class: 'btn btn--ghost btn--icon btn--sm', href: meetingHref(meeting.id, next), 'aria-label': 'Próxima ocorrência', html: icon('chevron', 16) }),
      ]),
      modeTabs,
    ]),
  ]));

  const body = el('div', { class: 'mtg-body', dataset: { mode: vs.mode } });
  root.appendChild(body);

  const ctx = { meeting, agenda, iso, vs, save, rerender, timers, cleanups, onNavigate, env };
  if (vs.mode === 'prep') renderPrep(body, ctx);
  else if (vs.mode === 'live') renderLive(body, ctx);
  else renderMinutes(body, ctx);
}

function renderPrep(host, ctx) {
  const { meeting, agenda, iso, vs, save, rerender } = ctx;

  const copilot = el('aside', { class: 'mtg-copilot panel' });
  const mapWrap = el('section', { class: 'mtg-map-panel panel' });
  host.append(copilot, mapWrap);
  host.dataset.filled = String(progress(agenda).total > 0);
  if (vs.scrollToMap) {
    vs.scrollToMap = false;
    setTimeout(() => mapWrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }

  const draft = el('textarea', {
    class: 'textarea mtg-copilot__input',
    rows: '5',
    placeholder: meeting.template === 'daily'
      ? 'Ex.: ontem terminei a tela de relatórios. Hoje sigo com a integração do pagamento. Tô esperando a Maria mandar a chave da API. Avisar que saio mais cedo sexta.'
      : 'Escreva do jeito que vier: assuntos, dúvidas, avisos, o que precisa decidir. Uma ideia por linha ajuda, mas não é obrigatório.',
    'aria-label': 'O que você precisa falar',
  });
  draft.value = vs.draft || '';
  draft.addEventListener('input', () => { vs.draft = draft.value; });

  const build = el('button', { class: 'btn btn--primary', type: 'button', html: icon('sparkle', 16) + 'Montar mapa' });
  const mic = voiceSupported()
    ? el('button', { class: 'btn btn--ghost btn--icon mtg-copilot__mic', type: 'button', 'aria-label': 'Ditar', html: icon('mic', 17) })
    : null;

  const engine = el('span', {
    class: 'mtg-copilot__engine',
    dataset: { ai: String(Boolean(api.ai)) },
    html: api.ai ? icon('sparkle', 12) + '<span>IA conectada</span>' : icon('bolt', 12) + '<span>Assistente local</span>',
    title: api.ai
      ? 'O texto é organizado pelo Claude no servidor do Nestra.'
      : 'O texto é organizado no próprio navegador. Configure ANTHROPIC_API_KEY na Vercel para usar a IA.',
  });

  build.addEventListener('click', async () => {
    const text = draft.value.trim();
    if (!text) { draft.focus(); toast('Escreva ou dite o que precisa falar.'); return; }
    build.disabled = true;
    build.innerHTML = '<span class="mtg-spin"></span>Organizando…';
    const carry = carryOver(meeting, iso).nodes.map((n) => n.text);
    const items = relatedItems(meeting, iso).map((i) => i.title);
    const { topics, source } = await planTopics(text, { meeting, carry, items });
    const added = addTopics(agenda, topics, source);
    save(true);
    vs.draft = '';
    vs.scrollToMap = window.innerWidth < 980;
    toast(added
      ? `${added} ${added === 1 ? 'balão novo' : 'balões novos'} no mapa${source === 'ai' ? ' (IA)' : ''}.`
      : 'Esses assuntos já estavam no mapa.', { kind: added ? 'success' : '' });
    rerender();
  });
  draft.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); build.click(); }
  });

  if (mic) {
    const voice = new VoiceCapture({ lang: store.state.prefs.locale || 'pt-BR', idleMs: 9000, maxMs: 120000 });
    let before = '';
    const paint = (on) => { mic.dataset.on = String(on); mic.setAttribute('aria-pressed', String(on)); };
    voice.addEventListener('start', () => paint(true));
    voice.addEventListener('text', () => {
      const said = tidySpeech(voice.text, { capitalizar: !before });
      draft.value = before ? `${before}\n${said}` : said;
      vs.draft = draft.value;
    });
    voice.addEventListener('error', (ev) => { paint(false); toast(ev.detail.message, { kind: 'error' }); });
    voice.addEventListener('end', () => paint(false));
    mic.addEventListener('click', () => {
      if (voice.running) { voice.stop(); return; }
      before = draft.value.trim();
      voice.reset();
      voice.start();
    });
    ctx.cleanups.push(() => voice.abort());
  }

  copilot.append(
    el('div', { class: 'mtg-copilot__head' }, [
      el('span', { class: 'mtg-copilot__avatar', html: icon('sparkle', 16) }),
      el('div', { class: 'grow' }, [
        el('b', { text: 'Copiloto' }),
        el('small', { text: dayLabel(iso) === 'Hoje' ? 'O que você precisa falar hoje?' : `Pauta de ${dayLabel(iso).toLowerCase()}` }),
      ]),
      engine,
    ]),
    draft,
    el('div', { class: 'mtg-copilot__actions' }, [mic, el('span', { class: 'grow text-dim mtg-copilot__hint', text: 'Ctrl + Enter monta' }), build]),
  );

  const tips = el('div', { class: 'mtg-tips' });
  const tip = (iconName, title, sub, actionLabel, onAction, color) => el('div', { class: 'mtg-tip', style: { '--tip-color': color || 'var(--accent)' } }, [
    el('span', { class: 'mtg-tip__icon', html: icon(iconName, 15) }),
    el('div', { class: 'grow' }, [el('b', { text: title }), sub ? el('small', { text: sub }) : null]),
    el('button', { class: 'btn btn--outline btn--sm', type: 'button', text: actionLabel, onClick: onAction }),
  ]);

  const carry = carryOver(meeting, iso);
  const notCarried = carry.nodes.filter((n) => !agenda.nodes.some((x) => x.text.toLowerCase() === n.text.toLowerCase()));
  if (notCarried.length) {
    tips.appendChild(tip('clockBack',
      `${notCarried.length} ${notCarried.length === 1 ? 'assunto ficou' : 'assuntos ficaram'} de fora em ${dayLabel(carry.from).toLowerCase()}`,
      notCarried.slice(0, 3).map((n) => n.text).join(' · '),
      'Trazer',
      () => {
        addTopics(agenda, notCarried.map((n) => ({
          label: n.text, kind: n.kind, detail: n.detail, who: n.who,
          children: carry.nodes.length ? [] : [],
        })), 'carry');
        save(true);
        rerender();
      }, KIND_META.notice.color));
  }

  const items = relatedItems(meeting, iso).filter((i) => !agenda.nodes.some((n) => n.taskId === i.id));
  if (items.length) {
    tips.appendChild(tip('flag',
      `${items.length} ${items.length === 1 ? 'item' : 'itens'} de ${ctx.env?.name || 'trabalho'} pedem atenção`,
      items.slice(0, 3).map((i) => i.title).join(' · '),
      'Incluir',
      () => {
        const root = rootOf(agenda);
        items.forEach((i) => {
          const overdue = i.dueDate && i.dueDate < iso;
          agenda.nodes.push(makeNode(root.id, {
            label: i.title, kind: overdue ? 'blocker' : 'plan', taskId: i.id, source: 'item',
            detail: overdue ? 'Passou da data no Nestra' : i.dueDate === iso ? 'Vence hoje no Nestra' : 'Prioridade alta no Nestra',
          }));
        });
        save(true);
        rerender();
      }, KIND_META.plan.color));
  }

  const wins = recentWins(meeting, iso).filter((i) => !agenda.nodes.some((n) => n.taskId === i.id));
  if (wins.length) {
    tips.appendChild(tip('check',
      `Você concluiu ${wins.length} ${wins.length === 1 ? 'coisa' : 'coisas'} desde a última`,
      wins.slice(0, 3).map((i) => i.title).join(' · '),
      'Contar',
      () => {
        const root = rootOf(agenda);
        wins.forEach((i) => agenda.nodes.push(makeNode(root.id, { label: i.title, kind: 'update', taskId: i.id, source: 'item' })));
        save(true);
        rerender();
      }, KIND_META.update.color));
  }

  const p = progress(agenda);
  if (!p.total && skeletonFor(meeting.template).length) {
    tips.appendChild(tip('grid', `Começar pela estrutura de ${TEMPLATES[meeting.template].label}`,
      skeletonFor(meeting.template).map((s) => s.label).join(' · '), 'Usar', () => {
        addTopics(agenda, skeletonFor(meeting.template), 'template');
        save(true);
        rerender();
      }));
  }

  if (tips.children.length) {
    copilot.append(el('div', { class: 'mtg-copilot__section', text: 'O copiloto encontrou' }), tips);
  } else if (!p.total) {
    copilot.append(el('p', { class: 'mtg-copilot__empty', text: 'Ligue a reunião a um ambiente para o copiloto trazer itens que vencem e o que você concluiu desde a última vez.' }));
  }

  mapWrap.append(el('div', { class: 'mtg-map-panel__head' }, [
    el('div', { class: 'grow' }, [
      el('b', { text: 'Mapa da reunião' }),
      el('small', { text: p.total ? `${p.total} ${p.total === 1 ? 'balão' : 'balões'} · toque para editar, arraste para mover` : 'Os balões aparecem aqui' }),
    ]),
    el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', html: icon('plus', 14) + 'Tópico',
      onClick: () => {
        const node = makeNode(rootOf(agenda).id, { label: 'Novo tópico', kind: 'topic' });
        agenda.nodes.push(node);
        vs.selected = node.id;
        vs.focusEditor = true;
        save(true);
        rerender();
      },
    }),
    agenda.nodes.some((n) => n.x != null) ? el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', html: icon('refresh', 14) + 'Reorganizar',
      onClick: () => { agenda.nodes.forEach((n) => { n.x = null; n.y = null; }); save(true); rerender(); },
    }) : null,
    p.total ? el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Começar a reunião',
      html: icon('target', 14) + 'Começar',
      onClick: () => {
        if (!agenda.startedAt) agenda.startedAt = new Date().toISOString();
        save(true);
        vs.mode = 'live';
        rerender();
      },
    }) : null,
  ]));

  const map = mindMap(agenda, meeting, {
    mode: 'prep',
    selected: vs.selected,
    onSelect: (id) => { vs.selected = id; vs.focusEditor = false; rerender(); },
    onMove: (id, x, y) => {
      const n = agenda.nodes.find((x2) => x2.id === id);
      if (n) { n.x = x; n.y = y; save(); }
    },
    onEmpty: () => draft.focus(),
  });
  mapWrap.appendChild(map);

  const selected = agenda.nodes.find((n) => n.id === vs.selected);
  if (selected) mapWrap.appendChild(nodeEditor(selected, ctx));
}

function nodeEditor(node, ctx) {
  const { agenda, save, rerender, vs } = ctx;
  const isRoot = node.kind === 'root';

  const text = el('input', { class: 'input', value: node.text, maxlength: '240', 'aria-label': 'Texto do balão' });
  text.addEventListener('input', () => {
    node.text = text.value;
    const live = document.querySelector(`.mtg-node[data-id="${node.id}"] .mtg-node__text`);
    if (live) live.textContent = text.value || '…';
    save();
  });
  text.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); text.blur(); vs.selected = null; save(true); rerender(); }
  });

  const who = el('input', { class: 'input', value: node.who || '', maxlength: '60', placeholder: 'Pessoa (opcional)', 'aria-label': 'Pessoa envolvida' });
  who.addEventListener('change', () => { node.who = who.value.trim() || null; save(true); rerender(); });

  const kinds = el('div', { class: 'mtg-kinds', role: 'radiogroup', 'aria-label': 'Tipo' }, KIND_ORDER.map((k) => el('button', {
    type: 'button',
    class: 'mtg-kind',
    role: 'radio',
    'aria-checked': String(node.kind === k),
    style: { '--kind-color': KIND_META[k].color },
    html: icon(KIND_META[k].icon, 12) + `<span>${KIND_META[k].label}</span>`,
    onClick: () => { node.kind = k; save(true); rerender(); },
  })));

  const actions = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap' } }, [
    el('button', {
      class: 'btn btn--outline btn--sm', type: 'button', html: icon('plus', 14) + (isRoot ? 'Tópico' : 'Subtópico'),
      onClick: () => {
        const child = makeNode(node.id, { label: '', kind: isRoot ? 'topic' : node.kind });
        agenda.nodes.push(child);
        vs.selected = child.id;
        vs.focusEditor = true;
        save(true);
        rerender();
      },
    }),
    isRoot ? null : el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', style: { color: 'var(--danger)' }, html: icon('trash', 14) + 'Excluir',
      onClick: () => { removeNode(agenda, node.id); vs.selected = null; save(true); rerender(); },
    }),
    el('span', { class: 'grow' }),
    el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', text: 'Fechar',
      onClick: () => { vs.selected = null; save(true); rerender(); },
    }),
  ]);

  const box = el('div', { class: 'mtg-editor anim-fade', style: { '--kind-color': KIND_META[node.kind].color } }, [
    el('div', { class: 'mtg-editor__row' }, [text, isRoot ? null : who]),
    isRoot ? null : kinds,
    node.detail ? el('p', { class: 'mtg-editor__detail', text: node.detail }) : null,
    actions,
  ]);

  if (vs.focusEditor) {
    vs.focusEditor = false;
    setTimeout(() => { text.focus(); text.select(); }, 60);
  }
  return box;
}

const NARROW = 640;

function layout(agenda) {
  const root = rootOf(agenda);
  const topics = childrenOf(agenda, root.id);
  const pos = new Map();

  pos.set(root.id, { x: root.x ?? 0, y: root.y ?? 0, depth: 0 });
  const count = Math.max(1, topics.length);
  const r1 = Math.max(200, Math.min(380, 120 + count * 30));
  const slice = (Math.PI * 2) / count;

  topics.forEach((t, i) => {
    const angle = -Math.PI / 2 + i * slice;
    const tx = t.x ?? Math.cos(angle) * r1 * 1.25;
    const ty = t.y ?? Math.sin(angle) * r1 * 0.78;
    pos.set(t.id, { x: tx, y: ty, depth: 1, angle });

    const kids = childrenOf(agenda, t.id);
    const spread = Math.min(1.1, slice * 0.82);
    kids.forEach((k, j) => {
      const a = kids.length === 1 ? angle : angle - spread / 2 + (spread * j) / (kids.length - 1);
      const r2 = r1 + 150 + (j % 2) * 36;
      pos.set(k.id, {
        x: k.x ?? Math.cos(a) * r2 * 1.3,
        y: k.y ?? Math.sin(a) * r2 * 0.8,
        depth: 2,
      });
      childrenOf(agenda, k.id).forEach((g, gi) => {
        const base = pos.get(k.id);
        pos.set(g.id, { x: g.x ?? base.x + Math.cos(a) * 120, y: g.y ?? base.y + (gi - 0.5) * 48 + Math.sin(a) * 50, depth: 3 });
      });
    });
  });
  return { pos, root };
}

function mindMap(agenda, meeting, opts) {
  const viewport = el('div', { class: 'mtg-map', dataset: { mode: opts.mode } });
  const stage = el('div', { class: 'mtg-map__stage' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('mtg-map__lines');
  stage.appendChild(svg);
  viewport.appendChild(stage);

  const draw = () => {
    const narrow = viewport.clientWidth > 0 ? viewport.clientWidth < NARROW : window.innerWidth < NARROW;
    viewport.dataset.layout = narrow ? 'tree' : 'radial';
    stage.querySelectorAll('.mtg-node, .mtg-map__hint').forEach((n) => n.remove());
    const nextId = opts.mode === 'live' ? nextUp(agenda)?.id : null;
    if (narrow) drawTree(nextId); else drawRadial(nextId);

    if (agenda.nodes.length <= 1) {
      stage.appendChild(el('button', {
        class: 'mtg-map__hint',
        type: 'button',
        text: opts.mode === 'prep' ? 'Escreva no copiloto e toque em "Montar mapa"' : 'Nenhum tópico preparado',
        onClick: () => opts.onEmpty?.(),
      }));
    }
  };

  const drawTree = (nextId) => {
    const root = rootOf(agenda);
    stage.style.cssText = '';
    viewport.style.height = '';
    const order = [];
    const walk = (node, depth) => {
      order.push([node, depth]);
      childrenOf(agenda, node.id).forEach((k) => walk(k, depth + 1));
    };
    walk(root, 0);
    order.forEach(([n, depth]) => {
      const node = balloon(n, { depth, selected: opts.selected === n.id, next: n.id === nextId, mode: opts.mode });
      node.style.marginLeft = depth * 22 + 'px';
      node.style.setProperty('--indent', depth * 22 + 'px');
      stage.appendChild(node);
      bindNode(node, n, { ...opts, scale: 1, narrow: true, root });
    });

    requestAnimationFrame(() => {
      const width = stage.scrollWidth;
      const height = stage.scrollHeight;
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const box = new Map();
      stage.querySelectorAll('.mtg-node').forEach((elx) => {
        box.set(elx.dataset.id, { x: elx.offsetLeft, y: elx.offsetTop, h: elx.offsetHeight });
      });
      let paths = '';
      agenda.nodes.forEach((n) => {
        const b = box.get(n.id);
        const parent = n.parentId && box.get(n.parentId);
        if (!b || !parent) return;
        const x = parent.x + 11;
        const color = KIND_META[n.kind]?.color || 'var(--line-hi)';
        paths += `<path d="M${x} ${parent.y + parent.h} V${b.y + b.h / 2} H${b.x}" stroke="${color}" data-done="${n.done}" class="mtg-map__line" fill="none"/>`;
      });
      svg.innerHTML = paths;
    });
  };

  const drawRadial = (nextId) => {
    const { pos, root } = layout(agenda, false);
    const xs = [...pos.values()].map((p) => p.x);
    const ys = [...pos.values()].map((p) => p.y);
    const minX = Math.min(...xs) - 120;
    const maxX = Math.max(...xs) + 120;
    const minY = Math.min(...ys) - 50;
    const maxY = Math.max(...ys) + 50;
    const width = Math.max(600, maxX - minX);
    const height = Math.max(agenda.nodes.length <= 1 ? 220 : 360, maxY - minY);
    const ox = -minX + (width - (maxX - minX)) / 2;
    const oy = -minY + (height - (maxY - minY)) / 2;

    const available = Math.max(280, viewport.clientWidth || 800);
    const scale = Math.max(0.5, Math.min(1.05, available / width));
    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
    stage.style.transform = `scale(${scale})`;
    stage.style.left = Math.max(0, (available - width * scale) / 2) + 'px';
    viewport.style.height = Math.ceil(height * scale + 24) + 'px';
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    let paths = '';
    agenda.nodes.forEach((n) => {
      const p = pos.get(n.id);
      const parent = n.parentId ? pos.get(n.parentId) : null;
      if (!p || !parent) return;
      const x1 = parent.x + ox, y1 = parent.y + oy, x2 = p.x + ox, y2 = p.y + oy;
      const color = KIND_META[n.kind]?.color || 'var(--line-hi)';
      paths += `<path d="M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}" stroke="${color}" data-done="${n.done}" class="mtg-map__line" fill="none"/>`;
    });
    svg.innerHTML = paths;

    agenda.nodes.forEach((n) => {
      const p = pos.get(n.id);
      if (!p) return;
      const node = balloon(n, { depth: p.depth, selected: opts.selected === n.id, next: n.id === nextId, mode: opts.mode });
      node.style.left = (p.x + ox) + 'px';
      node.style.top = (p.y + oy) + 'px';
      stage.appendChild(node);
      bindNode(node, n, { ...opts, scale, narrow: false, root, ox, oy });
    });
  };

  viewport.redraw = draw;
  requestAnimationFrame(draw);
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = viewport.clientWidth;
    if (Math.abs(w - lastW) > 8) { lastW = w; draw(); }
  });
  ro.observe(viewport);
  return viewport;
}

function balloon(n, { depth, selected, next, mode }) {
  const meta = KIND_META[n.kind] || KIND_META.topic;
  const isRoot = n.kind === 'root';
  return el('div', {
    class: 'mtg-node',
    role: isRoot ? null : 'button',
    tabindex: isRoot && mode === 'live' ? null : '0',
    'aria-pressed': isRoot || mode !== 'live' ? null : String(n.done),
    'aria-label': isRoot ? n.text : `${meta.label}: ${n.text}${n.done ? ', falado' : ''}`,
    dataset: {
      id: n.id, kind: n.kind, depth: String(depth), done: String(n.done),
      selected: String(selected), next: String(next), note: String(Boolean(n.note)),
    },
    style: { '--kind-color': meta.color },
  }, [
    isRoot ? null : el('span', { class: 'mtg-node__kind', html: icon(meta.icon, 11) + `<span>${meta.label}</span>` }),
    el('span', { class: 'mtg-node__text', text: n.text || '…' }),
    n.who ? el('span', { class: 'mtg-node__who', text: '@' + n.who }) : null,
    n.note ? el('span', { class: 'mtg-node__note', title: n.note, html: icon('edit', 11) }) : null,
    n.taskId ? el('span', { class: 'mtg-node__link', title: 'Ligado a um item do Nestra', html: icon('layers', 11) }) : null,
    isRoot ? null : el('span', { class: 'mtg-node__check', 'aria-hidden': 'true', html: icon('check', 12) }),
  ]);
}

function bindNode(node, n, opts) {
  const isRoot = n.kind === 'root';

  if (opts.mode === 'live') {
    if (isRoot) return;
    let pressTimer = 0;
    let longPressed = false;
    node.addEventListener('pointerdown', () => {
      longPressed = false;
      pressTimer = setTimeout(() => { longPressed = true; opts.onNote?.(n.id); }, 520);
    });
    const cancel = () => clearTimeout(pressTimer);
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointerleave', cancel);
    node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); cancel(); opts.onNote?.(n.id); });
    node.addEventListener('click', () => { if (!longPressed) opts.onToggle?.(n.id, node); });
    node.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); opts.onToggle?.(n.id, node); }
      if (ev.key === 'n' || ev.key === 'N') { ev.preventDefault(); opts.onNote?.(n.id); }
    });
    return;
  }

  if (opts.mode !== 'prep') return;

  node.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); opts.onSelect?.(n.id); }
  });

  let start = null;
  node.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    start = { x: ev.clientX, y: ev.clientY, left: parseFloat(node.style.left), top: parseFloat(node.style.top), moved: false };
    if (!opts.narrow) node.setPointerCapture(ev.pointerId);
  });
  node.addEventListener('pointermove', (ev) => {
    if (!start || opts.narrow) return;
    const dx = (ev.clientX - start.x) / opts.scale;
    const dy = (ev.clientY - start.y) / opts.scale;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    start.moved = true;
    node.dataset.dragging = 'true';
    node.style.left = start.left + dx + 'px';
    node.style.top = start.top + dy + 'px';
  });
  node.addEventListener('pointerup', (ev) => {
    if (!start) return;
    const s = start;
    start = null;
    node.dataset.dragging = 'false';
    if (s.moved) {
      opts.onMove?.(n.id, parseFloat(node.style.left) - opts.ox, parseFloat(node.style.top) - opts.oy);
      node.closest('.mtg-map')?.redraw?.();
    } else if (ev.type === 'pointerup') {
      opts.onSelect?.(n.id);
    }
  });
}

function nextUp(agenda) {
  const root = rootOf(agenda);
  for (const topic of childrenOf(agenda, root.id)) {
    if (!topic.done) {
      const pendingKid = childrenOf(agenda, topic.id).find((k) => !k.done);
      return pendingKid && !topic.done && childrenOf(agenda, topic.id).some((k) => k.done) ? pendingKid : topic;
    }
  }
  return agenda.nodes.find((n) => n.kind !== 'root' && !n.done) || null;
}

function renderLive(host, ctx) {
  const { meeting, agenda, save, rerender, vs } = ctx;
  const p = progress(agenda);
  host.dataset.holdRepaint = 'true';

  const started = agenda.startedAt ? new Date(agenda.startedAt) : new Date();
  const clock = el('span', { class: 'mtg-live__clock' });
  const bar = el('span', { class: 'mtg-live__bar' }, [el('i')]);
  const tick = () => {
    const sec = Math.max(0, Math.floor((Date.now() - started.getTime()) / 1000));
    const limit = (meeting.durationMinutes || 15) * 60;
    clock.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    clock.dataset.over = String(sec > limit);
    bar.firstChild.style.width = Math.min(100, (sec / limit) * 100) + '%';
    bar.dataset.over = String(sec > limit);
  };
  tick();
  if (!agenda.endedAt) ctx.timers.push(setInterval(tick, 1000));

  const ring = (done, total) => {
    const r = 17;
    const c = 2 * Math.PI * r;
    const pct = total ? done / total : 0;
    return el('div', { class: 'mtg-live__ring', role: 'img', 'aria-label': `${done} de ${total} falados` }, [
      el('span', {
        html: `<svg width="42" height="42" viewBox="0 0 42 42"><circle cx="21" cy="21" r="${r}" class="day-ring__track" fill="none" stroke-width="3"/>
          <circle cx="21" cy="21" r="${r}" class="day-ring__fill" fill="none" stroke-width="3" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 21 21)"/></svg>`,
      }),
      el('b', { text: `${done}/${total}` }),
    ]);
  };

  const next = nextUp(agenda);
  const wrap = el('div', { class: 'mtg-live' });

  const openNote = (id) => {
    const n = agenda.nodes.find((x) => x.id === id);
    if (!n) return;
    const area = el('textarea', { class: 'textarea', rows: '4', placeholder: 'O que ficou combinado, quem faz, prazo…', 'aria-label': 'Anotação' });
    area.value = n.note || '';
    const taskSwitch = el('input', { type: 'checkbox', checked: n.task ? true : null });
    const done = el('input', { type: 'checkbox', checked: n.done ? true : null });
    const ok = el('button', { class: 'btn btn--primary', type: 'button', text: 'Salvar' });
    const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancelar' });
    const dialog = openModal({
      title: n.text,
      body: el('div', { class: 'stack gap-4' }, [
        area,
        el('label', { class: 'switch' }, [done, el('span', { class: 'switch__track' }, [el('span', { class: 'switch__thumb' })]), el('span', { text: 'Já falei sobre isso' })]),
        el('label', { class: 'switch' }, [taskSwitch, el('span', { class: 'switch__track' }, [el('span', { class: 'switch__thumb' })]), el('span', { text: 'Virou tarefa minha' })]),
      ]),
      footer: [cancel, ok],
    });
    cancel.addEventListener('click', () => dialog.close());
    ok.addEventListener('click', () => {
      n.note = area.value.trim() || null;
      n.task = taskSwitch.checked;
      if (done.checked !== n.done) { n.done = done.checked; n.doneAt = n.done ? new Date().toISOString() : null; }
      save(true);
      dialog.close();
      rerender();
    });
    setTimeout(() => area.focus(), 100);
  };

  const toggle = (id, nodeEl) => {
    const n = agenda.nodes.find((x) => x.id === id);
    if (!n) return;
    n.done = !n.done;
    n.doneAt = n.done ? new Date().toISOString() : null;
    if (n.done) {
      try { completionEffect(nodeEl.querySelector('.mtg-node__check') || nodeEl, { color: (KIND_META[n.kind] || KIND_META.topic).color.startsWith('#') ? KIND_META[n.kind].color : '#2F6BFF', scale: 0.8 }); } catch {  }
      const parent = agenda.nodes.find((x) => x.id === n.parentId && x.kind !== 'root');
      if (parent && !parent.done && childrenOf(agenda, parent.id).every((k) => k.done)) {
        parent.done = true;
        parent.doneAt = n.doneAt;
      }
    }
    save(true);
    setTimeout(rerender, n.done ? 260 : 0);
  };

  const fullscreen = el('button', {
    class: 'btn btn--ghost btn--icon btn--sm', type: 'button', 'aria-label': 'Tela cheia', html: icon('grid', 15),
    onClick: () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else wrap.requestFullscreen?.().catch(() => {});
    },
  });

  const end = el('button', {
    class: 'btn btn--primary btn--sm', type: 'button', html: icon('check', 15) + 'Encerrar',
    onClick: async () => {
      agenda.endedAt = new Date().toISOString();
      save(true);
      if (document.fullscreenElement) document.exitFullscreen?.();
      vs.mode = 'minutes';
      vs.generate = true;
      rerender();
    },
  });

  wrap.append(
    el('div', { class: 'mtg-live__top' }, [
      ring(p.done, p.total),
      el('div', { class: 'mtg-live__time' }, [clock, el('small', { text: `de ${meeting.durationMinutes} min` }), bar]),
      el('div', { class: 'mtg-live__next grow' }, next ? [
        el('small', { text: 'Próximo assunto' }),
        el('b', { text: next.text }),
      ] : [el('small', { text: 'Tudo falado' }), el('b', { text: 'Pode encerrar quando quiser.' })]),
      el('div', { class: 'row gap-2' }, [
        next ? el('button', {
          class: 'btn btn--outline btn--sm', type: 'button', html: icon('check', 14) + 'Falei',
          onClick: () => toggle(next.id, wrap.querySelector(`.mtg-node[data-id="${next.id}"]`) || wrap),
        }) : null,
        fullscreen,
        end,
      ]),
    ]),
    mindMap(agenda, meeting, { mode: 'live', onToggle: toggle, onNote: openNote }),
    el('p', { class: 'mtg-live__help', text: 'Toque no balão quando falar sobre ele. Segure (ou clique com o botão direito) para anotar o que ficou combinado.' }),
  );

  host.appendChild(wrap);

  const onKey = (ev) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || document.querySelector('.overlay[data-open="true"]')) return;
    if (ev.key === ' ' && next && !ev.target.closest?.('.mtg-node')) {
      ev.preventDefault();
      toggle(next.id, wrap.querySelector(`.mtg-node[data-id="${next.id}"]`) || wrap);
    }
  };
  document.addEventListener('keydown', onKey);
  ctx.cleanups.push(() => document.removeEventListener('keydown', onKey));
}

function renderMinutes(host, ctx) {
  const { meeting, agenda, iso, save, rerender, vs, env } = ctx;
  const p = progress(agenda);

  const duration = agenda.startedAt && agenda.endedAt
    ? Math.max(1, Math.round((new Date(agenda.endedAt) - new Date(agenda.startedAt)) / 60000))
    : null;

  const left = el('section', { class: 'mtg-minutes panel' });
  const right = el('aside', { class: 'mtg-followups panel' });
  host.append(left, right);

  const stat = (n, l, mod) => el('div', { class: 'env-hero__stat' + (mod ? ' env-hero__stat--' + mod : '') }, [
    el('span', { class: 'env-hero__stat-n', text: String(n) }),
    el('span', { class: 'env-hero__stat-l', text: l }),
  ]);

  left.appendChild(el('div', { class: 'mtg-minutes__stats' }, [
    stat(p.done, 'falados'),
    stat(p.total - p.done, 'ficaram', p.total - p.done ? 'overdue' : null),
    duration ? stat(duration + ' min', duration > meeting.durationMinutes ? 'passou do tempo' : 'de duração') : null,
  ]));

  const text = el('textarea', { class: 'textarea mtg-minutes__text', rows: '14', 'aria-label': 'Ata' });
  text.value = agenda.summary || '';
  text.addEventListener('input', () => { agenda.summary = text.value; save(); });

  const status = el('span', { class: 'mtg-copilot__engine', dataset: { ai: String(vs.summarySource === 'ai') } });
  const paintStatus = () => {
    status.dataset.ai = String(vs.summarySource === 'ai');
    status.innerHTML = vs.summarySource === 'ai' ? icon('sparkle', 12) + '<span>Escrita pela IA</span>'
      : vs.summarySource === 'local' ? icon('bolt', 12) + '<span>Assistente local</span>' : '<span>Editável</span>';
  };
  paintStatus();

  const followList = el('div', { class: 'mtg-follow__list' });
  const createBtn = el('button', { class: 'btn btn--primary btn--block', type: 'button' });

  const paintFollow = () => {
    const list = vs.followUps || [];
    followList.replaceChildren();
    if (!list.length) {
      followList.appendChild(el('p', { class: 'text-dim', style: { fontSize: 'var(--fs-sm)' }, text: 'Nenhum próximo passo identificado. Marque "Virou tarefa minha" em um balão durante a reunião, ou gere a ata.' }));
      createBtn.style.display = 'none';
      return;
    }
    list.forEach((f) => {
      const check = el('input', { type: 'checkbox', checked: f.pick !== false ? true : null, 'aria-label': 'Criar esta tarefa' });
      check.addEventListener('change', () => { f.pick = check.checked; paintCount(); });
      const title = el('input', { class: 'input input--bare', value: f.title, 'aria-label': 'Tarefa' });
      title.addEventListener('input', () => { f.title = title.value; });
      const due = el('select', { class: 'select select--sm', 'aria-label': 'Prazo' }, [
        ['today', 'Hoje'], ['tomorrow', 'Amanhã'], ['this_week', 'Esta semana'], ['none', 'Sem prazo'],
      ].map(([v, l]) => el('option', { value: v, text: l, selected: (f.due || 'today') === v ? true : null })));
      due.addEventListener('change', () => { f.due = due.value; });
      followList.appendChild(el('div', { class: 'mtg-follow', dataset: { created: String(Boolean(f.created)) } }, [
        f.created ? el('span', { class: 'mtg-follow__ok', html: icon('check', 14) }) : check,
        title,
        f.created ? null : due,
      ]));
    });
    paintCount();
  };
  const paintCount = () => {
    const n = (vs.followUps || []).filter((f) => f.pick !== false && !f.created).length;
    createBtn.style.display = n ? '' : 'none';
    createBtn.innerHTML = icon('plus', 15) + `Criar ${n} ${n === 1 ? 'tarefa' : 'tarefas'}${env ? ' em ' + esc(env.name) : ''}`;
  };

  createBtn.addEventListener('click', () => {
    let created = 0;
    (vs.followUps || []).forEach((f) => {
      if (f.pick === false || f.created || !String(f.title).trim()) return;
      const item = store.createItem({
        title: f.title,
        type: 'task',
        environmentId: meeting.environmentId,
        dueDate: dueFrom(f.due || 'today', todayISO()),
        source: 'manual',
        rawInput: `Reunião ${meeting.title} (${iso})`,
      });
      if (item) {
        f.created = true;
        created++;
        const node = f.nodeId && agenda.nodes.find((n) => n.id === f.nodeId);
        if (node) node.taskId = item.id;
      }
    });
    save(true);
    toast(`${created} ${created === 1 ? 'tarefa criada' : 'tarefas criadas'} no Nestra.`, { kind: 'success' });
    paintFollow();
  });

  const generate = async () => {
    regen.disabled = true;
    regen.innerHTML = '<span class="mtg-spin"></span>Escrevendo…';
    const out = await summarize(meeting, agenda);
    agenda.summary = out.summary;
    text.value = out.summary;
    vs.summarySource = out.source;
    const fromNodes = agenda.nodes.filter((n) => n.task && !n.taskId).map((n) => ({ title: actionTitle(n), due: 'today', nodeId: n.id }));
    const merged = [...fromNodes];
    out.followUps.forEach((f) => {
      if (!merged.some((m) => m.title.toLowerCase() === String(f.title).toLowerCase())) merged.push({ title: f.title, due: f.due });
    });
    vs.followUps = merged;
    save(true);
    paintStatus();
    paintFollow();
    regen.disabled = false;
    regen.innerHTML = icon('refresh', 14) + 'Gerar de novo';
  };

  const regen = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', html: icon('sparkle', 14) + (agenda.summary ? 'Gerar de novo' : 'Gerar ata'), onClick: generate });
  const copy = el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', html: icon('download', 14) + 'Copiar',
    onClick: async () => {
      try { await navigator.clipboard.writeText(text.value); toast('Ata copiada.', { kind: 'success' }); }
      catch { text.select(); toast('Selecionei o texto: é só copiar.'); }
    },
  });

  left.append(
    el('div', { class: 'mtg-map-panel__head' }, [
      el('div', { class: 'grow' }, [el('b', { text: 'Ata' }), el('small', { text: dayLabel(iso) })]),
      status, regen, copy,
    ]),
    text,
  );

  const rootNode = rootOf(agenda);
  const reviewList = el('div', { class: 'mtg-review' });
  childrenOf(agenda, rootNode.id).forEach((t) => {
    reviewList.appendChild(el('button', {
      class: 'mtg-review__row', type: 'button', dataset: { done: String(t.done) },
      style: { '--kind-color': KIND_META[t.kind]?.color },
      onClick: () => { t.done = !t.done; t.doneAt = t.done ? new Date().toISOString() : null; save(true); rerender(); },
    }, [
      el('span', { class: 'mtg-review__check', html: icon('check', 12) }),
      el('span', { class: 'grow', text: t.text }),
      t.note ? el('small', { class: 'text-dim', text: t.note }) : null,
    ]));
  });
  left.append(el('div', { class: 'mtg-copilot__section', text: 'Assuntos' }), reviewList);

  right.append(
    el('div', { class: 'mtg-copilot__head' }, [
      el('span', { class: 'mtg-copilot__avatar', html: icon('flag', 16) }),
      el('div', { class: 'grow' }, [el('b', { text: 'Próximos passos' }), el('small', { text: 'Viram tarefas no Nestra' })]),
    ]),
    followList,
    createBtn,
  );

  const leftovers = agenda.nodes.filter((n) => n.kind !== 'root' && !n.done && n.parentId === rootNode.id);
  const nextIso = store.nextOccurrence(meeting, shiftDay(iso, 1));
  if (leftovers.length) {
    right.append(
      el('div', { class: 'mtg-copilot__section', text: 'O que ficou' }),
      el('div', { class: 'mtg-tip', style: { '--tip-color': KIND_META.notice.color } }, [
        el('span', { class: 'mtg-tip__icon', html: icon('clockBack', 15) }),
        el('div', { class: 'grow' }, [
          el('b', { text: `${leftovers.length} ${leftovers.length === 1 ? 'assunto' : 'assuntos'} para ${dayLabel(nextIso).toLowerCase()}` }),
          el('small', { text: leftovers.slice(0, 3).map((n) => n.text).join(' · ') }),
        ]),
        el('button', {
          class: 'btn btn--outline btn--sm', type: 'button', text: 'Levar',
          onClick: () => {
            const target = store.openAgenda(meeting.id, nextIso);
            const added = addTopics(target, leftovers.map((n) => ({
              label: n.text, kind: n.kind, detail: n.detail, who: n.who,
              children: childrenOf(agenda, n.id).filter((k) => !k.done).map((k) => ({ label: k.text, kind: k.kind })),
            })), 'carry');
            store.saveAgenda(target);
            toast(added ? `Levei para ${dayLabel(nextIso).toLowerCase()}.` : 'Já estavam na próxima pauta.', { kind: 'success' });
          },
        }),
      ]),
    );
  }

  right.append(el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', style: { marginTop: 'var(--s-4)' },
    html: icon('target', 14) + 'Voltar ao mapa',
    onClick: () => { agenda.endedAt = null; save(true); vs.mode = 'live'; rerender(); },
  }));

  if (!vs.followUps) {
    vs.followUps = agenda.nodes.filter((n) => n.task && !n.taskId)
      .map((n) => ({ title: actionTitle(n), due: 'today', nodeId: n.id }));
  }
  paintFollow();

  if (vs.generate || (!agenda.summary && agenda.endedAt)) {
    vs.generate = false;
    generate();
  } else if (!agenda.summary && !agenda.endedAt) {
    text.placeholder = 'A ata aparece aqui quando você encerrar a reunião. Também dá para gerar agora.';
  }
}
