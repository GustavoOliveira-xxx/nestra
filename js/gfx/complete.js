/* =====================================================================
   NESTRA — O gesto de concluir

   Marcar uma coisa como feita é o clique mais repetido do app. Ele
   merece uma resposta à altura, e a resposta precisa ser do tamanho do
   site: nada de confete colorido caindo na tela — aqui a conclusão é um
   anel que se fecha, um visto que se desenha, faíscas na cor do item e a
   linha recuando em profundidade. A mesma linguagem seca e luminosa do
   resto da interface.

   Tudo o que acontece fora da linha mora na camada de efeitos, em
   posição fixa: a tela se redesenha logo depois do clique, e a animação
   não pode morrer junto com o nó que a começou.

   Quem chama daqui não precisa saber de nada disso — recebe de volta
   quantos milissegundos vale a pena esperar antes de redesenhar.
   ===================================================================== */

import { quality } from '../core/device.js';
import { pulseEnvHeroes } from './envhero.js';

const reduced = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  (document.documentElement.dataset.motion !== 'full' &&
   window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function fxLayer() {
  let layer = document.querySelector('.fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

/**
 * A cor que o efeito deve usar.
 *
 * As cores do app moram em variáveis CSS encadeadas (`--type-color` vale
 * `var(--type-task)`, que vale `var(--blue-400)`), e ler a variável
 * devolve o encadeamento, não a cor. Ler uma propriedade que o navegador
 * precisou resolver de verdade — a cor de fundo de um elemento — devolve
 * o `rgb()` final, que é o que serve para pintar faísca.
 */
export function resolveColor(el, fallbackVar = '--accent') {
  const probe = el?.querySelector?.('.item__type');
  if (probe) {
    const bg = getComputedStyle(probe).backgroundColor;
    if (bg && bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0')) return bg;
  }
  const root = getComputedStyle(document.documentElement).getPropertyValue(fallbackVar).trim();
  return root || '#2F6BFF';
}

/* ---------------------------------------------------------------------
   O selo: um anel que se fecha e um visto que se desenha

   É a peça central do gesto. Nasce medida pelo alvo — a caixinha de
   marcar na linha, o botão largo na tela de detalhes — para nunca ficar
   grande demais num lugar e pequena demais no outro.
   --------------------------------------------------------------------- */
function stamp(layer, x, y, size, color) {
  /* Clarão curto por baixo de tudo: é o que dá o "estalo" do gesto sem
     precisar de nenhum elemento a mais na tela depois. */
  const flash = document.createElement('span');
  flash.className = 'fx-done-flash';
  flash.style.left = x + 'px';
  flash.style.top = y + 'px';
  flash.style.width = flash.style.height = size * 1.6 + 'px';
  flash.style.background =
    `radial-gradient(circle, ${color} 0%, transparent 68%)`;
  layer.appendChild(flash);
  flash.animate([
    { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.55, offset: 0.22 },
    { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
  setTimeout(() => flash.remove(), 560);

  /* Anel de fora: abre largo e fino, como a onda que sai do ponto. */
  const halo = document.createElement('span');
  halo.className = 'fx-done-halo';
  halo.style.left = x + 'px';
  halo.style.top = y + 'px';
  halo.style.width = halo.style.height = size + 'px';
  halo.style.borderColor = color;
  layer.appendChild(halo);
  halo.animate([
    { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0, borderWidth: '2px' },
    { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 0.9, offset: 0.2, borderWidth: '2px' },
    { transform: 'translate(-50%,-50%) scale(2.7)', opacity: 0, borderWidth: '0.5px' },
  ], { duration: 700, delay: 80, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
  setTimeout(() => halo.remove(), 800);

  /* O selo: o anel se fecha e o visto é traçado dentro dele. */
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fx-done');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.style.width = svg.style.height = size + 'px';
  svg.style.left = x + 'px';
  svg.style.top = y + 'px';
  svg.style.color = color;

  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  ring.setAttribute('class', 'fx-done__ring');
  ring.setAttribute('cx', '50');
  ring.setAttribute('cy', '50');
  ring.setAttribute('r', '34');

  const tick = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tick.setAttribute('class', 'fx-done__tick');
  tick.setAttribute('d', 'M33 51 L45 63 L68 37');

  svg.append(ring, tick);
  layer.appendChild(svg);

  const CIRC = 2 * Math.PI * 34;   // 213.6
  const TICK = 51;                 // comprimento aproximado do visto

  ring.animate([
    { strokeDasharray: String(CIRC), strokeDashoffset: String(CIRC) },
    { strokeDasharray: String(CIRC), strokeDashoffset: '0' },
  ], { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });

  tick.animate([
    { strokeDasharray: String(TICK), strokeDashoffset: String(TICK), opacity: 1 },
    { strokeDasharray: String(TICK), strokeDashoffset: '0', opacity: 1 },
  ], { duration: 220, delay: 170, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' });

  // Fechou: o selo abre e some, deixando a linha falar por si
  svg.animate([
    { transform: 'translate(-50%,-50%) scale(.82)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.18 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.62 },
    { transform: 'translate(-50%,-50%) scale(1.9)', opacity: 0 },
  ], { duration: 760, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });

  setTimeout(() => svg.remove(), 820);
}

/* ---------------------------------------------------------------------
   Faíscas com peso

   Saem para cima, perdem força e caem — o mesmo movimento de qualquer
   coisa jogada para o alto. Sem gravidade elas viram uma explosão de
   desenho animado, que é justamente o que este site não é.
   --------------------------------------------------------------------- */
function sparks(layer, x, y, color, count) {
  const host = document.createElement('div');
  host.className = 'fx-sparks';
  host.style.left = x + 'px';
  host.style.top = y + 'px';
  layer.appendChild(host);

  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    // Leque para cima: o gesto é de alívio, de tirar peso de cima
    const angle = -Math.PI / 2 + (i / count - 0.5) * 2.5 + (Math.random() - 0.5) * 0.4;
    const speed = 34 + Math.random() * 74;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed;
    const drop = 34 + Math.random() * 46;
    const len = 3 + Math.random() * 5;
    const hot = i % 5 === 0;

    bit.style.width = len + 'px';
    bit.style.height = (hot ? 2.5 : 2) + 'px';
    bit.style.background = hot ? '#fff' : color;
    bit.style.boxShadow = `0 0 7px ${color}`;
    host.appendChild(bit);

    bit.animate([
      { transform: `translate(0,0) rotate(${angle}rad) scaleX(1)`, opacity: 1 },
      {
        transform: `translate(${dx * 0.62}px, ${dy * 0.62}px) rotate(${angle}rad) scaleX(1.6)`,
        opacity: 1,
        offset: 0.42,
      },
      {
        transform: `translate(${dx}px, ${dy + drop}px) rotate(${angle * 0.4}rad) scaleX(.3)`,
        opacity: 0,
      },
    ], {
      duration: 620 + Math.random() * 420,
      easing: 'cubic-bezier(.22,.7,.35,1)',
      fill: 'forwards',
    });
  }

  setTimeout(() => host.remove(), 1200);
}

/* ---------------------------------------------------------------------
   O efeito completo, ancorado num elemento qualquer
   --------------------------------------------------------------------- */
export function completionEffect(anchor, { color = '#2F6BFF', scale = 1 } = {}) {
  if (reduced() || !anchor?.getBoundingClientRect) return;

  const r = anchor.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const layer = fxLayer();

  const size = Math.max(42, Math.min(112, Math.max(r.width, r.height) * 3.4)) * scale;
  stamp(layer, x, y, size, color);

  const count = Math.max(8, Math.round(18 * scale * quality.scale));
  sparks(layer, x, y, color, count);

  // A cena de fundo sente a conclusão no ponto exato dela, e a peça 3D
  // do ambiente responde junto: é dela que a tela toda fala.
  window.nestraScene?.ripple(
    x / window.innerWidth,
    y / window.innerHeight,
    1.1 * scale,
  );
  pulseEnvHeroes(scale);
}

/* ---------------------------------------------------------------------
   A linha inteira concluindo

   Além do selo, a própria linha responde: uma luz varre da esquerda para
   a direita, a trilha do tipo acende e o conjunto recua em profundidade
   (ou some, conforme a preferência de quem usa).

   Devolve quantos milissegundos vale esperar antes de redesenhar a tela,
   para a animação não ser cortada no meio pelo próprio redesenho.
   --------------------------------------------------------------------- */
export function celebrateCompletion(row, anchor, { color, mode = 'fade' } = {}) {
  const tone = color || resolveColor(row);

  if (reduced()) return 0;

  completionEffect(anchor || row, { color: tone });

  if (row) {
    row.style.setProperty('--done-color', tone);

    /* A varredura de luz é um nó próprio: assim ela pode sair sozinha,
       sem depender de nenhuma regra de estado da linha. */
    const sweep = document.createElement('span');
    sweep.className = 'item__sweep';
    sweep.setAttribute('aria-hidden', 'true');
    row.appendChild(sweep);
    setTimeout(() => sweep.remove(), 720);

    row.classList.add(mode === 'hide' ? 'item--completing' : 'item--settled');
  }

  if (anchor) {
    anchor.classList.add('check--just-done');
    setTimeout(() => anchor.classList.remove('check--just-done'), 700);
  }

  // Some da lista precisa de mais tempo em cena; ficar precisa de menos
  return mode === 'hide' ? 520 : 360;
}
