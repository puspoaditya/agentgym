import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { repositoryInstructionContext, buildOpenRouterSystemPrompt } from '../src/agents/openrouter.js';

function withRepo(fn){
  const cwd=mkdtempSync(join(tmpdir(),'kodematik-openrouter-'));
  try{return fn(cwd);}finally{rmSync(cwd,{recursive:true,force:true});}
}

test('OpenRouter system prompt injects repository AGENTS.md instructions',()=>withRepo(cwd=>{
  writeFileSync(join(cwd,'AGENTS.md'),'# Rules\n- Read the regression oracle first.\n- Candidate marker: oracle-guided\n');
  const first=repositoryInstructionContext(cwd),{systemPrompt,instructionContext}=buildOpenRouterSystemPrompt(cwd);
  assert.equal(first.loaded,true);
  assert.equal(first.path,'AGENTS.md');
  assert.equal(first.sha256,instructionContext.sha256);
  assert.match(systemPrompt,/Repository instructions from AGENTS\.md/);
  assert.match(systemPrompt,/Read the regression oracle first/);
  assert.match(systemPrompt,/Candidate marker: oracle-guided/);
}));

test('instruction fingerprint changes when mutation guidance changes',()=>withRepo(cwd=>{
  writeFileSync(join(cwd,'AGENTS.md'),'baseline instructions\n');
  const baseline=repositoryInstructionContext(cwd);
  writeFileSync(join(cwd,'AGENTS.md'),'baseline instructions\n\n# Kodematik candidate\n- Verify the exact oracle.\n');
  const candidate=repositoryInstructionContext(cwd);
  assert.notEqual(candidate.sha256,baseline.sha256);
  assert.ok(candidate.chars>baseline.chars);
}));

test('bounded instruction delivery preserves both repository prefix and appended mutation tail',()=>withRepo(cwd=>{
  const head='ROOT-RULE\n',middle='x'.repeat(200),tail='\nMUTATION-RULE';
  writeFileSync(join(cwd,'AGENTS.md'),head+middle+tail);
  const context=repositoryInstructionContext(cwd,{maxChars:100});
  assert.equal(context.loaded,true);
  assert.equal(context.truncated,true);
  assert.match(context.content,/ROOT-RULE/);
  assert.match(context.content,/MUTATION-RULE/);
}));

test('missing AGENTS.md is explicit and does not invent instructions',()=>withRepo(cwd=>{
  const {systemPrompt,instructionContext}=buildOpenRouterSystemPrompt(cwd);
  assert.equal(instructionContext.loaded,false);
  assert.equal(instructionContext.sha256,null);
  assert.doesNotMatch(systemPrompt,/BEGIN REPOSITORY INSTRUCTIONS/);
}));
