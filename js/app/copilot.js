import { api } from './api.js';
import { store, shiftDay } from './store.js';
import { todayIn, toISODate } from './nlp.js';

export const KIND_META = {
  root:     { label: 'Reunião',     color: 'var(--accent)', icon: 'target' },
  topic:    { label: 'Assunto',     color: '#8FB4FF',       icon: 'list' },
  update:   { label: 'Andamento',   color: '#3ED9A4',       icon: 'check' },
  plan:     { label: 'Próximo passo', color: '#4FD8FF',     icon: 'chevron' },
  blocker:  { label: 'Bloqueio',    color: '#FF5F6B',       icon: 'alert' },
  question: { label: 'Pergunta',    color: '#FFC96B',       icon: 'sparkle' },
  decision: { label: 'Decisão',     color: '#9B7BFF',       icon: 'flag' },
  notice:   { label: 'Aviso',       color: '#FFA23D',       icon: 'bell' },
  idea:     { label: 'Ideia',       color: '#C3F06B',       icon: 'bulb' },
};

export const KIND_ORDER = ['update', 'plan', 'blocker', 'question', 'decision', 'notice', 'idea', 'topic'];

export const TEMPLATES = {
  free:       { label: 'Livre',        hint: 'Qualquer reunião recorrente.' },
  daily:      { label: 'Daily',        hint: 'O que andou, o que vem agora e o que trava.' },
  one_on_one: { label: '1:1',          hint: 'Conversa com gestor ou liderado.' },
  review:     { label: 'Revisão',      hint: 'Sprint, entrega ou acompanhamento.' },
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'n-' + Math.random().toString(36).slice(2));

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const KIND_RULES = [
  ['blocker',  /\b(bloque|travad|trava |impedi|depend|aguardando|esperando|nao consigo|sem acesso|quebr|bug|falha|parado|atrasad)/],
  ['question', /\?|\b(pergunt|duvida|saber se|confirmar|alguem sabe|como fica|como faz|qual o|quem vai)/],
  ['decision', /\b(decid|definir|escolher|aprova|votar|bater o martelo|fechar se|priorizar)/],
  ['notice',   /\b(avis|informar|comunicar|ferias|folga|vou sair|sair mais cedo|ausen|feriado|medico|consulta|atestado|nao vou estar|home office)/],
  ['idea',     /\b(ideia|sugest|propor|proposta|poderiamos|que tal|seria bom)/],
  ['update',   /\b(ontem|terminei|finalizei|conclui|entreguei|fiz |subi |deployei|publiquei|avancei|resolvi|corrigi|ficou pronto|esta pronto|ja esta|andamento)/],
  ['plan',     /\b(hoje|vou |pretendo|planejo|proximo passo|seguir com|continuar|comecar|iniciar|amanha)/],
];

export function classify(sentence) {
  const f = fold(sentence) + ' ';
  for (const [kind, rule] of KIND_RULES) if (rule.test(f)) return kind;
  return 'topic';
}

const LEADS = [
  /^(hoje|ontem|amanha|agora)\s+(eu\s+)?/,
  /^(to|tô|estou|ja|eu)\s+(?=(terminei|fiz|vou|esperando|aguardando|travad|bloquead|com ))/,
  /^(e|tambem|ai|entao|ah|bom|ok|alem disso|e tambem|outra coisa|outro ponto)[,:]?\s+/,
  /^(eu\s+)?(preciso|tenho que|tenho de|quero|queria|devo|lembrar de|nao esquecer de|nao posso esquecer de|vou|pretendo)\s+/,
  /^(falar|comentar|mencionar|levantar|trazer|perguntar|avisar|alinhar|contar|mostrar|informar|dizer|atualizar|reportar|apresentar|passar)\s+/,
  /^(pro pessoal|pra galera|pro time|pra equipe|para o time|para a equipe)\s+/,
  /^(sobre|do|da|dos|das|de|que|o|a|os|as|pro|pra|para|ao|a respeito d[oa]s?)\s+/,
];

const ASK_SOMEONE = /^(?:perguntar|ver|checar|confirmar|alinhar|cobrar)\s+(?:com|pro|pra|para|ao|à|a|o)\s+\S+\s+(?:se|sobre|quando|como|qual|o|a)\s+/i;

export function stripLead(sentence) {
  let text = String(sentence).trim().replace(/^[-•*·\d.)\s]+/, '');
  const ask = ASK_SOMEONE.exec(fold(text));
  if (ask) text = text.slice(ask[0].length).replace(/^(ele|ela|eles|elas)\s+/i, '');
  for (let round = 0; round < 4; round++) {
    const before = text;
    for (const lead of LEADS) {
      const m = lead.exec(fold(text));
      if (m && m[0].length < text.length) text = text.slice(m[0].length);
    }
    if (text === before) break;
  }
  text = text.replace(/[.;,\s]+$/, '').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NOT_NAMES = new Set(['Nestra', 'Daily', 'Hoje', 'Ontem', 'Amanha', 'Amanhã', 'Segunda', 'Terça', 'Quarta',
  'Quinta', 'Sexta', 'Sábado', 'Domingo', 'Preciso', 'Falar', 'Eu', 'Vou', 'Reunião', 'Time', 'Equipe']);

