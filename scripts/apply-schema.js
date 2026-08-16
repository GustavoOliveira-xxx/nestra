#!/usr/bin/env node
/* =====================================================================
   Aplica um arquivo .sql no Neon, statement por statement.

   Uso:
     DATABASE_URL='postgresql://…' node scripts/apply-schema.js db/schema.sql

   O driver HTTP do Neon aceita apenas um comando por requisição, então o
   arquivo é dividido aqui — respeitando blocos $$ … $$, strings e
   comentários.
   ===================================================================== */

import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';

function splitStatements(sqlText) {
  const out = [];
  let cur = '';
  let i = 0;
  let inSingle = false, inDouble = false, inLine = false, inBlock = false, dollar = null;

  while (i < sqlText.length) {
    const c = sqlText[i];
    const pair = sqlText.slice(i, i + 2);

    if (inLine) { cur += c; if (c === '\n') inLine = false; i++; continue; }
    if (inBlock) {
      cur += c;
      if (pair === '*/') { cur += sqlText[i + 1]; i += 2; inBlock = false; continue; }
      i++; continue;
    }
    if (dollar) {
      if (sqlText.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; continue; }
      cur += c; i++; continue;
    }
    if (inSingle) {
      cur += c;
      if (c === "'") {
        if (sqlText[i + 1] === "'") { cur += "'"; i += 2; continue; }
        inSingle = false;
      }
      i++; continue;
    }
    if (inDouble) { cur += c; if (c === '"') inDouble = false; i++; continue; }

    if (pair === '--') { inLine = true; cur += pair; i += 2; continue; }
    if (pair === '/*') { inBlock = true; cur += pair; i += 2; continue; }
    if (c === "'") { inSingle = true; cur += c; i++; continue; }
    if (c === '"') { inDouble = true; cur += c; i++; continue; }

    const tag = /^\$[A-Za-z_0-9]*\$/.exec(sqlText.slice(i));
    if (tag) { dollar = tag[0]; cur += dollar; i += dollar.length; continue; }

    if (c === ';') { out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());

  return out
    .map((s) => s.replace(/^(?:\s*--[^\n]*\n)+/, '').trim())
    .filter((s) => s && !/^(begin|commit|rollback)$/i.test(s));
}

const file = process.argv[2] || 'db/schema.sql';

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL antes de rodar.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const statements = splitStatements(fs.readFileSync(file, 'utf8'));

console.log(`→ ${statements.length} comandos em ${file}`);

let ok = 0;
let failed = 0;

for (const [n, statement] of statements.entries()) {
  const label = statement.replace(/\s+/g, ' ').slice(0, 76);
  try {
    await sql.query(statement);
    ok++;
    console.log(`  [${String(n + 1).padStart(3)}] ok   ${label}`);
  } catch (err) {
    failed++;
    console.log(`  [${String(n + 1).padStart(3)}] ERRO ${label}`);
    console.log(`        ${err.message}`);
  }
}

console.log(`\n${ok} aplicados, ${failed} com erro.`);
process.exit(failed ? 1 : 0);
