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

     2. A camada de “secretário”: pedidos falados viram ações curtas sem
        perder data, horário, ambiente nem a frase original.

     3. A data que virava NaN depois de recarregar a página. A coluna
        `date` do Postgres chega como Date do JavaScript, e convertê-la
        com `String(...).slice(0, 10)` produzia "Wed Aug 19". O teste passa
        pelo conversor de verdade do driver, em vários fusos de servidor.

     4. A fila que podia apagar um cadastro novo durante outro envio ou
        mandar o item antes do ambiente do qual ele dependia.
   ===================================================================== */

/* O cliente do Neon é construído no import de api/_lib/db.js e recusa
   nascer sem string de conexão. Nenhuma conexão é aberta neste teste —
   só as funções de conversão são exercitadas. */
import fs from 'node:fs';

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
const { parse, humanDate, todayIn, toISODate } = await import('../js/app/nlp.js');

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
  /* A tela pode ser trocada antes de o navegador confirmar `start()`. */
  criados.length = 0;
  const v = new VoiceCapture();
  v.start();
  v.abort();
  await proximoQuadro();
  await proximoQuadro();
  eq('abortar durante a abertura não reabre o microfone', criados.length, 1);
  eq('abortar durante a abertura mantém o estado desligado', v.running, false);
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
   2. SECRETÁRIO LOCAL
   ===================================================================== */

console.log('\nSecretário local');

const secretarioContexto = {
  timezone: 'America/Sao_Paulo',
  environments: [
    { id: 'env-estudos', name: 'Estudos' },
    { id: 'env-pessoal', name: 'Pessoal' },
  ],
};

const interpretar = (frase) => parse(frase, secretarioContexto);

eq('pedido de lembrança vira somente a ação',
  interpretar('Preciso lembrar de limpar o quintal').title,
  'Limpar o quintal');
eq('pedido de lembrança mantém o tipo',
  interpretar('Preciso lembrar de limpar o quintal').type,
  'reminder');

const atividade = interpretar('Nestra, preciso fazer uma atividade de português valendo nota até sexta');
eq('chamada e moldura saem da atividade',
  atividade.title, 'Fazer uma atividade de português valendo nota');
eq('vocabulário escolar encontra Estudos', atividade.environmentId, 'env-estudos');

const contextoFaculdade = {
  ...secretarioContexto,
  environments: [{ id: 'env-faculdade', name: 'Faculdade' }],
};
eq('vocabulário escolar respeita ambiente equivalente cadastrado',
  parse('Preciso terminar a atividade de português', contextoFaculdade).environmentId,
  'env-faculdade');

eq('pedido educado e chamada também saem',
  interpretar('Ei Nestra, por favor me lembra de comprar ração amanhã').title,
  'Comprar ração');
eq('comando e obrigação empilhados saem',
  interpretar('Anota aí que eu tenho que ligar para o João quinta às 19h').title,
  'Ligar para o João');
eq('pergunta de cadastro não deixa interrogação',
  interpretar('Você poderia adicionar uma tarefa para revisar o relatório até amanhã?').title,
  'Revisar o relatório');
eq('cortesia no fim da frase sai',
  interpretar('Comprar pão amanhã, por favor').title,
  'Comprar pão');
eq('comando no fim da frase sai',
  interpretar('Comprar pão amanhã, coloca isso na minha lista').title,
  'Comprar pão');
eq('pedido para não esquecer pode vir em camadas',
  interpretar('Nestra, coloca aí pra eu não esquecer de limpar o quintal').title,
  'Limpar o quintal');
eq('pedido indireto também vira ação',
  interpretar('Queria pedir pra você anotar que eu tenho que pagar a conta até sexta').title,
  'Pagar a conta');
eq('data e período antes da ação não atrapalham',
  interpretar('Amanhã de manhã eu tenho que levar o carro na revisão').title,
  'Levar o carro na revisão');
