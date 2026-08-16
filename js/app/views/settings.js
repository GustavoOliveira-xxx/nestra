/* =====================================================================
   NESTRA — Configurações, lixeira, privacidade e conta
   §18 (ciclo de vida da conta), §19 (privacidade), §21 (preferências),
   §22 (acessibilidade), §24 (lixeira).
   ===================================================================== */

import { store, DEFAULT_PREFS } from '../store.js';
import { api } from '../api.js';
import { el, icon, toast, confirmDialog, downloadFile, COLOR_CHOICES } from '../ui.js';
import { setLogoFromFile, clearLogoOverride, getLogoOverride } from '../../gfx/logo3d.js';
import { renderItem } from './items.js';
import { humanDate } from '../nlp.js';

/* ---------------------------------------------------------------------
   Escolha da marca

   O efeito 3D lê os pixels do arquivo, então trocar a logo é trocar a
   imagem — nada é redesenhado. Aqui dá para fazer isso sem sair do app:
   arraste o arquivo ou escolha pelo seletor. A imagem fica só neste
   navegador; não sobe para lugar nenhum.
   --------------------------------------------------------------------- */
function logoPicker(onChange) {
  const current = getLogoOverride();

  const preview = el('div', { class: 'logo-drop__preview' }, [
    el('img', {
      src: current || 'assets/logo/nestra-mark.png',
      alt: 'Marca atual',
      onerror: 'this.style.opacity=0',
    }),
  ]);

  const input = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/svg+xml',
    class: 'sr-only',
    id: 'logoFile',
  });

  const zone = el('label', {
    class: 'logo-drop',
    for: 'logoFile',
    tabindex: '0',
  }, [
    preview,
    el('div', { class: 'grow' }, [
      el('div', { style: { fontWeight: '600' }, text: 'Trocar a marca' }),
      el('div', {
        class: 'setting-row__desc',
        text: 'Arraste o arquivo aqui ou clique para escolher. PNG com fundo transparente fica melhor, mas fundo branco também funciona: ele é removido sozinho.',
      }),
      el('div', {
        class: 'field__hint',
        style: { marginTop: '6px' },
        text: current ? 'Usando uma marca enviada por você.' : 'Usando o arquivo de assets/logo/.',
      }),
    ]),
    input,
  ]);

  async function apply(file) {
    try {
      await setLogoFromFile(file);
      toast('Marca atualizada. O efeito 3D já está usando ela.', { kind: 'success' });
      window.dispatchEvent(new CustomEvent('nestra:logo-changed'));
      onChange?.();
    } catch (err) {
      toast(err.message || 'Não consegui usar esse arquivo.', { kind: 'error' });
    }
  }

  input.addEventListener('change', () => {
    if (input.files?.[0]) apply(input.files[0]);
  });

  ['dragenter', 'dragover'].forEach((type) =>
    zone.addEventListener(type, (ev) => {
      ev.preventDefault();
      zone.dataset.over = 'true';
    }));

  ['dragleave', 'drop'].forEach((type) =>
    zone.addEventListener(type, (ev) => {
      ev.preventDefault();
      zone.dataset.over = 'false';
    }));

  zone.addEventListener('drop', (ev) => {
    const file = ev.dataTransfer?.files?.[0];
    if (file) apply(file);
  });

  const actions = el('div', { class: 'row gap-2', style: { marginTop: 'var(--s-3)' } }, [
    el('button', {
      class: 'btn btn--outline btn--sm',
      html: icon('download', 15) + 'Escolher arquivo',
      onClick: () => input.click(),
    }),
    current
      ? el('button', {
          class: 'btn btn--ghost btn--sm',
          html: icon('clockBack', 15) + 'Voltar para a padrão',
          onClick: () => {
            clearLogoOverride();
            toast('Voltou para a marca do repositório.');
            window.dispatchEvent(new CustomEvent('nestra:logo-changed'));
            onChange?.();
          },
        })
      : null,
  ]);

  return el('div', {}, [zone, actions]);
}

const TABS = [
  { id: 'appearance', label: 'Aparência', icon: 'sparkle' },
  { id: 'behavior', label: 'Comportamento', icon: 'settings' },
  { id: 'notifications', label: 'Notificações', icon: 'bell' },
  { id: 'trash', label: 'Lixeira', icon: 'trash' },
  { id: 'data', label: 'Dados e privacidade', icon: 'shield' },
  { id: 'account', label: 'Conta', icon: 'user' },
];

