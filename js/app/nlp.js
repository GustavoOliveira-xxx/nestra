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

const VAGUE = [
  'depois', 'mais tarde', 'algum dia', 'qualquer hora', 'quando der',
  'um dia desses', 'sem pressa', 'eventualmente', 'em breve',
];

const PERIOD_APPROX = '(?:(?:mais\\s+ou\\s+menos|aproximadamente|por\\s+volta\\s+d(?:e|a|as)|cerca\\s+de)\\s+(?:umas?\\s+)?(?:d[ae]\\s+)?)?';
const PERIODS = [
  { re: new RegExp(`\\b${PERIOD_APPROX}(?:(?:de|da|do|pela|a|na)\\s+)?(?:manha|cedo)\\b`), value: 'morning', label: 'manhã' },
  { re: new RegExp(`\\b${PERIOD_APPROX}(?:(?:de|da|do|pela|a|na)\\s+)?tarde\\b`), value: 'afternoon', label: 'tarde' },
  { re: new RegExp(`\\b${PERIOD_APPROX}(?:(?:de|da|do|pela|a|na)\\s+)?(?:noite|noitinha)\\b`), value: 'evening', label: 'noite' },
  { re: new RegExp(`\\b${PERIOD_APPROX}(?:(?:de|da|do|pela|a|na)\\s+)?madrugada\\b`), value: 'night', label: 'madrugada' },
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

function nextWeekday(base, weekday, forceNext) {
  const cur = base.getUTCDay();
  let delta = (weekday - cur + 7) % 7;
  if (delta === 0 && forceNext) delta = 7;
  if (forceNext && delta < 7 && delta !== 0) delta += 7;
  return addDays(base, delta);
}

const ACTION_PREFIXES = [
  /^(?:por\s+favor|faz\s+favor)(?:\s*[,;:–—-]\s*|\s+)/iu,
  /^(?:ei|ah|bom|ent[aã]o)\s*[,;:–—-]\s*/iu,

  /^(?:ser[aá]\s+que\s+)?(?:(?:voc[eê]|c[eê])\s+)?(?:pode|poderia|consegue|conseguiria|daria\s+para|d[aá]\s+para|d[aá]\s+pra|tem\s+como)\s+(?:por\s+favor\s+)?(?:me\s+)?(?:ajudar\s+a\s+)?(?:lembrar|recordar|avisar|anotar|registrar|adicionar|incluir|colocar|criar|cadastrar|salvar|p[oõ]r)(?:\s+(?:(?:um|uma)\s+)?(?:lembrete|tarefa|item|atividade))?(?:\s+(?:a[ií]|isso|isto|pra\s+mim|para\s+mim))*\s*(?:(?:de|que|para|pra)\s+)?(?:eu\s+)?/iu,
  /^(?:te\s+)?(?:pedir|solicitar)\s+(?:para|pra)\s+(?:que\s+)?(?:voc[eê]\s+)?(?:me\s+)?(?:lembrar|recordar|avisar|anotar|registrar|adicionar|incluir|colocar|salvar|lembre|anote|registre|adicione|inclua|coloque|salve)(?:\s+(?:(?:um|uma)\s+)?(?:lembrete|tarefa|item))?\s*(?:(?:de|que|para|pra)\s+)?(?:eu\s+)?/iu,
  /^que\s+(?:voc[eê]\s+)?(?:me\s+)?(?:lembre|recorde|avise|anote|registre|adicione|inclua|coloque|salve)\s*(?:(?:de|que|para|pra)\s+)?(?:eu\s+)?/iu,

  /^(?:(?:eu\s+)?(?:preciso|quero|queria|gostaria|necessito|devo|tenho\s+que|vou\s+precisar|estou\s+precisando|t[oô]\s+precisando)\s+)?(?:me\s+)?(?:lembrar|recordar)(?:-me)?\s+(?:de|que|para|pra)\s+/iu,
  /^(?:me\s+)?(?:lembra|lembre|recorda|recorde|avisa|avise)(?:-me)?(?:\s+a[ií])?\s+(?:de|que|para|pra)\s+/iu,
  /^(?:n[aã]o)\s+(?:posso|devo|quero)\s+(?:me\s+)?esquecer(?:-me)?\s+(?:de|que)\s+/iu,
  /^(?:n[aã]o)\s+(?:me\s+)?(?:deixa|deixe)\s+(?:eu\s+)?esquecer\s+(?:de|que)\s+/iu,
  /^(?:n[aã]o)\s+esquecer(?:\s+(?:de|que))?\s*[:\-–—]?\s*/iu,
  /^(?:para|pra)\s+(?:eu\s+)?n[aã]o\s+esquecer\s*(?:(?:de|que)\s+)?/iu,

  /^(?:(?:um|uma)\s+)?(?:lembrete|tarefa|item)\s+(?:para|pra|de|que)\s+/iu,
  /^(?:anota|anote|registra|registre|adicione|adiciona|inclua|inclui|coloque|coloca|salve|salva|cadastre|cadastra|p[oõ]e|ponha|bota|bote|guarda|guarde|lan[cç]a|lance)\b(?:\s+(?:a[ií]|isso|isto|pra\s+mim|para\s+mim|na\s+(?:minha\s+)?lista))*\s*[,;:–—-]?\s*(?:(?:que|para|pra)\s+(?:eu\s+)?)?/iu,
  /^(?:crie|cria|cadastre|cadastra)\s+(?:(?:um|uma)\s+)?(?:novo\s+)?(?:lembrete|tarefa|item|atividade)\s*(?:(?:para|pra|de|que)\s+)?/iu,

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

function secretaryAction(input) {
  const source = String(input || '').trim();
  let title = source;

  title = title
    .replace(/^\s*(?:(?:ei|ol[aá])\s+)?nestra\b[\s,;:.!?\-–—]*/iu, '')
    .replace(/([,;:])\s*(?:ei\s+)?nestra\b\s*[,;:]?/giu, '$1 ')
    .replace(/\s*[,;:]\s*(?:ei\s+)?nestra\s*[.!?]*$/iu, '');

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

  title = title.replace(
    /^(?:eu\s+)?tenho\s+((?:um|uma|uns|umas)\s+(?:atividade|tarefa|trabalho|dever|exerc[ií]cio|reda[cç][aã]o|projeto))\b/iu,
    'Fazer $1',
  );

  title = title
    .replace(/^agende\b/iu, 'Agendar')
    .replace(/^agenda\b/iu, 'Agendar')
    .replace(/^marque\b/iu, 'Marcar')
    .replace(/^marca\b/iu, 'Marcar');

  title = cleanActionEdges(title);
  return { title, changed: title !== source };
}

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
  const consumed = [];
  const eat = (start, end) => consumed.push([start, end]);
  const overlapsConsumed = (start, end) =>
    consumed.some(([s, e]) => start < e && end > s);

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

  const dashSplit = work.match(/^(.*?)\s+[—–]\s+(.+)$/s) || work.match(/^(.*?)\s+--\s+(.+)$/s);
  if (dashSplit && dashSplit[1].trim().length > 2) {
    result.description = dashSplit[2].trim();
    work = dashSplit[1].trim();
    flat = fold(work);
    note('desc', 'descrição', result.description);
  }

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

  for (const t of TYPES) {
    const m = flat.match(t.re);
    if (m) {
      result.type = t.value;
      result.confidence += 0.14;
      note('type', 'tipo', t.value);
      if (/^\s*(ideia|lembrete|tarefa)\s*[:\-–—]/.test(flat)) {
        eat(m.index, m.index + m[0].length);
      }
      break;
    }
  }

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

  const vagueProbe = flat.replace(/\bdepois\s+de\s+amanha\b/g, ' ');
  const vagueHit = VAGUE.find((v) => new RegExp(`\\b${v}\\b`).test(vagueProbe));

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

    if ((m = flat.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/))) {
      const day = +m[1];
      const month = +m[2] - 1;
      let year = m[3] ? +m[3] : today.getUTCFullYear();
      if (year < 100) year += 2000;
      const d = new Date(Date.UTC(year, month, day));
      if (d.getUTCMonth() === month && d.getUTCDate() === day) {
        if (!m[3] && d < today) d.setUTCFullYear(year + 1);
        setDate(d, m[0], m.index, m.index + m[0].length);
      }
    }

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

  const m2 = firstFreeMatch([
    /\b(?:mais\s+ou\s+menos|aproximadamente|por\s+volta\s+d(?:e|a|as)|cerca\s+de)\s+(?:(?:as|a|pelas?|umas?)\s+)?(\d{1,2})(?:\s*(?:h|:)\s*(\d{1,2}))?\s*(?:h|horas?)?\b/,
    /\b(?:(?:as|a|pelas?)\s+|umas?\s+)(\d{1,2})(?:\s*(?:h|:)\s*(\d{1,2}))?\s*(?:h|horas?)?\b/,
    /\b(\d{1,2})\s*(?:h|:)\s*(\d{1,2})\b/,
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
      if (result.type === 'task') result.type = 'commitment';
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

  const explicitPeriods = [];
  for (const p of PERIODS) {
    const flags = p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g';
    for (const m of flat.matchAll(new RegExp(p.re.source, flags))) {
      if (overlapsConsumed(m.index, m.index + m[0].length)) continue;
      explicitPeriods.push({ ...p, match: m });
    }
  }
  explicitPeriods.sort((a, b) => a.match.index - b.match.index);

  if (explicitPeriods.length) {
    const first = explicitPeriods[0];
    result.timePeriod = first.value;
    result.confidence += 0.06;
    note('period', 'período', first.label);
    explicitPeriods.forEach(({ match }) => eat(match.index, match.index + match[0].length));

    if (result.dueTime) {
      let [hh, mm] = result.dueTime.split(':').map(Number);
      if ((first.value === 'afternoon' || first.value === 'evening') && hh >= 1 && hh <= 11) hh += 12;
      else if ((first.value === 'evening' || first.value === 'night') && hh === 12) hh = 0;
      result.dueTime = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }

    const conflicting = new Set(explicitPeriods.map((p) => p.value));
    if (conflicting.size > 1) result.needsReview = true;
  }

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
        words: [
          'pessoal', 'saude', 'academia', 'medico', 'dentista', 'familia',
          'mae', 'pai', 'avo', 'avos', 'vovo', 'vo', 'parentes',
        ],
        hints: ['pessoal', 'saude', 'academia', 'bem-estar', 'familia'],
      },
      {
        words: ['financas', 'financeiro', 'conta', 'boleto', 'pagar', 'orcamento'],
        hints: ['financas', 'financeiro', 'dinheiro', 'contas'],
      },
    ];

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
    }
  }

  let title = work;
  if (consumed.length) {
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
    .replace(/([,;:])+\s*([.!?])/g, '$2')
    .replace(/([,;:])\s*\1+/g, '$1')
    .replace(/^[\s,;:.\-–—]+/, '')
    .replace(/[\s,;:]+$/, '')
    .replace(/\s+(de|da|do|dos|das|em|na|no|nas|nos|para|pra|ate|até|com|por|a|o)\s*([.!?])?\s*$/i,
      (_m, _w, punct) => punct || '')
    .trim();

  const action = secretaryAction(title);
  if (action.changed && action.title.length >= 2) {
    title = action.title;
    result.confidence += 0.08;
    note('action', 'ação', title);
  }

  result.title = title.length >= 2 ? title : original;
  result.title = result.title.charAt(0).toUpperCase() + result.title.slice(1);

  result.confidence = Math.min(0.99, Math.round(result.confidence * 100) / 100);
  result.needsReview = result.needsReview || (result.confidence < 0.58 && !dateFound);

  return result;
}

const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function isISODate(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

export function humanDate(iso, timezone) {
  if (!iso) return null;

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
