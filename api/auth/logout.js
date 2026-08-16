/* POST /api/auth/logout — §18 "Encerramento da sessão no dispositivo atual" */

import { handler, json, setCookie } from '../_lib/http.js';
import { revokeSession, SESSION_COOKIE } from '../_lib/auth.js';

export default handler(async (req, res) => {
  await revokeSession(req);
  setCookie(res, SESSION_COOKIE, '', { clear: true });
  json(res, 200, { ok: true });
});
