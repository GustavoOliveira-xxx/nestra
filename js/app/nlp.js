/* =====================================================================
   NESTRA — Interpretação de linguagem natural (pt-BR)

   §13: "A interpretação pode começar com regras simples para datas,
   expressões como 'hoje', 'amanhã' e 'sábado', períodos como 'de manhã'
   e palavras associadas a prioridade."

   §24: quando não houver confiança suficiente, a frase original é
   preservada e o item é marcado para confirmação. E, principalmente:
   se o usuário escrever "fazer isso depois", o sistema NÃO inventa data.
   ===================================================================== */

/** Remove acentos preservando o comprimento, para os índices baterem. */
function fold(text) {
  return Array.from(text)
    .map((ch) => {
      const d = ch.normalize('NFD');
      return d[0];
    })
    .join('')
    .toLowerCase();
}

const WEEKDAYS = {
  domingo: 0, dom: 0,
  segunda: 1, 'segunda-feira': 1, seg: 1,
  terca: 2, 'terca-feira': 2, ter: 2,
  quarta: 3, 'quarta-feira': 3, qua: 3,
  quinta: 4, 'quinta-feira': 4, qui: 4,
  sexta: 5, 'sexta-feira': 5, sex: 5,
  sabado: 6, sab: 6,
};

const MONTHS = {
  janeiro: 0, jan: 0, fevereiro: 1, fev: 1, marco: 2, mar: 2,
  abril: 3, abr: 3, maio: 4, mai: 4, junho: 5, jun: 5,
  julho: 6, jul: 6, agosto: 7, ago: 7, setembro: 8, set: 8,
  outubro: 9, out: 9, novembro: 10, nov: 10, dezembro: 11, dez: 11,
};

/* Expressões deliberadamente vagas: nunca viram data (§24). */
const VAGUE = [
  'depois', 'mais tarde', 'algum dia', 'qualquer hora', 'quando der',
  'um dia desses', 'sem pressa', 'eventualmente', 'em breve',
];

const PERIODS = [
  { re: /\b(de|pela|a|na)\s+manha\b|\bmanha\b|\bcedo\b/, value: 'morning', label: 'manhã' },
  { re: /\b(de|pela|a|na)\s+tarde\b|\btarde\b/, value: 'afternoon', label: 'tarde' },
  { re: /\b(de|pela|a|na)\s+noite\b|\bnoite\b|\bnoitinha\b/, value: 'evening', label: 'noite' },
  { re: /\bmadrugada\b/, value: 'night', label: 'madrugada' },
];

const PRIORITY = [
  { re: /\b(urgent[ee]?|urgentissimo|para\s+ontem|emergencia)\b/, value: 'urgent', label: 'urgente' },
  { re: /\bprioridade\s+(alta|maxima)\b|\b(importante|prioritario|critico)\b/, value: 'high', label: 'alta' },
  { re: /\bprioridade\s+(baixa|minima)\b|\b(sem\s+pressa|quando\s+der|se\s+sobrar\s+tempo)\b/, value: 'low', label: 'baixa' },
  { re: /\bprioridade\s+(normal|media)\b/, value: 'normal', label: 'normal' },
];

const TYPES = [
  { re: /^\s*ideia\s*[:\-–—]|\bideia\s+de\b|\bpensei\s+em\b|\bquem\s+sabe\b/, value: 'idea', label: 'ideia' },
  {
    re: /^\s*lembrete\s*[:\-–—]|\blembrar\s+(de|que)\b|\bnao\s+esquecer\b|\blembre[- ]me\b|\bme\s+(lembra|lembre|recorda|recorde|avisa|avise)\b/,
    value: 'reminder',
    label: 'lembrete',
  },
  {
    re: /\b(reuniao|consulta|compromisso|encontro|aula|prova|entrevista|apresentacao|call|audiencia|exame|dentista|medico|almoco\s+com|jantar\s+com)\b/,
    value: 'commitment',
    label: 'compromisso',
  },
  { re: /^\s*tarefa\s*[:\-–—]/, value: 'task', label: 'tarefa' },
];

/* --------------------------------------------------------------------
   Datas no fuso configurado na conta (§24: "se escrever 'sábado', deve
   usar o fuso horário configurado na conta")
   -------------------------------------------------------------------- */