export function findPerson(sentence) {
  const at = /@([\p{L}][\p{L}.-]{1,30})/u.exec(sentence);
  if (at) return at[1];
  const re = /\b(?:com|pro|pra|para o|para a|ao|à|do|da|o|a)\s+(\p{Lu}[\p{Ll}]{2,20})/gu;
  let m;
  while ((m = re.exec(sentence))) if (!NOT_NAMES.has(m[1])) return m[1];
  return '';
}

function shorten(text, words = 8) {
  const parts = text.split(/\s+/);
  if (parts.length <= words) return text;
  return parts.slice(0, words).join(' ').replace(/[,;:]$/, '') + '…';
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n+|;|(?<=[.!?])\s+(?=\S)|\s+(?:e também|além disso|outra coisa|outro ponto)[,:]?\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.replace(/[^\p{L}\p{N}]/gu, '').length > 2);
}

export function localTopics(text) {
  const topics = [];
  for (const sentence of splitSentences(text)) {
    let head = sentence;
    let children = [];

    const colon = sentence.indexOf(':');
    if (colon > 3 && colon < sentence.length - 3) {
      head = sentence.slice(0, colon);
      children = sentence.slice(colon + 1).split(/,|\s+e\s+(?=\S)/).map((c) => c.trim()).filter(Boolean);
    } else {
      const parts = sentence.split(/,\s*/);
      if (parts.length >= 3) {
        head = parts[0];
        children = parts.slice(1).map((c) => c.replace(/^e\s+/i, ''));
      }
    }

    const subject = stripLead(head);
    if (!subject) continue;
    const label = shorten(subject);
    const kind = classify(sentence);
    const duplicate = topics.find((t) => fold(t.label) === fold(label));
    if (duplicate) continue;

    topics.push({
      label,
      kind,
      detail: label !== subject || children.length ? sentence.trim() : '',
      who: findPerson(sentence),
      children: children.slice(0, 8).map((c) => {
        const clean = stripLead(c);
        return { label: shorten(clean, 6), kind: classify(c) === 'topic' ? kind : classify(c) };
      }).filter((c) => c.label),
    });
  }
  return topics.slice(0, 30);
}

export function todayISO() {
  return toISODate(todayIn(store.state.prefs.timezone));
}

export function carryOver(meeting, iso) {
  const last = store.lastAgendaBefore(meeting.id, iso);
  if (!last) return { from: null, nodes: [] };
  const nodes = last.nodes.filter((n) => n.kind !== 'root' && !n.done && n.text);
  const topLevel = nodes.filter((n) => !nodes.some((p) => p.id === n.parentId));
  return { from: last.occursOn, nodes: topLevel };
}

export function relatedItems(meeting, iso) {
  if (!meeting.environmentId) return [];
  return store.live
    .filter((i) => i.environmentId === meeting.environmentId && i.status === 'pending')
    .filter((i) => (i.dueDate && i.dueDate <= iso) || i.priority === 'high' || i.priority === 'urgent')
    .slice(0, 8);
}

export function recentWins(meeting, iso) {
  if (!meeting.environmentId) return [];
  const since = store.previousOccurrence(meeting, iso);
  return store.live
    .filter((i) => i.environmentId === meeting.environmentId && i.status === 'done' && i.completedAt)
    .filter((i) => i.completedAt.slice(0, 10) >= since)
    .slice(0, 6);
}

export function skeletonFor(template) {
  if (template === 'daily') {
    return [
      { label: 'O que andou', kind: 'update', detail: '', who: '', children: [] },
      { label: 'O que vem agora', kind: 'plan', detail: '', who: '', children: [] },
      { label: 'O que está travando', kind: 'blocker', detail: '', who: '', children: [] },
    ];
  }
  if (template === 'one_on_one') {
    return [
      { label: 'Como estou', kind: 'topic', detail: '', who: '', children: [] },
      { label: 'Entregas e prioridades', kind: 'update', detail: '', who: '', children: [] },
      { label: 'Feedback', kind: 'question', detail: '', who: '', children: [] },
      { label: 'Desenvolvimento', kind: 'idea', detail: '', who: '', children: [] },
    ];
  }
  if (template === 'review') {
    return [
      { label: 'Entregue', kind: 'update', detail: '', who: '', children: [] },
      { label: 'Riscos', kind: 'blocker', detail: '', who: '', children: [] },
      { label: 'Decisões', kind: 'decision', detail: '', who: '', children: [] },
      { label: 'Próximos passos', kind: 'plan', detail: '', who: '', children: [] },
    ];
  }
  return [];
}

