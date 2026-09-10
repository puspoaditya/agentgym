import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractWorkflowRunCommands, historicalVerificationCommands, classifyVerificationFailure, verificationOutputSnippet } from '../src/verification.js';

function fixture(){return mkdtempSync(join(tmpdir(),'kodematik-verification-'));}

test('extractWorkflowRunCommands reads inline and block run steps',()=>{
  const text=`jobs:\n  test:\n    steps:\n      - run: npm install\n      - run: npm test\n      - run: |\n          npm run lint\n`;
  assert.deepEqual(extractWorkflowRunCommands(text),['npm install','npm test','npm run lint']);
});

test('historicalVerificationCommands prefers verification entrypoints from CI',()=>{
  const dir=fixture();
  try{
    mkdirSync(join(dir,'.github','workflows'),{recursive:true});
    writeFileSync(join(dir,'package.json'),JSON.stringify({scripts:{test:'node --test',lint:'eslint .'}}));
    writeFileSync(join(dir,'.github','workflows','ci.yml'),`jobs:\n  test:\n    steps:\n      - run: npm install\n      - run: npm test\n      - run: npm run lint\n`);
    const plan=historicalVerificationCommands(dir);
    assert.equal(plan.source,'historical-ci');
    assert.deepEqual(plan.commands.map(x=>x.commandText),['npm test','npm run lint']);
    assert.deepEqual(plan.commands[0].command,['npm',['test']]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('historicalVerificationCommands falls back to package scripts when CI has no verification run',()=>{
  const dir=fixture();
  try{
    writeFileSync(join(dir,'package.json'),JSON.stringify({scripts:{test:'node --test'}}));
    const plan=historicalVerificationCommands(dir);
    assert.equal(plan.source,'package-scripts');
    assert.equal(plan.commands.length,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('verification failure classifier separates common check families',()=>{
  assert.equal(classifyVerificationFailure({stderr:'XO found 2 problems'}),'lint');
  assert.equal(classifyVerificationFailure({stderr:'tsd type error'}),'types');
  assert.equal(classifyVerificationFailure({stderr:'AVA test failed'}),'test');
  assert.equal(classifyVerificationFailure({stderr:'SyntaxError: unexpected token'}),'syntax');
  assert.equal(classifyVerificationFailure({stderr:'Cannot find module foo'}),'tooling');
  assert.equal(classifyVerificationFailure({stderr:'process exited 1'}),'verification-command');
});

test('verificationOutputSnippet removes terminal escapes and bounds output',()=>{
  const text=verificationOutputSnippet({stderr:'\u001b[31mfailed\u001b[0m '.repeat(100)},80);
  assert.ok(text.length<=80);
  assert.doesNotMatch(text,/\u001b/);
});