export function todayIn(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  } catch {
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  }
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Próxima ocorrência de um dia da semana (hoje conta como "hoje", não como daqui a 7). */
function nextWeekday(base, weekday, forceNext) {
  const cur = base.getUTCDay();
  let delta = (weekday - cur + 7) % 7;
  if (delta === 0 && forceNext) delta = 7;
  if (forceNext && delta < 7 && delta !== 0) delta += 7;
  return addDays(base, delta);
}

/* --------------------------------------------------------------------
   Ação limpa — a camada de “secretário”

   O reconhecimento de voz entrega exatamente o que foi dito, inclusive
   chamadas ("Nestra"), pedidos ("por favor") e molduras de intenção
   ("preciso lembrar de"). Esses trechos são importantes para entender a
   frase, mas não são a ação que deve aparecer na lista.

   As regras abaixo são deliberadamente conservadoras: só retiram molduras
   conversacionais reconhecíveis. A frase completa continua preservada em
   `rawInput`, portanto nenhuma palavra se perde caso a pessoa queira rever
   o que falou depois.
   -------------------------------------------------------------------- */
const ACTION_PREFIXES = [
  // Cortesia e hesitação comuns no começo de um ditado.
  /^(?:por\s+favor|faz\s+favor)(?:\s*[,;:–—-]\s*|\s+)/iu,
  /^(?:ei|ah|bom|ent[aã]o)\s*[,;:–—-]\s*/iu,

  // “Você poderia me lembrar / adicionar uma tarefa para...”
  /^(?:ser[aá]\s+que\s+)?(?:(?:voc[eê]|c[eê])\s+)?(?:pode|poderia|consegue|conseguiria|daria\s+para|d[aá]\s+para|d[aá]\s+pra|tem\s+como)\s+(?:por\s+favor\s+)?(?:me\s+)?(?:ajudar\s+a\s+)?(?:lembrar|recordar|avisar|anotar|registrar|adicionar|incluir|colocar|criar|cadastrar|salvar|p[oõ]r)(?:\s+(?:(?:um|uma)\s+)?(?:lembrete|tarefa|item|atividade))?(?:\s+(?:a[ií]|isso|isto|pra\s+mim|para\s+mim))*\s*(?:(?:de|que|para|pra)\s+)?(?:eu\s+)?/iu,
  /^(?:te\s+)?(?:pedir|solicitar)\s+(?:para|pra)\s+(?:que\s+)?(?:voc[eê]\s+)?(?:me\s+)?(?:lembrar|recordar|avisar|anotar|registrar|adicionar|incluir|colocar|salvar|lembre|anote|registre|adicione|inclua|coloque|salve)(?:\s+(?:(?:um|uma)\s+)?(?:lembrete|tarefa|item))?\s*(?:(?:de|que|para|pra)\s+)?(?:eu\s+)?/iu,
  /^que\s+(?:voc[eê]\s+)?(?:me\s+)?(?:lembre|recorde|avise|anote|registre|adicione|inclua|coloque|salve)\s*(?:(?:de|que|para|pra)\s+)?(?:eu\s+)?/iu,

  // Pedidos diretos de lembrança.
  /^(?:(?:eu\s+)?(?:preciso|quero|queria|gostaria|necessito|devo|tenho\s+que|vou\s+precisar|estou\s+precisando|t[oô]\s+precisando)\s+)?(?:me\s+)?(?:lembrar|recordar)(?:-me)?\s+(?:de|que|para|pra)\s+/iu,
  /^(?:me\s+)?(?:lembra|lembre|recorda|recorde|avisa|avise)(?:-me)?(?:\s+a[ií])?\s+(?:de|que|para|pra)\s+/iu,
  /^(?:n[aã]o)\s+(?:posso|devo|quero)\s+(?:me\s+)?esquecer(?:-me)?\s+(?:de|que)\s+/iu,
  /^(?:n[aã]o)\s+(?:me\s+)?(?:deixa|deixe)\s+(?:eu\s+)?esquecer\s+(?:de|que)\s+/iu,
  /^(?:n[aã]o)\s+esquecer(?:\s+(?:de|que))?\s*[:\-–—]?\s*/iu,
  /^(?:para|pra)\s+(?:eu\s+)?n[aã]o\s+esquecer\s*(?:(?:de|que)\s+)?/iu,

  // “Crie um lembrete”, “anota aí”, “coloca na lista”.
  /^(?:(?:um|uma)\s+)?(?:lembrete|tarefa|item)\s+(?:para|pra|de|que)\s+/iu,
  /^(?:anota|anote|registra|registre|adicione|adiciona|inclua|inclui|coloque|coloca|salve|salva|cadastre|cadastra|p[oõ]e|ponha|bota|bote|guarda|guarde|lan[cç]a|lance)\b(?:\s+(?:a[ií]|isso|isto|pra\s+mim|para\s+mim|na\s+(?:minha\s+)?lista))*\s*[,;:–—-]?\s*(?:(?:que|para|pra)\s+(?:eu\s+)?)?/iu,
  /^(?:crie|cria|cadastre|cadastra)\s+(?:(?:um|uma)\s+)?(?:novo\s+)?(?:lembrete|tarefa|item|atividade)\s*(?:(?:para|pra|de|que)\s+)?/iu,

  // Obrigação, intenção e desejo. O verbo da ação fica: “preciso fazer”
  // vira “fazer”, e não apenas “atividade”.
  /^(?:eu\s+)?(?:preciso|necessito|devo|tenho\s+que|tenho\s+de|tem\s+que|vou\s+precisar|estou\s+precisando|t[oô]\s+precisando|seria\s+bom|seria\s+legal)\s+(?:mesmo\s+)?(?:de\s+)?/iu,
  /^(?:eu\s+)?(?:quero|queria|gostaria)\s+(?:muito\s+)?(?:de\s+)?/iu,
  /^(?:[eé])\s+(?:para|pra)\s+(?:eu\s+)?/iu,
  /^(?:ficou|fica|est[aá])\s+(?:faltando|pendente)\s+(?:eu\s+)?/iu,
  /^(?:eu\s+)?(?:vou|irei)\s+(?=[\p{L}-]+(?:ar|er|ir)\b)/iu,
];