async function server(body) {
  if (!api.online || !api.ai) return null;
  try {
    return await api.request('/assistant', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    return null;
  }
}

export async function planTopics(text, { meeting, carry = [], items = [] } = {}) {
  const remote = await server({
    mode: 'map',
    text,
    meeting: meeting?.title,
    template: meeting?.template,
    carry,
    items,
  });
  if (remote?.topics?.length) return { source: 'ai', topics: remote.topics };
  return { source: 'local', topics: localTopics(text) };
}

export function localSummary(meeting, agenda) {
  const nodes = agenda.nodes.filter((n) => n.kind !== 'root');
  const root = rootOf(agenda);
  const topics = childrenOf(agenda, root?.id);
  const date = new Date(agenda.occursOn + 'T12:00:00Z')
    .toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

  const line = (n, depth) => `${'  '.repeat(depth)}- ${n.text}${n.who ? ` (${n.who})` : ''}`;
  const section = (title, list, pick) => {
    const out = [];
    list.forEach((t) => {
      const kids = childrenOf(agenda, t.id).filter(pick);
      if (pick(t) || kids.length) {
        out.push(line(t, 0));
        kids.forEach((k) => out.push(line(k, 1)));
      }
    });
    return out.length ? [title, ...out, ''] : [];
  };

  const lines = [`${meeting.title} · ${date}`, ''];
  lines.push(...section('Falado', topics, (n) => n.done));
  lines.push(...section('Ficou para depois', topics, (n) => !n.done));

  const notes = nodes.filter((n) => n.note);
  if (notes.length || agenda.notes) {
    lines.push('Combinados');
    notes.forEach((n) => lines.push(`- ${n.text}: ${n.note}`));
    if (agenda.notes) lines.push(`- ${agenda.notes}`);
  }

  const followUps = nodes
    .filter((n) => n.task || (n.note && /\b(eu|vou|fico de|fiquei de)\b/i.test(n.note)))
    .map((n) => ({ title: actionTitle(n), due: 'today' }));

  return { summary: lines.join('\n').trim(), followUps: dedupe(followUps) };
}

export function actionTitle(node) {
  const base = node.note ? stripLead(node.note.split(/\n/)[0]) : node.text;
  return String(base || node.text).slice(0, 200);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => {
    const k = fold(f.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function summarize(meeting, agenda) {
  const remote = await server({
    mode: 'summary',
    meeting: meeting.title,
    date: agenda.occursOn,
    nodes: agenda.nodes,
    notes: agenda.notes,
  });
  if (remote?.summary) return { source: 'ai', summary: remote.summary, followUps: remote.followUps || [] };
  return { source: 'local', ...localSummary(meeting, agenda) };
}

export function dueFrom(due, iso = todayISO()) {
  if (due === 'today') return iso;
  if (due === 'tomorrow') return shiftDay(iso, 1);
  if (due === 'this_week') return shiftDay(iso, Math.max(0, 5 - new Date(iso + 'T12:00:00Z').getUTCDay()));
  return null;
}

export function rootOf(agenda) {
  return agenda.nodes.find((n) => n.kind === 'root');
}

export function childrenOf(agenda, id) {
  return agenda.nodes
    .filter((n) => n.parentId === id && n.kind !== 'root')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function makeNode(parentId, data = {}) {
  return {
    id: uid(),
    parentId,
    kind: data.kind || 'topic',
    text: String(data.label ?? data.text ?? '').slice(0, 240),
    detail: data.detail || null,
    who: data.who || null,
    source: data.source || null,
    note: null,
    done: false,
    doneAt: null,
    task: false,
    taskId: data.taskId || null,
    x: null,
    y: null,
    order: Date.now() % 1e9,
  };
}

export function addTopics(agenda, topics, source) {
  const root = rootOf(agenda);
  let added = 0;
  topics.forEach((t, i) => {
    const label = String(t.label || '').trim();
    if (!label) return;
    let parent = agenda.nodes.find((n) => n.parentId === root.id && fold(n.text) === fold(label));
    if (!parent) {
      parent = makeNode(root.id, { ...t, source });
      parent.order = Date.now() % 1e9 + i;
      agenda.nodes.push(parent);
      added++;
    }
    (t.children || []).forEach((c, j) => {
      const childLabel = String(c.label || '').trim();
      if (!childLabel) return;
      if (agenda.nodes.some((n) => n.parentId === parent.id && fold(n.text) === fold(childLabel))) return;
      const child = makeNode(parent.id, { ...c, source });
      child.order = Date.now() % 1e9 + j;
      agenda.nodes.push(child);
      added++;
    });
  });
  return added;
}

export function removeNode(agenda, id) {
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    agenda.nodes.forEach((n) => {
      if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) { doomed.add(n.id); grew = true; }
    });
  }
  agenda.nodes = agenda.nodes.filter((n) => !doomed.has(n.id));
}

export function progress(agenda) {
  const nodes = agenda.nodes.filter((n) => n.kind !== 'root');
  return { done: nodes.filter((n) => n.done).length, total: nodes.length };
}