export function renderSettings(root, { onNavigate, applyPrefs }) {
  const rerender = () => renderSettings(root, { onNavigate, applyPrefs });
  const active = root.dataset.tab || 'appearance';
  const p = store.state.prefs;

  root.replaceChildren();

  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [
      el('h1', { class: 'view-title', text: 'Configurações' }),
      el('p', { class: 'view-sub', text: 'Ajuste o Nestra ao seu modo de organizar. Nada aqui é obrigatório.' }),
    ]),
  ]));

  /* Abas */
  const nav = el('div', { class: 'settings-nav', role: 'tablist' });
  TABS.forEach((tab) => {
    nav.appendChild(el('button', {
      class: 'settings-nav__tab',
      role: 'tab',
      'aria-selected': String(active === tab.id),
      html: icon(tab.icon, 15) + `<span style="margin-left:7px">${tab.label}</span>`,
      style: { display: 'inline-flex', alignItems: 'center' },
      onClick: () => { root.dataset.tab = tab.id; rerender(); },
    }));
  });
  root.appendChild(nav);

  const panel = el('div', { class: 'panel', style: { padding: 'var(--s-5) var(--s-6)' } });
  root.appendChild(panel);

  const row = (name, desc, control) =>
    el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-row__info' }, [
        el('div', { class: 'setting-row__name', text: name }),
        desc ? el('div', { class: 'setting-row__desc', text: desc }) : null,
      ]),
      el('div', { class: 'setting-row__control' }, [control]),
    ]);

  const toggle = (key, onChange) => {
    const input = el('input', { type: 'checkbox', checked: Boolean(p[key]) });
    input.addEventListener('change', () => {
      store.setPrefs({ [key]: input.checked });
      applyPrefs?.();
      onChange?.();
    });
    return el('label', { class: 'switch' }, [input, el('span', { class: 'switch__track' }), el('span', { class: 'switch__thumb' })]);
  };

  const segmented = (key, options) => {
    const wrap = el('div', { class: 'segmented', role: 'tablist' });
    options.forEach(([value, label]) => {
      wrap.appendChild(el('button', {
        class: 'segmented__opt',
        role: 'tab',
        'aria-selected': String(p[key] === value),
        text: label,
        onClick: () => {
          store.setPrefs({ [key]: value });
          applyPrefs?.();
          rerender();
        },
      }));
    });
    return wrap;
  };

  /* ---------------- Aparência ---------------- */
  if (active === 'appearance') {
    const swatches = el('div', { class: 'color-picker' });
    COLOR_CHOICES.forEach((c) => {
      swatches.appendChild(el('button', {
        class: 'color-dot',
        style: { '--c': c },
        'aria-pressed': String(p.accent === c),
        'aria-label': 'Cor ' + c,
        onClick: () => { store.setPrefs({ accent: c }); applyPrefs?.(); rerender(); },
      }));
    });

    panel.append(
      row('Cor de destaque', 'O azul é a identidade do Nestra, mas a escolha é sua.', swatches),
      row('Densidade', 'Quanta informação cabe em cada tela.',
        segmented('density', [['compact', 'Compacta'], ['comfortable', 'Confortável'], ['spacious', 'Espaçosa']])),
      row('Cantos', 'A linguagem visual do Nestra é reta. Dá para suavizar.',
        segmented('cornerStyle', [['square', 'Retos'], ['soft', 'Arredondados']])),
      row('Movimento', 'Desligue as animações se preferir uma interface parada (§22).',
        segmented('motion', [['full', 'Completo'], ['reduced', 'Reduzido']])),
      row('Alto contraste', 'Aumenta a separação entre texto e fundo.', toggle('highContrast')),
    );

    const glow = el('input', {
      type: 'range', min: '0', max: '100', value: String(p.glowIntensity),
      style: { accentColor: p.accent, width: '180px' },
    });
    glow.addEventListener('input', () => {
      store.setPrefs({ glowIntensity: +glow.value });
      applyPrefs?.();
    });
    panel.appendChild(row('Intensidade do brilho', 'Controla o quanto o azul acende na interface.', glow));

    /* --- A marca --- */
    panel.appendChild(el('div', { class: 'divider-label', style: { margin: 'var(--s-6) 0 var(--s-4)' }, text: 'Marca' }));
    panel.appendChild(logoPicker(rerender));
  }

  /* ---------------- Comportamento ---------------- */
  if (active === 'behavior') {
    const envSel = el('select', { class: 'select', style: { minWidth: '180px' } }, [
      el('option', { value: '', text: 'Caixa de entrada', selected: !p.defaultEnvironmentId }),
      ...store.activeEnvironments.map((e) =>
        el('option', { value: e.id, text: e.name, selected: p.defaultEnvironmentId === e.id })),
    ]);
    envSel.addEventListener('change', () => store.setPrefs({ defaultEnvironmentId: envSel.value || null }));

    const tzInput = el('input', {
      class: 'input', value: p.timezone, style: { minWidth: '200px' },
      placeholder: 'America/Sao_Paulo',
    });
    tzInput.addEventListener('change', () => {
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: tzInput.value });
        store.setPrefs({ timezone: tzInput.value });
        toast('Fuso horário atualizado.', { kind: 'success' });
      } catch {
        tzInput.setAttribute('aria-invalid', 'true');
        toast('Fuso horário não reconhecido.', { kind: 'error' });
      }
    });

    panel.append(
      row('Interpretar a frase automaticamente',
        'Extrai data, tipo, prioridade e ambiente do que você escreve. Quando desligado, a frase vira o título e nada mais.',
        toggle('nlParsingEnabled')),
      row('Ambiente padrão', 'Para onde vão as capturas que não indicam um lugar.', envSel),
      row('Fuso horário', 'Usado para resolver "hoje", "amanhã" e "sábado".', tzInput),
      row('Abrir o sistema em', 'Onde o Nestra começa quando você entra.',
        segmented('startView', [['today', 'Hoje'], ['last_environment', 'Último ambiente']])),
      row('Mostrar itens sem prazo na tela Hoje',
        'Eles continuam disponíveis no ambiente mesmo quando desligado.',
        toggle('showUndatedOnToday')),
      row('Mostrar alta prioridade fora da data de hoje',
        'Traz para o presente o que é importante mesmo tendo outra data.',
        toggle('showHighPriorityOutsideToday')),
      row('Confirmar antes de excluir', 'Ações destrutivas pedem confirmação (§24).', toggle('confirmBeforeDelete')),
      row('Ao concluir um item', 'O que acontece visualmente depois de marcar como feito.',
        segmented('afterComplete', [['keep', 'Mantém'], ['fade', 'Esmaece'], ['hide', 'Some da lista']])),
      row('Primeiro dia da semana', null,
        segmented('weekStart', [[0, 'Domingo'], [1, 'Segunda']])),
    );
  }

  /* ---------------- Notificações (§9) ---------------- */
  if (active === 'notifications') {
    const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

    const status = el('div', {
      class: 'chip',
      style: { marginBottom: 'var(--s-4)' },
      html: icon('bell', 13) + `<span>Permissão do navegador: <b>${
        permission === 'granted' ? 'concedida' :
        permission === 'denied' ? 'negada' :
        permission === 'unsupported' ? 'não suportada' : 'ainda não pedida'
      }</b></span>`,
    });
    panel.appendChild(status);

    if (permission === 'default') {
      panel.appendChild(el('button', {
        class: 'btn btn--outline btn--sm',
        style: { marginBottom: 'var(--s-4)' },
        html: icon('bell', 15) + 'Permitir notificações',
        onClick: async () => {
          const res = await Notification.requestPermission();
          toast(res === 'granted' ? 'Notificações liberadas.' : 'Você pode mudar isso nas permissões do navegador.');
          rerender();
        },
      }));
    }

    if (permission === 'denied') {
      panel.appendChild(el('p', {
        class: 'field__hint',
        style: { marginBottom: 'var(--s-4)' },
        text: 'O navegador está bloqueando notificações para este site. É preciso liberar nas permissões da página.',
      }));
    }

    panel.append(
      row('Avisar sobre compromissos', 'Eventos com data e horário definidos.', toggle('notifyCommitments')),
      row('Avisar sobre itens vencendo', 'No dia em que algo vence.', toggle('notifyDueItems')),
      row('Avisar sobre atrasados', 'Um lembrete único quando algo passou da data.', toggle('notifyOverdue')),
      row('Som', 'Um sinal curto junto com o aviso.', toggle('soundEnabled')),
    );

    panel.appendChild(el('p', {
      class: 'field__hint',
      style: { marginTop: 'var(--s-4)' },
      text: 'O Nestra não notifica cada tarefa criada. Só avisa quando existe uma razão temporal clara.',
    }));

    panel.appendChild(el('button', {
      class: 'btn btn--ghost btn--sm',
      style: { marginTop: 'var(--s-3)' },
      html: icon('bolt', 15) + 'Enviar um aviso de teste',
      onClick: () => {
        if (Notification?.permission !== 'granted') {
          toast('Permita as notificações primeiro.', { kind: 'warn' });
          return;
        }
        new Notification('Nestra', {
          body: 'É assim que um aviso vai aparecer.',
          icon: 'assets/icons/icon-192.png',
          badge: 'assets/icons/icon-192.png',
        });
      },
    }));
  }

  /* ---------------- Lixeira (§24) ---------------- */
  if (active === 'trash') {
    const trashed = store.trash.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

    panel.appendChild(el('p', {
      class: 'field__hint',
      style: { marginBottom: 'var(--s-4)' },
      text: 'Itens excluídos ficam aqui por 30 dias antes de sumirem de vez. Concluir e adiar são rápidos e reversíveis; excluir pede confirmação.',
    }));

    if (!trashed.length) {
      panel.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty__glyph', html: icon('trash', 24) }),
        el('p', { class: 'empty__title', text: 'A lixeira está vazia' }),
      ]));
    } else {
      const list = el('div', { class: 'item-list' });
      trashed.forEach((item) => {
        const line = el('div', { class: 'item', style: { cursor: 'default' } }, [
          el('div', { class: 'item__main' }, [
            el('div', { class: 'item__title', style: { color: 'var(--text-3)' }, text: item.title }),
            el('div', { class: 'item__meta' }, [
              el('span', { text: 'excluído ' + humanDate(item.deletedAt.slice(0, 10), p.timezone) }),
            ]),
          ]),
          el('div', { class: 'row gap-2' }, [
            el('button', {
              class: 'btn btn--ghost btn--sm',
              html: icon('clockBack', 14) + 'Restaurar',
              onClick: () => { store.restoreItem(item.id); toast('Item restaurado.'); rerender(); },
            }),
            el('button', {
              class: 'btn btn--danger btn--sm',
              html: icon('x', 14),
              'aria-label': 'Excluir definitivamente',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: 'Excluir definitivamente?',
                  message: 'Esta ação não tem volta.',
                  confirmLabel: 'Excluir de vez',
                });
                if (!ok) return;
                store.purgeItem(item.id);
                rerender();
              },
            }),
          ]),
        ]);
        list.appendChild(line);
      });
      panel.appendChild(list);

      panel.appendChild(el('button', {
        class: 'btn btn--danger btn--sm',
        style: { marginTop: 'var(--s-4)' },
        html: icon('trash', 15) + 'Esvaziar a lixeira',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Esvaziar a lixeira?',
            message: `${trashed.length} ${trashed.length === 1 ? 'item será removido' : 'itens serão removidos'} para sempre.`,
            confirmLabel: 'Esvaziar',
          });
          if (!ok) return;
          store.emptyTrash();
          toast('Lixeira esvaziada.');
          rerender();
        },
      }));
    }
  }

  /* ---------------- Dados e privacidade (§18, §19) ---------------- */
  if (active === 'data') {
    panel.appendChild(el('p', {
      class: 'setting-row__desc',
      style: { marginBottom: 'var(--s-4)', maxWidth: '68ch' },
      text: 'Seus dados são seus. O conteúdo das tarefas pode ser sensível — por isso ele nunca aparece em logs, mensagens de erro ou ferramentas de diagnóstico. Você pode consultar, exportar e apagar tudo a qualquer momento.',
    }));

    panel.append(
      row('Exportar em JSON', 'Estrutura completa: preferências, ambientes, itens e checklists.',
        el('button', {
          class: 'btn btn--outline btn--sm',
          html: icon('download', 15) + 'Baixar JSON',
          onClick: () => {
            downloadFile(`nestra-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON());
            toast('Exportação pronta.', { kind: 'success' });
          },
        })),
      row('Exportar em CSV', 'Para abrir em planilha.',
        el('button', {
          class: 'btn btn--outline btn--sm',
          html: icon('download', 15) + 'Baixar CSV',
          onClick: () => {
            downloadFile(`nestra-${new Date().toISOString().slice(0, 10)}.csv`, store.exportCSV(), 'text/csv');
            toast('Exportação pronta.', { kind: 'success' });
          },
        })),
    );

    const modeChip = el('div', {
      class: 'chip',
      style: { marginTop: 'var(--s-5)' },
      html: icon(store.state.mode === 'remote' ? 'shield' : 'lock', 13) +
        `<span>Modo atual: <b>${store.state.mode === 'remote' ? 'sincronizado com o Neon' : 'somente neste dispositivo'}</b></span>`,
    });
    panel.appendChild(modeChip);

    const apiField = el('input', {
      class: 'input',
      placeholder: 'https://sua-api.vercel.app/api',
      value: api.base || '',
    });
    apiField.addEventListener('change', () => {
      api.setBase(apiField.value.trim());
      toast('Endereço salvo. Recarregue a página para conectar.', { kind: 'success' });
    });

    panel.appendChild(el('div', { class: 'field', style: { marginTop: 'var(--s-4)' } }, [
      el('span', { class: 'field__label', text: 'Endereço da API' }),
      apiField,
      el('span', {
        class: 'field__hint',
        text: 'Sem uma API publicada, o Nestra funciona só neste navegador. O banco Neon nunca é acessado direto pelo navegador — as credenciais ficam no servidor.',
      }),
    ]));

    panel.appendChild(el('div', { class: 'danger-zone', style: { marginTop: 'var(--s-6)' } }, [
      el('h4', { text: 'Apagar todos os dados deste dispositivo' }),
      el('p', {
        class: 'setting-row__desc',
        text: 'Remove ambientes, itens e preferências guardados neste navegador. A conta continua existindo.',
      }),
      el('button', {
        class: 'btn btn--danger btn--sm',
        style: { marginTop: 'var(--s-3)' },
        html: icon('alert', 15) + 'Apagar dados locais',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Apagar os dados locais?',
            message: 'Tudo que está neste navegador será removido. Exporte antes se quiser guardar uma cópia.',
            confirmLabel: 'Apagar',
          });
          if (!ok) return;
          localStorage.removeItem(`nestra:data:${store.state.user.id}`);
          location.reload();
        },
      }),
    ]));
  }

  /* ---------------- Conta (§18) ---------------- */
  if (active === 'account') {
    const user = store.state.user || {};

    const nameInput = el('input', { class: 'input', value: user.displayName || '' });
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim();
      if (!v) return;
      store.state.user.displayName = v;
      store.persist();
      store.emit('auth', store.state.user);
      toast('Nome atualizado.', { kind: 'success' });
    });

    panel.append(
      row('Nome de exibição', 'Como o Nestra te chama.', nameInput),
      row('E-mail', 'Usado para entrar na conta.',
        el('span', { class: 'mono', style: { color: 'var(--text-3)' }, text: user.email || '—' })),
    );

    panel.appendChild(el('div', { class: 'danger-zone', style: { marginTop: 'var(--s-6)' } }, [
      el('h4', { text: 'Excluir a conta' }),
      el('p', {
        class: 'setting-row__desc',
        text: 'Remove a conta e todos os dados associados. Recomendamos exportar antes.',
      }),
      el('div', { class: 'row gap-2', style: { marginTop: 'var(--s-3)' } }, [
        el('button', {
          class: 'btn btn--outline btn--sm',
          html: icon('download', 15) + 'Exportar antes',
          onClick: () => downloadFile(`nestra-backup.json`, store.exportJSON()),
        }),
        el('button', {
          class: 'btn btn--danger btn--sm',
          html: icon('alert', 15) + 'Excluir minha conta',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Excluir a conta?',
              message: 'Todos os seus ambientes, itens e preferências serão removidos. Esta ação não tem volta.',
              confirmLabel: 'Excluir a conta',
            });
            if (!ok) return;
            store.deleteAccount();
            location.reload();
          },
        }),
      ]),
    ]));

    panel.appendChild(el('button', {
      class: 'btn btn--ghost btn--sm',
      style: { marginTop: 'var(--s-5)' },
      html: icon('clockBack', 15) + 'Restaurar preferências padrão',
      onClick: () => {
        store.setPrefs({ ...DEFAULT_PREFS, timezone: p.timezone });
        applyPrefs?.();
        toast('Preferências restauradas.');
        rerender();
      },
    }));
  }
}

/* ---------------------------------------------------------------------
   Caixa de entrada — itens sem ambiente
   --------------------------------------------------------------------- */
export function renderInbox(root, { onNavigate }) {
  const rerender = () => renderInbox(root, { onNavigate });
  const items = store.live
    .filter((i) => !i.environmentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  root.replaceChildren();

  root.appendChild(el('div', { class: 'view-head' }, [
    el('div', {}, [
      el('h1', { class: 'view-title', text: 'Caixa de entrada' }),
      el('p', { class: 'view-sub', text: 'Capturas que ainda não têm ambiente. Mova quando fizer sentido.' }),
    ]),
  ]));

  if (!items.length) {
    root.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__glyph', html: icon('inbox', 24) }),
      el('p', { class: 'empty__title', text: 'Tudo já tem um lugar' }),
      el('p', { class: 'empty__text', text: 'Nenhuma captura está solta no momento.' }),
    ]));
    return;
  }

  const list = el('div', { class: 'item-list stagger', role: 'list' });
  items.forEach((it) => list.appendChild(renderItem(it, { onChange: rerender })));
  root.appendChild(list);
}
