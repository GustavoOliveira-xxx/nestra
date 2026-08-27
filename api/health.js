/* =====================================================================
   GET /api/health — a API está de pé? o banco responde?

   O front usa esta resposta para decidir entre sincronizar e guardar
   tudo só no navegador. Por isso ela precisa distinguir dois casos que
   parecem iguais de fora:

     • não existe API publicada  → o navegador recebe 404 e cai no modo
       local, que é o comportamento certo;
     • a API existe mas o banco não respondeu → antes isto virava um 500,
       o front tratava como "sem API" e a pessoa ficava com um "somente
       neste dispositivo" sem explicação, sem ter como saber que faltava
       só uma variável de ambiente.

   O segundo caso agora responde 200 identificando o serviço e dizendo o
   que falta, para a interface poder ser específica.
   ===================================================================== */

import { sql } from './_lib/db.js';
import { handler, json } from './_lib/http.js';

export default handler(async (req, res) => {
  const base = { service: 'nestra-api', time: new Date().toISOString() };

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
    // O detalhe fica no log; a resposta diz só o suficiente para agir
    return json(res, 200, {
      ...base,
      ok: false,
      reason: 'banco_indisponivel',
      message: 'A API está no ar, mas o banco não respondeu. Confira a DATABASE_URL e se o esquema foi aplicado.',
    });
  }
});