eq('prazo longo pode abrir a fala',
  interpretar('Até o fim de semana eu preciso entregar o projeto').title,
  'Entregar o projeto');
eq('ação implícita de atividade ganha verbo',
  interpretar('Tenho uma atividade de matemática valendo nota até sexta').title,
  'Fazer uma atividade de matemática valendo nota');
eq('comando de agenda vai ao infinitivo',
  interpretar('Nestra, agende uma consulta com o dentista amanhã às 14h').title,
  'Agendar uma consulta com o dentista');
eq('nome Nestra dentro da ação não é removido',
  interpretar('Atualizar o Nestra').title,
  'Atualizar o Nestra');
eq('a frase falada inteira continua preservada',
  atividade.raw,
  'Nestra, preciso fazer uma atividade de português valendo nota até sexta');

const daquiDuasSemanas = interpretar('Daqui a 2 semanas preciso revisar orçamento');
eq('daqui a N semanas não vira horário', daquiDuasSemanas.dueTime, null);
eq('data relativa não corrompe letras da ação', daquiDuasSemanas.title, 'Revisar orçamento');

const base = todayIn(secretarioContexto.timezone);
const depoisDeAmanha = new Date(base.getTime());
depoisDeAmanha.setUTCDate(depoisDeAmanha.getUTCDate() + 2);
eq('depois de amanhã é data exata, não expressão vaga',
  interpretar('Depois de amanhã preciso buscar a encomenda').dueDate,
  toISODate(depoisDeAmanha));
eq('quando der continua sem inventar prazo',
  interpretar('Quando der preciso limpar a garagem').dueDate,
  null);

const falaRelatada = interpretar(
  'Nestra preciso lembrar de configurar o Macbook na casa da minha vó à noite mais ou menos umas 9: 00 domingo à noite mais ou menos umas da noite',
);
eq('fala real deixa somente a ação', falaRelatada.title,
  'Configurar o Macbook na casa da minha vó');
eq('horário com espaço depois dos dois-pontos é lido', falaRelatada.dueTime, '21:00');
eq('nove da noite vira 21h', falaRelatada.timePeriod, 'evening');
eq('repetição do período não exige revisão', falaRelatada.needsReview, false);
eq('referência familiar encontra Pessoal', falaRelatada.environmentId, 'env-pessoal');

const noveDaNoite = interpretar('Me lembra de ligar pra vó domingo umas 9 da noite');
eq('horário aproximado sem às é lido', noveDaNoite.dueTime, '21:00');
eq('moldura aproximada não entra na ação', noveDaNoite.title, 'Ligar pra vó');

const noveDaManha = interpretar('Amanhã às 9 da manhã preciso levar o carro');
eq('nove da manhã permanece 09h', noveDaManha.dueTime, '09:00');
eq('período antes da obrigação sai do título', noveDaManha.title, 'Levar o carro');

eq('por volta das nove da noite vira 21h',
  interpretar('Ligar para Ana domingo por volta das 9 da noite').dueTime, '21:00');
eq('aproximadamente com hora e minuto é lido',
  interpretar('Amanhã aproximadamente 14: 30 revisar o contrato').dueTime, '14:30');
eq('horário sem preposição e com espaço é lido',
  interpretar('Reunião terça 08: 05').dueTime, '08:05');
eq('meia-noite falada como doze da noite vira zero hora',
  interpretar('Fechar o caixa às 12 da noite').dueTime, '00:00');
eq('meio-dia falado como doze da tarde permanece doze horas',
  interpretar('Almoçar às 12 da tarde').dueTime, '12:00');

/* =====================================================================
   3. DATAS VINDAS DO BANCO
   ===================================================================== */

console.log('\nDatas');

