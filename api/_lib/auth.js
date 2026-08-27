/* =====================================================================
   NESTRA — Autenticação
   §20: "As credenciais devem ser processadas pelo mecanismo de
   autenticação escolhido, sem armazenar senhas em texto puro. Tokens de
   sessão devem ter expiração, proteção contra uso indevido e
   possibilidade de invalidação."
   ===================================================================== */

import crypto from 'node:crypto';
import { sql, asUser } from './db.js';
import { parseCookies, serverSalt } from './http.js';

export const SESSION_COOKIE = 'nestra_session';
const SESSION_DAYS = 30;

/* --------------------------------------------------------------------
   Senhas — scrypt, com sal por usuário
   -------------------------------------------------------------------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, N, r, p, saltHex, hashHex] = stored.split('$');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = crypto.scryptSync(password, salt, expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(derived, expected);
}

/* --------------------------------------------------------------------
   Sessões — só o hash do token vai para o banco
   -------------------------------------------------------------------- */
export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId, { userAgent, ipHash, deviceLabel }) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);

  await asUser(userId, (query) => [query`
      insert into sessions (user_id, token_hash, device_label, user_agent, ip_hash, expires_at)
      values (${userId}, ${hashToken(token)}, ${deviceLabel || null},
              ${(userAgent || '').slice(0, 300)}, ${ipHash || null}, ${expiresAt.toISOString()})
    `]);

  return { token, expiresAt };
}

/** Devolve o usuário da sessão atual, ou null. */
export async function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const [, rows] = await sql.transaction([
    /* A política RLS de `sessions` permite ler apenas a sessão cujo
       hash veio do cookie. O hash nunca é devolvido ao navegador. */
    sql`select set_config('app.session_hash', ${tokenHash}, true)`,
    sql`
      update sessions s set last_seen_at = now()
        from users u
       where s.token_hash = ${tokenHash}
         and u.id = s.user_id
         and s.revoked_at is null
         and s.expires_at > now()
         and u.deleted_at is null
         and u.status = 'active'
       returning u.id, u.email, u.display_name, u.timezone, u.locale,
                 u.avatar_color, s.id as session_id
    `,
  ]);

  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    timezone: row.timezone,
    locale: row.locale,
    avatarColor: row.avatar_color,
    sessionId: row.session_id,
  };
}

export async function revokeSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return;
  const tokenHash = hashToken(token);
  await sql.transaction([
    sql`select set_config('app.session_hash', ${tokenHash}, true)`,
    sql`update sessions set revoked_at = now()
         where token_hash = ${tokenHash} and revoked_at is null`,
  ]);
}

/* --------------------------------------------------------------------
   Limitação de tentativas (§20)
   -------------------------------------------------------------------- */
export function hashEmail(email) {
  return crypto.createHash('sha256')
    .update(String(email).toLowerCase() + serverSalt())
    .digest('hex')
    .slice(0, 32);
}

export async function tooManyAttempts(emailHash, ipHash) {
  const rows = await sql`
    select count(*)::int as n
      from login_attempts
     where created_at > now() - interval '15 minutes'
       and success = false
       and (email_hash = ${emailHash} or ip_hash = ${ipHash})
  `;
  return (rows[0]?.n || 0) >= 10;
}

export async function recordAttempt(emailHash, ipHash, success) {
  await sql`
    insert into login_attempts (email_hash, ip_hash, success)
    values (${emailHash}, ${ipHash}, ${success})
  `;
}

/** Registra um evento técnico da conta, sem conteúdo privado (§19). */
export async function logAccountEvent(userId, type, metadata = {}, ipHash = null) {
  try {
    await sql`
      insert into account_events (user_id, type, metadata_minimized, ip_hash)
      values (${userId}, ${type}, ${JSON.stringify(metadata)}::jsonb, ${ipHash})
    `;
  } catch { /* telemetria nunca derruba a requisição */ }
}

/** Exige autenticação; responde 401 e devolve null quando não houver. */
export async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(401).send(JSON.stringify({
      code: 'unauthenticated',
      message: 'Sua sessão expirou. Entre novamente para continuar.',
    }));
    return null;
  }
  return user;
}
