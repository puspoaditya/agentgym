import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shell, makeTaskFromCommit } from '../src/core.js';
import { evaluateTask } from '../src/evaluation.js';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'kodematik-eval-'));
  shell('git',['init'],{cwd:dir});shell('git',['config','user.email','test@example.com'],{cwd:dir});shell('git',['config','user.name','Kodematik Test'],{cwd:dir});
  writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module',scripts:{test:'node --test'}},null,2));
  writeFileSync(join(dir,'math.js'),'export const add=(a,b)=>a-b;\n');
  shell('git',['add','.'],{cwd:dir});shell('git',['commit','-m','broken add'],{cwd:dir});
  mkdirSync(join(dir,'test'));writeFileSync(join(dir,'test','math.test.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../math.js';test('add',()=>assert.equal(add(2,3),5));\n");
  writeFileSync(join(dir,'math.js'),'export const add=(a,b)=>a+b;\n');
  shell('git',['add','.'],{cwd:dir});shell('git',['commit','-m','fix: add correctly'],{cwd:dir});
  return dir;
}

function sourceFixAgent(cwd){writeFileSync(join(cwd,'math.js'),'export const add=(a,b)=>a+b;\n');return{ok:true,status:0,events:[],usage:{input_tokens:11,output_tokens:7},stderr:''};}
function testEditingAgent(cwd){writeFileSync(join(cwd,'math.js'),'export const add=(a,b)=>a+b;\n');writeFileSync(join(cwd,'test','math.test.js'),"import test from 'node:test';test('fake',()=>{});\n");return{ok:true,status:0,events:[],usage:{input_tokens:11,output_tokens:7},stderr:''};}

test('evaluation replays the historical test oracle and ignores an unchanged oracle in agent diff',()=>{
  const dir=fixture(),commit=shell('git',['rev-parse','HEAD'],{cwd:dir}).stdout,task=makeTaskFromCommit(dir,commit),result=evaluateTask(dir,task,{agentRunner:sourceFixAgent});
  assert.equal(result.verificationStrategy,'targeted-test-oracle');
  assert.deepEqual(result.testOracleFiles,['test/math.test.js']);
  assert.equal(result.testRegressionDetected,true);
  assert.equal(result.verificationPlanLocked,true);
  assert.equal(result.modifiedOracleFiles.length,0);
  assert.deepEqual(result.files,['math.js']);
  assert.equal(result.pass,true);
});

test('evaluation fails closed when an agent edits the locked historical test oracle',()=>{
  const dir=fixture(),commit=shell('git',['rev-parse','HEAD'],{cwd:dir}).stdout,task=makeTaskFromCommit(dir,commit),result=evaluateTask(dir,task,{agentRunner:testEditingAgent});
  assert.deepEqual(result.modifiedOracleFiles,['test/math.test.js']);
  assert.equal(result.pass,false);
});
