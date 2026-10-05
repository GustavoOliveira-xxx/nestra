import Anthropic from '@anthropic-ai/sdk';
import { sql } from './_lib/db.js';
import { handler, json, fail, readBody } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';

const MODEL = process.env.NESTRA_AI_MODEL || 'claude-opus-5-5';
const HOURLY_LIMIT = 80;

const KINDS = ['update', 'plan', 'blocker', 'question', 'decision', 'notice', 'idea', 'topic'];

const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topics'],
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'kind', 'detail', 'who', 'children'],
        properties: {
          label: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          detail: { type: 'string' },
          who: { type: 'string' },
          children: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'kind'],
              properties: {
                label: { type: 'string' },
                kind: { type: 'string', enum: KINDS },
              },
            },
          },
        },
      },
    },
  },
};

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'followUps'],
  properties: {
    summary: { type: 'string' },
    followUps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'due'],
        properties: {
          title: { type: 'string' },
          due: { type: 'string', enum: ['today', 'tomorrow', 'this_week', 'none'] },
        },
      },
    },
  },
};

const MAP_SYSTEM = `Você é o copiloto de reuniões do Nestra, um organizador pessoal em português do Brasil.
A pessoa vai participar de uma reunião e despejou, do jeito que pensou, o que precisa falar.
Transforme isso em tópicos curtos para um mapa mental que ela vai olhar durante a reunião.

Regras:
- label: no máximo 6 palavras, direto, sem verbo de intenção ("preciso falar", "lembrar de").
- detail: uma frase com o contexto que ajuda a falar sobre o tópico; vazio se não houver.
- who: nome da pessoa envolvida quando a frase citar alguém; vazio caso contrário.
- kind: update (algo feito ou andamento), plan (o que vai fazer), blocker (impedimento ou dependência),
  question (dúvida para alguém), decision (algo que precisa ser decidido), notice (aviso),
  idea (sugestão), topic (assunto geral).
- children: subpontos concretos quando a frase listar vários itens; caso contrário, lista vazia.
- Não invente assuntos que não estejam no texto ou no contexto. Junte repetições.
- Em uma daily, prefira classificar como update, plan e blocker.
- Tópicos não falados na reunião anterior vêm no contexto; inclua somente os que ainda fizerem sentido.`;

const SUMMARY_SYSTEM = `Você é o copiloto de reuniões do Nestra, em português do Brasil.
Receberá o mapa de uma reunião: tópicos, se foram falados, e anotações feitas durante a reunião.
Escreva uma ata curta em texto simples, com estas partes quando houver conteúdo:
"Falado", "Ficou para depois" e "Combinados". Use frases curtas começando com "- ".
Em followUps, liste apenas ações concretas que a própria pessoa precisa fazer, com verbo no infinitivo.`;

function contextBlock(body) {
  const lines = [];
  if (body.meeting) lines.push(`Reunião: ${String(body.meeting).slice(0, 80)}`);
  if (body.template) lines.push(`Formato: ${String(body.template).slice(0, 20)}`);
  const carry = Array.isArray(body.carry) ? body.carry.slice(0, 20) : [];
  if (carry.length) {
    lines.push('Ficou sem falar na última vez:');
    carry.forEach((c) => lines.push(`- ${String(c).slice(0, 200)}`));
  }
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  if (items.length) {
    lines.push('Itens do Nestra ligados a esta reunião (vencendo ou atrasados):');
    items.forEach((c) => lines.push(`- ${String(c).slice(0, 200)}`));
  }
  return lines.join('\n');
}

function outline(nodes) {
  const list = Array.isArray(nodes) ? nodes.slice(0, 200) : [];
  const children = (id) => list.filter((n) => (n.parentId || null) === id && n.kind !== 'root');
  const root = list.find((n) => n.kind === 'root');
  const lines = [];
  const walk = (parentId, depth) => {
    children(parentId).forEach((n) => {
      const mark = n.done ? '[falado]' : '[não falado]';
      lines.push(`${'  '.repeat(depth)}- ${mark} (${n.kind}) ${String(n.text || '').slice(0, 240)}` +
        (n.note ? ` | anotação: ${String(n.note).slice(0, 600)}` : ''));
      walk(n.id, depth + 1);
    });
  };
  walk(root ? root.id : null, 0);
  return lines.join('\n');
}

async function overLimit(userId) {
  const rows = await sql`
    select count(*)::int as n from account_events
     where user_id = ${userId} and type = 'ai_request' and created_at > now() - interval '1 hour'
  `;
  return (rows[0]?.n || 0) >= HOURLY_LIMIT;
}

async function ask(system, user, schema) {
  try {
    return await callModel(system, user, schema);
  } catch (err) {
    if (err?.code === 'ai_refused') throw err;
    console.error('[assistant]', err?.status || '', err?.message || err);
    const wrapped = new Error('O assistente do servidor não respondeu. Usando o modo local.');
    wrapped.status = 502; wrapped.code = 'ai_failed'; wrapped.expose = true;
    throw wrapped;
  }
}

async function callModel(system, user, schema) {
  const client = new Anthropic({ timeout: 50_000, maxRetries: 1 });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') {
    const err = new Error('O assistente não conseguiu responder a este pedido.');
    err.status = 422; err.code = 'ai_refused'; err.expose = true;
    throw err;
  }
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Resposta vazia do modelo.');
  return JSON.parse(block.text);
}

export default handler(async (req, res) => {
  if (req.method === 'GET') {
    return json(res, 200, { enabled: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL });
  }
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(res, 503, 'ai_unconfigured', 'A IA do servidor não está configurada.');
  }
  if (await overLimit(user.id)) {
    return fail(res, 429, 'ai_rate_limited', 'Muitos pedidos ao assistente nesta hora. Usando o modo local.');
  }

  const body = await readBody(req);
  await sql`insert into account_events (user_id, type) values (${user.id}, 'ai_request')`;

  if (body.mode === 'map') {
    const typed = String(body.text || '').slice(0, 6000);
    const context = contextBlock(body);
    if (!typed.trim() && !context) return fail(res, 400, 'empty', 'Escreva o que precisa falar.');
    const prompt = `${context}\n\nO que a pessoa escreveu:\n"""${typed || '(nada além do contexto)'}"""`;
    const out = await ask(MAP_SYSTEM, prompt, MAP_SCHEMA);
    return json(res, 200, { source: 'ai', topics: Array.isArray(out.topics) ? out.topics.slice(0, 30) : [] });
  }

  if (body.mode === 'summary') {
    const prompt = [
      `Reunião: ${String(body.meeting || '').slice(0, 80)} em ${String(body.date || '').slice(0, 10)}`,
      'Mapa:',
      outline(body.nodes) || '(vazio)',
      body.notes ? `Anotações gerais: ${String(body.notes).slice(0, 3000)}` : '',
    ].join('\n');
    const out = await ask(SUMMARY_SYSTEM, prompt, SUMMARY_SCHEMA);
    return json(res, 200, {
      source: 'ai',
      summary: String(out.summary || '').slice(0, 8000),
      followUps: Array.isArray(out.followUps) ? out.followUps.slice(0, 15) : [],
    });
  }

  fail(res, 400, 'invalid_mode', 'Modo desconhecido.');
});
