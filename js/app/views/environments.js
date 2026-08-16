/* =====================================================================
   NESTRA — Ambientes (§5, §7.3, Fluxo D)

   "O usuário poderá cadastrar ambientes livremente. O sistema não deve
   impor uma lista fixa de categorias."
   ===================================================================== */

import { store } from '../store.js';
import { el, icon, toast, openModal, confirmDialog, ICON_CHOICES, COLOR_CHOICES } from '../ui.js';
import { bindTilt } from '../../gfx/fx.js';
import { mountOrb } from '../../gfx/orb.js';

export function renderEnvironments(root, { onNavigate }) {
  const rerender = () => renderEnvironments(root, { onNavigate });
  const envs = store.activeEnvironments;

  root.replaceChildren();

  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [
      el('h1', { class: 'view-title', text: 'Ambientes' }),
      el('p', {
        class: 'view-sub',
        text: 'Cada área da sua vida com sua própria tela, cor e conjunto de itens.',
      }),
    ]),
    el('button', {
      class: 'btn btn--primary btn--sm',
      html: icon('plus', 15) + 'Novo ambiente',
      onClick: () => openEnvironmentForm(null, rerender),
    }),
  ]));

  const grid = el('div', { class: 'env-grid stagger' });

  envs.forEach((env) => {
    const stats = store.environmentStats(env.id);

    // A peça 3D do ambiente: forma vinda do ícone, cor vinda do ambiente
    const orbCanvas = el('canvas', { 'aria-hidden': 'true' });
    const orbSlot = el('div', { class: 'env-orb' }, [orbCanvas]);

    const card = el('article', {
      class: 'env-card',
      'data-tilt': '7',
      tabindex: '0',
      role: 'button',
      'aria-label': `Abrir ambiente ${env.name}`,
      style: { '--env-color': env.color },
    }, [
      el('div', { class: 'env-card__top' }, [
        orbSlot,
        el('button', {
          class: 'btn btn--ghost btn--icon btn--sm',
          'aria-label': `Editar ${env.name}`,
          html: icon('settings', 15),
          onClick: (ev) => { ev.stopPropagation(); openEnvironmentForm(env, rerender); },
        }),
      ]),
      el('div', {}, [
        el('h3', { class: 'env-card__name', text: env.name }),
        env.description ? el('p', { class: 'env-card__desc', text: env.description }) : null,
      ]),
      el('div', { class: 'env-card__stats' }, [
        el('div', { class: 'env-stat' }, [
          el('span', { class: 'env-stat__n', text: String(stats.pending) }),
          el('span', { class: 'env-stat__l', text: 'pendentes' }),
        ]),
        stats.overdue
          ? el('div', { class: 'env-stat env-stat--overdue' }, [
              el('span', { class: 'env-stat__n', text: String(stats.overdue) }),
              el('span', { class: 'env-stat__l', text: 'atrasados' }),
            ])
          : el('div', { class: 'env-stat' }, [
              el('span', { class: 'env-stat__n', text: String(stats.today) }),
              el('span', { class: 'env-stat__l', text: 'para hoje' }),
            ]),
        el('div', { class: 'env-stat' }, [
          el('span', { class: 'env-stat__n', text: String(stats.done) }),
          el('span', { class: 'env-stat__l', text: 'concluídos' }),
        ]),
      ]),
    ]);

    const open = () => onNavigate('environment', env.id);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });

    grid.appendChild(card);

    // Precisa estar no documento para o canvas ter tamanho medido
    requestAnimationFrame(() => {
      mountOrb(orbCanvas, {
        color: env.color,
        icon: env.icon,
        energy: Math.min(1, stats.pending / 12),
      });
    });
  });

  /* Cartão de criação */
  grid.appendChild(el('button', {
    class: 'env-card env-card--new',
    onClick: () => openEnvironmentForm(null, rerender),
  }, [
    el('span', { html: icon('plus', 24) }),
    el('span', { style: { fontFamily: 'var(--font-display)', fontWeight: '600' }, text: 'Criar ambiente' }),
    el('span', { style: { fontSize: 'var(--fs-xs)' }, text: 'Trabalho, Estudos, Casa, um projeto…' }),
  ]));

  root.appendChild(grid);
  bindTilt(root);

  /* Caixa de entrada: itens sem ambiente */
  const inboxCount = store.live.filter((i) => !i.environmentId && i.status === 'pending').length;
  if (inboxCount) {
    root.appendChild(el('div', {
      class: 'panel panel--bracket',
      style: { marginTop: 'var(--s-6)', padding: 'var(--s-5)' },
    }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { style: { color: 'var(--text-3)' }, html: icon('inbox', 20) }),
        el('div', { class: 'grow' }, [
          el('div', { style: { fontWeight: '600' }, text: `${inboxCount} ${inboxCount === 1 ? 'item' : 'itens'} sem ambiente` }),
          el('div', { class: 'text-dim', style: { fontSize: 'var(--fs-xs)' }, text: 'Capturas que ainda não foram para nenhum lugar específico.' }),
        ]),
        el('button', {
          class: 'btn btn--outline btn--sm',
          text: 'Ver caixa de entrada',
          onClick: () => onNavigate('inbox'),
        }),
      ]),
    ]));
  }

  /* Ambientes arquivados */
  const archived = store.state.environments.filter((e) => e.archivedAt);
  if (archived.length) {
    root.appendChild(el('div', { class: 'divider-label', style: { marginTop: 'var(--s-7)' }, text: 'Arquivados' }));
    const list = el('div', { class: 'row gap-2', style: { flexWrap: 'wrap', marginTop: 'var(--s-3)' } });
    archived.forEach((env) => {
      list.appendChild(el('button', {
        class: 'chip chip--interactive',
        html: icon(env.icon, 13) + `<span>${env.name}</span>`,
        title: 'Restaurar ambiente',
        onClick: () => {
          store.updateEnvironment(env.id, { archivedAt: null });
          toast(`${env.name} restaurado.`);
          rerender();
        },
      }));
    });
    root.appendChild(list);
  }
}

