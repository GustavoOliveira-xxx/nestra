#!/usr/bin/env node
/* =====================================================================
   NESTRA — Testes das partes que já quebraram

   Uso:
     npm test

   Não é uma suíte de tudo: são os dois pontos que voltaram a falhar
   depois de já terem sido corrigidos, e que agora ficam travados aqui.

     1. O ditado que repetia no celular. O reconhecimento do Android
        reentrega a frase inteira crescida a cada evento, e reabre o
        microfone sozinho depois de cada pausa. As sequências reais estão
        reproduzidas abaixo — nenhuma delas precisa de microfone.

     2. A data que virava NaN depois de recarregar a página. A coluna
        `date` do Postgres chega como Date do JavaScript, e convertê-la
        com `String(...).slice(0, 10)` produzia "Wed Aug 19". O teste passa
        pelo conversor de verdade do driver, em vários fusos de servidor.
   ===================================================================== */

/* O cliente do Neon é construído no import de api/_lib/db.js e recusa
   nascer sem string de conexão. Nenhuma conexão é aberta neste teste —
   só as funções de conversão são exercitadas. */
process.env.DATABASE_URL ||= 'postgresql://ninguem:nada@localhost/vazio';

let falhas = 0;
let total = 0;

function eq(nome, obtido, esperado) {
  total++;
  const ok = Object.is(obtido, esperado);
  if (!ok) falhas++;
  console.log(`${ok ? '  ok  ' : '  FALHA'} ${nome}`);
  if (!ok) {
    console.log(`         esperado: ${JSON.stringify(esperado)}`);
    console.log(`         obtido:   ${JSON.stringify(obtido)}`);
  }
}

/* =====================================================================
   1. DITADO
   ===================================================================== */

/** Uma lista de resultados no formato que o navegador entrega. */
function resultados(pares) {
  return pares.map(([texto, isFinal]) => {
    const r = [{ transcript: texto }];
    r.isFinal = isFinal;
    return r;
  });
}

/** Reconhecimento de mentira, com as manias do Android. */
const criados = [];
class FakeRecognition {
  constructor() { criados.push(this); this.iniciado = 0; }
  start() {
    this.iniciado++;
    if (this.iniciado > 1) throw new Error('InvalidStateError');
    queueMicrotask(() => this.onstart?.());
  }
  stop() { queueMicrotask(() => this.onend?.()); }
  abort() { queueMicrotask(() => this.onend?.()); }
  entregar(pares) { this.onresult?.({ results: resultados(pares) }); }
  encerrar() { this.onend?.(); }
}

globalThis.window = { SpeechRecognition: FakeRecognition };
const { VoiceCapture, mergeSpoken } = await import('../js/app/voice.js');

const proximoQuadro = () => new Promise((r) => setTimeout(r, 0));

console.log('\nDitado');

{
  /* O padrão do Android: cada entrega traz a frase inteira, maior. */
  const v = new VoiceCapture();
  v.applyResults(resultados([
    ['pegar', true],
    ['pegar ração', true],
    ['pegar ração para o Max', true],
  ]));
  eq('escada de finais numa sessão', v.text, 'pegar ração para o Max');
}

{
  /* O provisório costuma repetir o definitivo, acrescido do fim. */
  const v = new VoiceCapture();
  v.committed = 'comprar pão';
  v.applyResults(resultados([['comprar pão integral', false]]));
  eq('provisório que contém o definitivo', v.text, 'comprar pão integral');
}

{
  /* O que é fala nova continua somando, que é o caso comum. */
  const v = new VoiceCapture();
  v.committed = 'comprar pão';
  v.applyResults(resultados([['ligar para o João', true]]));
  eq('frases diferentes somam', v.text, 'comprar pão ligar para o João');
}

eq('acento e maiúscula não enganam',
  mergeSpoken('Comprar pao', 'comprar pão amanhã'), 'comprar pão amanhã');
