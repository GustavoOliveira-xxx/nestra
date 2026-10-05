import { sql } from './_lib/db.js';
import { handler, json } from './_lib/http.js';

export default handler(async (req, res) => {
  const base = {
    service: 'nestra-api',
    time: new Date().toISOString(),
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  if (!process.env.DATABASE_URL) {
    return json(res, 200, {
      ...base,
      ok: false,
      reason: 'sem_banco',
      message: 'A API está no ar, mas falta a variável DATABASE_URL.',
    });
  }

  if (!process.env.NESTRA_IP_SALT || process.env.NESTRA_IP_SALT.length < 16) {
    return json(res, 200, {
      ...base,
      ok: false,
      reason: 'sem_salt',
      message: 'A API está no ar, mas falta um NESTRA_IP_SALT com pelo menos 16 caracteres.',
    });
  }

  try {
    const rows = await sql`select 1 as ok`;
    return json(res, 200, { ...base, ok: rows[0]?.ok === 1 });
  } catch {
    return json(res, 200, {
      ...base,
      ok: false,
      reason: 'banco_indisponivel',
      message: 'A API está no ar, mas o banco não respondeu. Confira a DATABASE_URL e se o esquema foi aplicado.',
    });
  }
});