/* ---------------------------------------------------------------------
   Formulário de criação e edição
   --------------------------------------------------------------------- */
export function openEnvironmentForm(env, onDone) {
  const isNew = !env;
  const draft = {
    name: env?.name || '',
    description: env?.description || '',
    color: env?.color || COLOR_CHOICES[0],
    icon: env?.icon || 'layers',
    isDefault: env?.isDefault || false,
  };

  const body = el('div', { class: 'stack gap-4' });

  const nameInput = el('input', {
    class: 'input',
    value: draft.name,
    placeholder: 'Trabalho, Estudos, Casa, Projeto X…',
    maxlength: '60',
  });
  body.appendChild(el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Nome' }),
    nameInput,
  ]));

  const descInput = el('input', {
    class: 'input',
    value: draft.description,
    placeholder: 'Opcional — para lembrar do que se trata',
    maxlength: '160',
  });
  body.appendChild(el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Descrição' }),
    descInput,
  ]));

  /* Cor */
  const colorRow = el('div', { class: 'color-picker' });
  const paintPreview = () => {
    preview.style.setProperty('--env-color', draft.color);
    previewIcon.innerHTML = icon(draft.icon, 19);
  };
  COLOR_CHOICES.forEach((c) => {
    const dot = el('button', {
      class: 'color-dot',
      style: { '--c': c },
      'aria-pressed': String(draft.color === c),
      'aria-label': 'Cor ' + c,
      onClick: () => {
        draft.color = c;
        colorRow.querySelectorAll('.color-dot').forEach((d) => (d.ariaPressed = 'false'));
        dot.ariaPressed = 'true';
        paintPreview();
      },
    });
    colorRow.appendChild(dot);
  });
  body.appendChild(el('div', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Cor de identificação' }),
    colorRow,
  ]));

  /* Ícone */
  const iconRow = el('div', { class: 'icon-picker' });
  ICON_CHOICES.forEach((name) => {
    const opt = el('button', {
      class: 'icon-opt',
      html: icon(name, 17),
      'aria-pressed': String(draft.icon === name),
      'aria-label': 'Ícone ' + name,
      onClick: () => {
        draft.icon = name;
        iconRow.querySelectorAll('.icon-opt').forEach((d) => (d.ariaPressed = 'false'));
        opt.ariaPressed = 'true';
        paintPreview();
      },
    });
    iconRow.appendChild(opt);
  });
  body.appendChild(el('div', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Ícone' }),
    iconRow,
  ]));

  /* Pré-visualização */
  const previewIcon = el('div', { class: 'env-card__icon', html: icon(draft.icon, 19) });
  const previewName = el('h3', { class: 'env-card__name', text: draft.name || 'Nome do ambiente' });
  const preview = el('div', {
    class: 'env-card',
    style: { '--env-color': draft.color, cursor: 'default', pointerEvents: 'none' },
  }, [
    el('div', { class: 'env-card__top' }, [previewIcon]),
    el('div', {}, [previewName]),
  ]);
  nameInput.addEventListener('input', () => {
    previewName.textContent = nameInput.value.trim() || 'Nome do ambiente';
  });
  body.appendChild(el('div', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Prévia' }),
    preview,
  ]));

  /* Padrão para novas capturas */
  const defaultSwitch = el('label', { class: 'switch' }, [
    el('input', { type: 'checkbox', checked: draft.isDefault }),
    el('span', { class: 'switch__track' }),
    el('span', { class: 'switch__thumb' }),
    el('span', { style: { fontSize: 'var(--fs-sm)' }, text: 'Usar como ambiente padrão das novas capturas' }),
  ]);
  body.appendChild(defaultSwitch);

  const cancelBtn = el('button', { class: 'btn btn--ghost', text: 'Cancelar' });
  const saveBtn = el('button', {
    class: 'btn btn--primary',
    html: icon('check', 16) + (isNew ? 'Criar ambiente' : 'Salvar'),
  });

  const footer = [cancelBtn, saveBtn];

  if (!isNew) {
    footer.unshift(el('button', {
      class: 'btn btn--danger',
      html: icon('archive', 16) + 'Arquivar',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Arquivar ambiente?',
          message: `Os itens de "${env.name}" não são apagados: eles voltam para a caixa de entrada e o ambiente pode ser restaurado depois.`,
          confirmLabel: 'Arquivar',
        });
        if (!ok) return;
        store.archiveEnvironment(env.id);
        toast(`${env.name} arquivado.`);
        dialog.close();
        onDone?.();
      },
    }));
  }

  const dialog = openModal({
    title: isNew ? 'Novo ambiente' : 'Editar ambiente',
    body,
    footer,
  });

  cancelBtn.addEventListener('click', () => dialog.close());

  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      toast('Dê um nome ao ambiente.', { kind: 'warn' });
      return;
    }

    const payload = {
      name,
      description: descInput.value.trim() || null,
      color: draft.color,
      icon: draft.icon,
      isDefault: defaultSwitch.querySelector('input').checked,
    };

    if (isNew) {
      const created = store.createEnvironment(payload);
      if (payload.isDefault) store.setPrefs({ defaultEnvironmentId: created.id });
      toast(`Ambiente ${name} criado.`, { kind: 'success' });
    } else {
      store.updateEnvironment(env.id, payload);
      if (payload.isDefault) store.setPrefs({ defaultEnvironmentId: env.id });
      toast('Ambiente atualizado.', { kind: 'success' });
    }

    dialog.close();
    onDone?.();
  });

  setTimeout(() => nameInput.focus(), 120);
}