const ACTION_SUFFIXES = [
  /\s*[,;:]?\s*(?:por\s+favor|faz\s+favor|t[aá]\s+bom|beleza|ok|viu)\s*[.!?]*$/iu,
  /\s*[,;:]?\s*(?:e\s+)?(?:me\s+)?(?:lembra|lembre|avisa|avise)\s+(?:disso|disto)\s*[.!?]*$/iu,
  /\s*[,;:]?\s*(?:coloca|coloque|adicione|adiciona|registre|registra|anota|anote)(?:\s+(?:isso|isto))?(?:\s+(?:na\s+(?:minha\s+)?lista|como\s+(?:tarefa|lembrete)))?\s*[.!?]*$/iu,
];

function cleanActionEdges(value) {
  return value
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.!?\-–—]+/, '')
    .replace(/[\s,;:.!?\-–—]+$/, '')
    .replace(/\s+(?:ate|até|para|pra|antes\s+de)(?:\s+(?:o|a))?$/iu, '')
    .trim();
}

/**
 * Converte a frase conversacional no texto curto que aparece como ação.
 * Devolve também se alguma moldura foi reconhecida, para a confiança do
 * parser refletir esse entendimento.
 */
function secretaryAction(input) {
  const source = String(input || '').trim();
  let title = source;

  // A chamada pode vir no início, entre vírgulas ou no fim da fala.
  title = title
    .replace(/^\s*(?:(?:ei|ol[aá])\s+)?nestra\b[\s,;:.!?\-–—]*/iu, '')
    .replace(/([,;:])\s*(?:ei\s+)?nestra\b\s*[,;:]?/giu, '$1 ')
    .replace(/\s*[,;:]\s*(?:ei\s+)?nestra\s*[.!?]*$/iu, '');

  // Algumas molduras vêm empilhadas: “Nestra, anota aí que eu tenho que”.
  // O laço curto permite retirar uma camada por vez sem regras destrutivas.
  for (let pass = 0; pass < 8; pass++) {
    const before = title;
    title = cleanActionEdges(title);
    for (const re of ACTION_PREFIXES) {
      if (!re.test(title)) continue;
      title = title.replace(re, '');
      break;
    }
    for (const re of ACTION_SUFFIXES) title = title.replace(re, '');
    title = cleanActionEdges(title);
    if (title === before) break;
  }

  /* Quando a pessoa diz “tenho uma atividade”, o verbo da ação ficou
     implícito. Só completamos casos inequivocamente executáveis; “tenho
     uma consulta”, por exemplo, continua consulta e não vira uma ação
     inventada. */
  title = title.replace(
    /^(?:eu\s+)?tenho\s+((?:um|uma|uns|umas)\s+(?:atividade|tarefa|trabalho|dever|exerc[ií]cio|reda[cç][aã]o|projeto))\b/iu,
    'Fazer $1',
  );

  // Comandos de agenda são a própria ação, então vão ao infinitivo.
  title = title
    .replace(/^agende\b/iu, 'Agendar')
    .replace(/^agenda\b/iu, 'Agendar')
    .replace(/^marque\b/iu, 'Marcar')
    .replace(/^marca\b/iu, 'Marcar');

  title = cleanActionEdges(title);
  return { title, changed: title !== source };
}

