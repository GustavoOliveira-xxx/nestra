import { sql } from './_lib/db.js';
import { handler, json } from './_lib/http.js';

export default handler(async (req, res) => {
  const rows = await sql`select 1 as ok`;
  json(res, 200, {
    ok: rows[0]?.ok === 1,
    service: 'nestra-api',
    time: new Date().toISOString(),
  });
});
