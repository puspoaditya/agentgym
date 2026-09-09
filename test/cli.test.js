import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('help exposes Kodematik v0.5 multi-agent evolution options',()=>{
  const out=execFileSync(process.execPath,[join(root,'src','cli.js'),'help'],{encoding:'utf8'});
  assert.match(out,/Kodematik v0\.5\.0/);
  assert.match(out,/kodematik evolve/);
  assert.match(out,/--agent codex\|openrouter/);
  assert.match(out,/deepseek\/deepseek-v4-flash/);
  assert.match(out,/--tasks N/);
  assert.match(out,/--holdout PERCENT/);
  assert.match(out,/--candidates N/);
  assert.match(out,/--install/);
});