/* --------------------------------------------------------------------
   Parser principal
   -------------------------------------------------------------------- */
export function parse(rawInput, context = {}) {
  const {
    environments = [],
    timezone = 'America/Sao_Paulo',
    defaultEnvironmentId = null,
  } = context;

  const original = String(rawInput || '').trim();
  const result = {
    raw: original,
    title: original,
    description: null,
    type: 'task',
    priority: 'normal',
    dueDate: null,
    dueTime: null,
    timePeriod: 'any',
    environmentId: defaultEnvironmentId,
    environmentName: null,
    tags: [],
    confidence: 0.5,
    needsReview: false,
    matches: [],
  };

  if (!original) return result;

  const today = todayIn(timezone);
  /** Trechos consumidos, removidos do título no fim. */
  const consumed = [];
  const eat = (start, end) => consumed.push([start, end]);
  const overlapsConsumed = (start, end) =>
    consumed.some(([s, e]) => start < e && end > s);

  /** Primeiro casamento que não esteja dentro de um metadado já lido. */
  const firstFreeMatch = (patterns, text) => {
    const candidates = [];
    for (const re of patterns) {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      for (const match of text.matchAll(new RegExp(re.source, flags))) {
        if (!overlapsConsumed(match.index, match.index + match[0].length)) candidates.push(match);
      }
    }
    return candidates.sort((a, b) => a.index - b.index)[0] || null;
  };

  let work = original;
  let flat = fold(work);

  const note = (kind, label, value) => {
    result.matches.push({ kind, label, value });
  };

  /* --- 1. Descrição depois de travessão (§ Fluxo B) --- */
  const dashSplit = work.match(/^(.*?)\s+[—–]\s+(.+)$/s) || work.match(/^(.*?)\s+--\s+(.+)$/s);
  if (dashSplit && dashSplit[1].trim().length > 2) {
    result.description = dashSplit[2].trim();
    work = dashSplit[1].trim();
    flat = fold(work);
    note('desc', 'descrição', result.description);
  }

  /* --- 2. Atalhos diretos: #etiqueta, @ambiente, !prioridade --- */
  work = work.replace(/(^|\s)#([\p{L}\p{N}_-]{2,30})/gu, (m, sp, tag) => {
    result.tags.push(tag);
    return sp;
  });

  const atMatch = work.match(/(^|\s)@([\p{L}\p{N}_-]{2,30})/u);
  if (atMatch) {
    const wanted = fold(atMatch[2]);
    const env = environments.find((e) => fold(e.name).startsWith(wanted));
    if (env) {
      result.environmentId = env.id;
      result.environmentName = env.name;
      result.confidence += 0.15;
      note('env', 'ambiente', env.name);
      work = work.replace(atMatch[0], atMatch[1]);
    }
  }

  const bangs = work.match(/(^|\s)(!{1,3})(\s|$)/);
  if (bangs) {
    result.priority = bangs[2].length >= 3 ? 'urgent' : bangs[2].length === 2 ? 'high' : 'normal';
    if (result.priority !== 'normal') note('priority', 'prioridade', result.priority);
    work = work.replace(bangs[0], ' ');
  }
  flat = fold(work);

  /* --- 3. Tipo --- */
  for (const t of TYPES) {
    const m = flat.match(t.re);
    if (m) {
      result.type = t.value;
      result.confidence += 0.14;
      note('type', 'tipo', t.value);
      // "ideia:" e "lembrete:" são prefixos e saem do título
      if (/^\s*(ideia|lembrete|tarefa)\s*[:\-–—]/.test(flat)) {
        eat(m.index, m.index + m[0].length);
      }
      break;
    }
  }

  /* --- 4. Prioridade em linguagem natural --- */
  if (result.priority === 'normal') {
    for (const p of PRIORITY) {
      const m = flat.match(p.re);
      if (m) {
        result.priority = p.value;
        result.confidence += 0.1;
        note('priority', 'prioridade', p.value);
        eat(m.index, m.index + m[0].length);
        break;
      }
    }
  }

  /* --- 5. Expressões vagas travam a inferência de data (§24) --- */
  // “depois” é vago sozinho, mas não dentro da data exata “depois de amanhã”.
  const vagueProbe = flat.replace(/\bdepois\s+de\s+amanha\b/g, ' ');
  const vagueHit = VAGUE.find((v) => new RegExp(`\\b${v}\\b`).test(vagueProbe));

  /* --- 6. Data --- */
  let dateFound = false;

  const setDate = (date, label, start, end) => {
    result.dueDate = toISODate(date);
    dateFound = true;
    result.confidence += 0.2;
    note('date', label, result.dueDate);
    if (start !== undefined) eat(start, end);
  };

  if (!vagueHit) {
    let m;

    // dd/mm ou dd/mm/aaaa
    if ((m = flat.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/))) {
      const day = +m[1];
      const month = +m[2] - 1;
      let year = m[3] ? +m[3] : today.getUTCFullYear();
      if (year < 100) year += 2000;
      const d = new Date(Date.UTC(year, month, day));
      if (d.getUTCMonth() === month && d.getUTCDate() === day) {
        // sem ano explícito e já passou? assume o próximo ano
        if (!m[3] && d < today) d.setUTCFullYear(year + 1);
        setDate(d, m[0], m.index, m.index + m[0].length);
      }
    }

    // "5 de março" / "dia 12"
    if (!dateFound && (m = flat.match(/\bdia\s+(\d{1,2})(?:\s+de\s+([a-z]+))?\b/))) {
      const day = +m[1];
      const month = m[2] && MONTHS[m[2]] !== undefined ? MONTHS[m[2]] : today.getUTCMonth();
      let d = new Date(Date.UTC(today.getUTCFullYear(), month, day));
      if (d < today) d = new Date(Date.UTC(today.getUTCFullYear() + (m[2] ? 1 : 0), month + (m[2] ? 0 : 1), day));
      setDate(d, m[0], m.index, m.index + m[0].length);
    }

    if (!dateFound && (m = flat.match(/\b(\d{1,2})\s+de\s+([a-z]{3,10})\b/))) {
      const month = MONTHS[m[2]];
      if (month !== undefined) {
        const day = +m[1];
        let d = new Date(Date.UTC(today.getUTCFullYear(), month, day));
        if (d < today) d = new Date(Date.UTC(today.getUTCFullYear() + 1, month, day));
        setDate(d, m[0], m.index, m.index + m[0].length);
      }
    }

    // relativos simples
    if (!dateFound && (m = flat.match(/\bdepois\s+de\s+amanha\b/))) {
      setDate(addDays(today, 2), 'depois de amanhã', m.index, m.index + m[0].length);
    }
    if (!dateFound && (m = flat.match(/\bamanha\b/))) {
      setDate(addDays(today, 1), 'amanhã', m.index, m.index + m[0].length);
    }
    if (!dateFound && (m = flat.match(/\bhoje\b|\bhj\b/))) {
      setDate(today, 'hoje', m.index, m.index + m[0].length);
    }
    if (!dateFound && (m = flat.match(/\b(?:em|daqui\s+a)\s+(\d{1,3})\s+(dias?|semanas?|mes(?:es)?)\b/))) {
      const n = +m[1];
      const mult = /semana/.test(m[2]) ? 7 : /mes/.test(m[2]) ? 30 : 1;
      setDate(addDays(today, n * mult), m[0], m.index, m.index + m[0].length);
    }
    if (!dateFound && (m = flat.match(/\b(?:na\s+)?(proxima\s+semana|semana\s+que\s+vem)\b/))) {
      setDate(nextWeekday(today, 1, true), 'próxima semana', m.index, m.index + m[0].length);
    }
    if (!dateFound && (m = flat.match(/\b(?:(?:ate(?:\s+o)?|no|para\s+o)\s+)?(?:fim|final)\s+de\s+semana\b/))) {
      setDate(nextWeekday(today, 6, false), 'fim de semana', m.index, m.index + m[0].length);
    }

    // dias da semana
    if (!dateFound) {
      const names = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length);
      for (const name of names) {
        const re = new RegExp(`\\b(?:(?:ate|para|pra|antes\\s+de|na|no|de|da|do|essa|esta|nesse|neste)\\s+)?${name}(?:-feira)?\\b(\\s+que\\s+vem|\\s+proxim[ao])?`);
        const mm = flat.match(re);
        if (mm) {
          const forceNext = Boolean(mm[1]);
          setDate(nextWeekday(today, WEEKDAYS[name], forceNext), name, mm.index, mm.index + mm[0].length);
          break;
        }
      }
    }
  } else {
    note('vague', 'sem prazo', vagueHit);
    const vi = flat.indexOf(vagueHit);
    if (vi >= 0) eat(vi, vi + vagueHit.length);
  }

  /* --- 7. Horário --- */
  const m2 = firstFreeMatch([
    /\b(?:as|às|a)\s*(\d{1,2})(?:[h:](\d{2}))?\s*(?:h|horas?)?\b/,
    /\b(\d{1,2})[h:](\d{2})\b/,
    /\b(\d{1,2})\s*(?:h|horas)\b/,
  ], flat);
  if (m2) {
    const hh = +m2[1];
    const mm = m2[2] ? +m2[2] : 0;
    if (hh >= 0 && hh <= 23 && mm < 60) {
      result.dueTime = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      result.confidence += 0.12;
      note('time', 'horário', result.dueTime);
      eat(m2.index, m2.index + m2[0].length);
      // um horário quase sempre indica compromisso
      if (result.type === 'task') result.type = 'commitment';
      // horário sem data explícita significa hoje
      if (!result.dueDate && !vagueHit) result.dueDate = toISODate(today);
      result.timePeriod =
        hh < 12 ? 'morning' : hh < 18 ? 'afternoon' : hh < 22 ? 'evening' : 'night';
    }
  }

  if (/\bmeio[- ]dia\b/.test(flat)) {
    result.dueTime = '12:00';
    result.timePeriod = 'afternoon';
    note('time', 'horário', '12:00');
    if (!result.dueDate && !vagueHit) result.dueDate = toISODate(today);
  }
  if (/\bmeia[- ]noite\b/.test(flat)) {
    result.dueTime = '00:00';
    result.timePeriod = 'night';
    note('time', 'horário', '00:00');
  }

  /* --- 8. Período do dia --- */
  if (result.timePeriod === 'any') {
    for (const p of PERIODS) {
      const m = flat.match(p.re);
      if (m) {
        result.timePeriod = p.value;
        result.confidence += 0.06;
        note('period', 'período', p.label);
        eat(m.index, m.index + m[0].length);
        break;
      }
    }
  }

  /* --- 9. Ambiente pelo nome, com apelidos comuns --- */
  if (!result.environmentName) {
    const aliases = [
      {
        words: ['trabalho', 'servico', 'escritorio', 'expediente', 'empresa'],
        hints: ['trabalho', 'servico', 'escritorio', 'empresa', 'profissional'],
      },
      {
        words: [
          'estudo', 'estudos', 'estudar', 'faculdade', 'escola', 'curso', 'aula',
          'prova', 'atividade', 'dever', 'exercicio', 'redacao', 'portugues',
          'matematica', 'historia', 'geografia', 'trabalho\\s+da\\s+facul', 'tcc', 'leitura',
        ],
        hints: ['estudo', 'estudos', 'faculdade', 'facul', 'escola', 'curso', 'academico'],
      },
      {
        words: ['casa', 'domestico', 'mercado', 'compras', 'quintal', 'garagem'],
        hints: ['casa', 'lar', 'domestico', 'familia'],
      },
      {
        words: ['pessoal', 'saude', 'academia', 'medico', 'dentista'],
        hints: ['pessoal', 'saude', 'academia', 'bem-estar'],
      },
      {
        words: ['financas', 'financeiro', 'conta', 'boleto', 'pagar', 'orcamento'],
        hints: ['financas', 'financeiro', 'dinheiro', 'contas'],
      },
    ];

    // 1º: nome exato de um ambiente do usuário
    let hit = null;
    for (const env of environments) {
      const n = fold(env.name);
      if (n.length < 3) continue;
      const re = new RegExp(`\\b(?:no|na|em|do|da)?\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const mm = flat.match(re);
      if (mm) {
        hit = { env, match: mm };
        break;
      }
    }

    // 2º: apelido que aponta para um ambiente existente
    if (!hit) {
      for (const alias of aliases) {
        const found = alias.words.find((w) => new RegExp(`\\b${w}\\b`).test(flat));
        if (!found) continue;
        const env = environments.find((e) => {
          const name = fold(e.name);
          return alias.hints.some((hint) => name.includes(hint) || hint.includes(name));
        });
        if (env) {
          hit = { env, match: null };
          break;
        }
      }
    }

    if (hit) {
      result.environmentId = hit.env.id;
      result.environmentName = hit.env.name;
      result.confidence += 0.15;
      note('env', 'ambiente', hit.env.name);
      // o nome do ambiente permanece no título quando faz parte da frase
    }
  }

  /* --- 10. Monta o título limpo --- */
  let title = work;
  if (consumed.length) {
    /* Duas interpretações podem tocar o mesmo trecho (por exemplo, uma
       data relativa e uma preposição de horário). Unir os intervalos
       antes de cortar impede que o segundo corte remova letras da ação. */
    const merged = consumed
      .filter(([s, e]) => s >= 0 && e > s && e <= title.length)
      .sort((a, b) => a[0] - b[0])
      .reduce((ranges, [s, e]) => {
        const last = ranges[ranges.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else ranges.push([s, e]);
        return ranges;
      }, []);

    for (const [s, e] of merged.reverse()) {
      if (s >= 0 && e <= title.length) title = title.slice(0, s) + ' ' + title.slice(e);
    }
  }

  title = title
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    // pontuação órfã deixada pelos trechos removidos: "benefício,." -> "benefício."
    .replace(/([,;:])+\s*([.!?])/g, '$2')
    .replace(/([,;:])\s*\1+/g, '$1')
    .replace(/^[\s,;:.\-–—]+/, '')
    .replace(/[\s,;:]+$/, '')
    // preposição solta no fim: "a prova de" -> "a prova"
    .replace(/\s+(de|da|do|dos|das|em|na|no|nas|nos|para|pra|ate|até|com|por|a|o)\s*([.!?])?\s*$/i,
      (_m, _w, punct) => punct || '')
    .trim();

  const action = secretaryAction(title);
  if (action.changed && action.title.length >= 2) {
    title = action.title;
    result.confidence += 0.08;
    note('action', 'ação', title);
  }

  // Nunca devolve um título vazio: a frase original vale mais que a regra
  result.title = title.length >= 2 ? title : original;
  result.title = result.title.charAt(0).toUpperCase() + result.title.slice(1);

  result.confidence = Math.min(0.99, Math.round(result.confidence * 100) / 100);
  result.needsReview = result.confidence < 0.58 && !dateFound;

  return result;
}

/* --------------------------------------------------------------------
   Formatação amigável de datas
   -------------------------------------------------------------------- */
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** É uma data no formato que o app guarda, 'AAAA-MM-DD'? */
export function isISODate(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

export function humanDate(iso, timezone) {
  if (!iso) return null;

  /* Data que não está no formato guardado não vira texto nenhum.
     Escrever "NaN undefined NaN" na linha do item — que foi o que a API
     produziu enquanto convertia mal a coluna do banco — é pior do que
     não escrever data alguma: o item continua legível e o defeito fica
     onde tem de ser corrigido, em vez de aparecer na cara de quem usa. */
  if (!isISODate(iso)) return null;

  const today = todayIn(timezone);
  const date = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return null;

  const diff = Math.round((date - today) / 86400000);

  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  if (diff > 1 && diff < 7) return DAY_NAMES[date.getUTCDay()];
  if (diff < -1 && diff > -8) return `há ${Math.abs(diff)} dias`;
  if (diff < 0) return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;

  const sameYear = date.getUTCFullYear() === today.getUTCFullYear();
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}` +
    (sameYear ? '' : ` ${date.getUTCFullYear()}`);
}

export const PERIOD_LABELS = {
  any: 'sem período',
  morning: 'manhã',
  afternoon: 'tarde',
  evening: 'noite',
  night: 'madrugada',
};

export const TYPE_LABELS = {
  task: 'tarefa',
  reminder: 'lembrete',
  commitment: 'compromisso',
  idea: 'ideia',
};

export const PRIORITY_LABELS = {
  low: 'baixa',
  normal: 'normal',
  high: 'alta',
  urgent: 'urgente',
};
