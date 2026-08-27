#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:');
const ignored = new Set(['.git', 'node_modules']);
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
}

collect(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Falha de sintaxe em ${file}\n`);
    process.exit(result.status || 1);
  }
}

console.log(`${files.length} arquivos JavaScript sem erros de sintaxe.`);