eq('o encaixe respeita fronteira de palavra',
  mergeSpoken('sim', 'simples assim'), 'sim simples assim');
eq('reentrega menor não apaga o que já havia',
  mergeSpoken('pegar ração para o Max', 'pegar ração'), 'pegar ração para o Max');

{
  /* O navegador reabre o microfone depois da pausa e, no celular,
     reentrega a sessão anterior junto. */
  criados.length = 0;
  const v = new VoiceCapture();
  v.start();
  await proximoQuadro();
  criados[0].entregar([['comprar pão', true]]);
  criados[0].encerrar();
  await proximoQuadro();

  eq('cada volta abre um reconhecimento novo', criados.length, 2);
  criados[1].entregar([['comprar pão', true], ['comprar pão e leite', true]]);
  eq('sessão anterior reentregue não duplica', v.text, 'comprar pão e leite');
  v.stop();
  await proximoQuadro();
}

{
  /* Dois toques seguidos no microfone — comum em tela de toque. */
  criados.length = 0;
  const v = new VoiceCapture();
  const primeiro = v.start();
  const segundo = v.start();
  await proximoQuadro();
  eq('primeiro toque abre', primeiro, true);
  eq('segundo toque é recusado', segundo, false);
  eq('um reconhecimento só', criados.length, 1);
  v.stop();
  await proximoQuadro();
}

{
  /* Um ditado inteiro, com pausas, do jeito que acontece. */
  criados.length = 0;
  const v = new VoiceCapture();
  v.start();
  await proximoQuadro();
  criados[0].entregar([['reunião com o professor', true]]);
  criados[0].encerrar();
  await proximoQuadro();
  criados[1].entregar([
    ['reunião com o professor', true],
    ['reunião com o professor quinta', true],
  ]);
  criados[1].encerrar();
  await proximoQuadro();
  criados[2].entregar([['às 19h', true]]);
  eq('frase longa com pausas', v.text, 'reunião com o professor quinta às 19h');
  v.stop();
  await proximoQuadro();
}

/* =====================================================================
   2. DATAS VINDAS DO BANCO
   ===================================================================== */

console.log('\nDatas');

const { types } = await import('@neondatabase/serverless');
const { itemToClient } = await import('../api/_lib/db.js');
const { humanDate } = await import('../js/app/nlp.js');

const comoOBancoEntrega = (data, hora) => ({
  id: 'x', environment_id: null, type: 'task', title: 'reunião',
  description: null, status: 'pending', priority: 'normal',
  due_date: types.getTypeParser(1082)(data),      // date  → Date do JS
  due_time: types.getTypeParser(1083)(hora),      // time  → texto
  snoozed_until: null, time_period: 'any', pinned: false,
  source: 'manual', raw_input: null, parse_confidence: null,
  needs_review: false, completed_at: null, deleted_at: null,
  created_at: null, updated_at: null, checklist: [], tags: [],
});

const item = itemToClient(comoOBancoEntrega('2026-08-19', '19:00:00'));
eq(`coluna date vira AAAA-MM-DD (fuso do servidor: ${process.env.TZ || 'padrão'})`,
  item.dueDate, '2026-08-19');
eq('coluna time vira HH:MM', item.dueTime, '19:00');
eq('data nula continua nula', itemToClient(comoOBancoEntrega(null, null)).dueDate, null);

/* A tela nunca deve escrever NaN, aconteça o que acontecer com o dado. */
eq('data ilegível não vira texto', humanDate('Wed Aug 19', 'America/Sao_Paulo'), null);
eq('data vazia não vira texto', humanDate(null, 'America/Sao_Paulo'), null);
eq('data boa vira texto', typeof humanDate('2026-08-19', 'America/Sao_Paulo'), 'string');

/* =====================================================================
   Fecho
   ===================================================================== */

console.log(falhas
  ? `\n${falhas} de ${total} falharam\n`
  : `\n${total} verificações, todas passaram\n`);

process.exit(falhas ? 1 : 0);