const { types } = await import('@neondatabase/serverless');
const { itemToClient, environmentToClient, prefsToClient } = await import('../api/_lib/db.js');
const { isUuid, isDateOnly, isTimeOnly, validTimestamp } = await import('../api/_lib/http.js');

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
eq('UUID válido é aceito', isUuid('11111111-1111-4111-8111-111111111111'), true);
eq('UUID com lixo adicional é recusado', isUuid('11111111-1111-4111-8111-111111111111x'), false);
eq('dia inexistente é recusado pela API', isDateOnly('2026-02-30'), false);
eq('ano bissexto é aceito pela API', isDateOnly('2028-02-29'), true);
eq('horário depois de 23:59 é recusado', isTimeOnly('24:00'), false);
eq('horário válido é aceito', isTimeOnly('21:00'), true);
eq('timestamp inválido é recusado', validTimestamp('não é data'), null);

const ambienteConvertido = environmentToClient({
  id: 'env', name: 'Casa', slug: 'casa', description: null, color: '#2F6BFF',
  icon: 'home', position: 0, is_default: false, archived_at: null,
  created_at: '2026-08-20T10:00:00.000Z', updated_at: '2026-08-21T11:00:00.000Z',
});
eq('alteração remota do ambiente leva updatedAt para o navegador',
  ambienteConvertido.updatedAt, '2026-08-21T11:00:00.000Z');

const preferenciasConvertidas = prefsToClient({
  theme: 'nestra-noturno', accent: '#2F6BFF', density: 'comfortable', motion: 'full',
  high_contrast: false, glow_intensity: 70, corner_style: 'square', week_start: 0,
  date_format: 'dd/MM/yyyy', time_format: '24h', start_view: 'today',
  default_environment_id: null, show_undated_on_today: false,
  show_high_priority_outside_today: true, confirm_before_delete: true,
  after_complete: 'fade', nl_parsing_enabled: true, sound_enabled: false,
}, {
  enabled: true, due_items: false, commitments: true, overdue_items: false, lead_minutes: 45,
});
eq('preferências de notificações vêm do banco', preferenciasConvertidas.notificationsEnabled, true);
eq('antecedência de notificação vem do banco', preferenciasConvertidas.notifyLeadMinutes, 45);

/* =====================================================================
   4. FILA DE SINCRONIZAÇÃO
   ===================================================================== */

console.log('\nSincronização');

const memoria = new Map();
globalThis.localStorage = {
  getItem: (key) => memoria.has(key) ? memoria.get(key) : null,
  setItem: (key, value) => memoria.set(key, String(value)),
  removeItem: (key) => memoria.delete(key),
};

const fetchOriginal = globalThis.fetch;
const { api, syncQueue } = await import('../js/app/api.js');
const { store } = await import('../js/app/store.js');
api.base = 'https://nestra.invalid/api';
api.online = true;
syncQueue.setOwner('user-test');

const respostaOk = () => ({
  ok: true,
  status: 200,
  text: async () => '{"ok":true}',
});

{
  syncQueue.clear();
  const chamadas = [];
  let liberarPrimeira;
  let primeiraComecou;
  const comecou = new Promise((resolve) => { primeiraComecou = resolve; });
  const bloqueio = new Promise((resolve) => { liberarPrimeira = resolve; });

  globalThis.fetch = async (url) => {
    chamadas.push(url);
    if (chamadas.length === 1) {
      primeiraComecou();
      await bloqueio;
    }
    return respostaOk();
  };

  syncQueue.push({ method: 'POST', path: '/environments', body: { id: 'ambiente' } });
  const envio = syncQueue.flush();
  await comecou;
  syncQueue.push({ method: 'POST', path: '/items', body: { id: 'item' } });
  liberarPrimeira();
  await envio;

  eq('cadastro feito durante outro envio também sobe', chamadas.length, 2);
  eq('fila termina vazia sem apagar operação nova', syncQueue.size(), 0);
}

{
  syncQueue.clear();
  store.state.mode = 'remote';
  store.state.user = { id: 'user-test', displayName: 'Teste', email: 'teste@example.test' };
  store.state.items = [
    { id: '11111111-1111-4111-8111-111111111111', deletedAt: '2026-08-20T10:00:00.000Z' },
    { id: '22222222-2222-4222-8222-222222222222', deletedAt: '2026-08-21T10:00:00.000Z' },
    { id: '33333333-3333-4333-8333-333333333333', deletedAt: null },
  ];
  store.emptyTrash();
  clearTimeout(store._flushTimer);

  eq('esvaziar lixeira mantém itens ativos', store.state.items.length, 1);
  eq('esvaziar lixeira enfileira cada exclusão remota', syncQueue.size(), 2);
  eq('exclusão remota é definitiva',
    syncQueue.read().every((op) => op.method === 'DELETE' && op.path.endsWith('?purge=1')), true);
  syncQueue.clear();
}

{
  store.state.prefs = { theme: 'nestra-noturno' };
  store.state.environments = [];
  store.state.items = [{
    id: 'item', title: 'Teste', status: 'pending', checklist: [{ id: 'passo', title: 'A', completed: false }],
  }];
  const beforeChecklist = store.signature();
  store.state.items[0].checklist[0].completed = true;
  eq('mudança remota de checklist provoca redesenho', beforeChecklist !== store.signature(), true);

  const beforePrefs = store.signature();
  store.state.prefs.theme = 'alto-contraste';
  eq('mudança remota de preferência provoca redesenho', beforePrefs !== store.signature(), true);
}

{
  syncQueue.clear();
  const chamadas = [];
  globalThis.fetch = async (url) => {
    chamadas.push(url);
    throw new TypeError('rede caiu');
  };

  syncQueue.push({ method: 'POST', path: '/environments', body: { id: 'ambiente' } });
  syncQueue.push({ method: 'POST', path: '/items', body: { id: 'item', environmentId: 'ambiente' } });
  await syncQueue.flush();

  eq('falha temporária preserva a ordem ambiente antes do item', chamadas.length, 1);
  eq('operações dependentes continuam guardadas', syncQueue.size(), 2);
  eq('tentativa fica registrada para o próximo envio', syncQueue.read()[0].tries, 1);
}

{
  syncQueue.clear();
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => '{"code":"invalid","message":"Alteração inválida"}',
  });
  syncQueue.push({ method: 'PUT', path: '/items/invalido', body: { title: '' } });
  await syncQueue.flush();
  eq('falha permanente não finge que sincronizou', syncQueue.failedSize(), 1);
  eq('falha permanente sai da fila ativa', syncQueue.size(), 0);
  eq('falha permanente pode ser tentada de novo', syncQueue.retryFailed(), 1);
  eq('nova tentativa volta para a fila ativa', syncQueue.size(), 1);
  syncQueue.clear();
}

{
  syncQueue.setOwner('conta-a');
  syncQueue.clear();
  syncQueue.push({ method: 'POST', path: '/items', body: { title: 'A' } });
  syncQueue.setOwner('conta-b');
  syncQueue.clear();
  eq('fila de outra conta não é enviada pela sessão atual', syncQueue.size(), 0);
  syncQueue.setOwner('conta-a');
  eq('alteração pendente continua vinculada à conta correta', syncQueue.size(), 1);
  syncQueue.clear();
  syncQueue.setOwner('user-test');
}

syncQueue.clear();
globalThis.fetch = fetchOriginal;

/* =====================================================================
   5. PWA EM PREVIEW PROTEGIDO
   ===================================================================== */

console.log('\nPWA e publicação');

{
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  eq('manifesto envia credenciais no preview protegido do Vercel',
    /<link\s+rel=["']manifest["'][^>]*crossorigin=["']use-credentials["'][^>]*>/i.test(index), true);
}

/* =====================================================================
   Fecho
   ===================================================================== */

console.log(falhas
  ? `\n${falhas} de ${total} falharam\n`
  : `\n${total} verificações, todas passaram\n`);

process.exit(falhas ? 1 : 0);
