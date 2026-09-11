import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractWorkflowRunCommands, extractWorkflowJobs, historicalVerificationJobs, historicalVerificationCommands, classifyVerificationFailure, verificationOutputSnippet } from '../src/verification.js';

function fixture(){return mkdtempSync(join(tmpdir(),'kodematik-verification-'));}

test('extractWorkflowRunCommands reads inline and block run steps',()=>{
  const text=`jobs:\n  test:\n    steps:\n      - run: npm install\n      - run: npm test\n      - run: |\n          npm run lint\n`;
  assert.deepEqual(extractWorkflowRunCommands(text),['npm install','npm test','npm run lint']);
});

test('extractWorkflowJobs keeps Node and Bun jobs separate',()=>{
  const text=`jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 26.x\n      - run: npm run lint\n      - run: npm run test:vitest:unit\n      - run: npm run test:vitest:browser:headless\n  bun-smoke:\n    needs: build\n    steps:\n      - uses: oven-sh/setup-bun@v2\n      - uses: actions/download-artifact@v4\n      - run: bun test\n`;
  const jobs=extractWorkflowJobs(text,'ci.yml');
  assert.equal(jobs.length,2);
  assert.equal(jobs[0].id,'build');
  assert.equal(jobs[0].toolchain,'node');
  assert.equal(jobs[0].nodeMajor,26);
  assert.deepEqual(jobs[0].commands.filter(x=>x.portable).map(x=>x.commandText),['npm run lint','npm run test:vitest:unit']);
  assert.equal(jobs[1].id,'bun-smoke');
  assert.equal(jobs[1].toolchain,'bun');
  assert.equal(jobs[1].dependent,true);
  assert.deepEqual(jobs[1].commands.map(x=>x.commandText),['bun test']);
});

test('historicalVerificationCommands selects one self-contained CI job and never mixes Bun',()=>{
  const dir=fixture();
  try{
    mkdirSync(join(dir,'.github','workflows'),{recursive:true});
    writeFileSync(join(dir,'package.json'),JSON.stringify({scripts:{test:'node --test',lint:'eslint .','test:unit':'vitest'}}));
    writeFileSync(join(dir,'.github','workflows','ci.yml'),`jobs:\n  build-and-test:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22.x\n      - run: npm install\n      - run: npm run lint\n      - run: npm run test:unit\n  bun-smoke:\n    needs: build-and-test\n    steps:\n      - uses: oven-sh/setup-bun@v2\n      - run: bun test\n`);
    const jobs=historicalVerificationJobs(dir),plan=historicalVerificationCommands(dir);
    assert.equal(jobs.length,2);
    assert.equal(plan.source,'historical-ci-job');
    assert.equal(plan.jobId,'build-and-test');
    assert.equal(plan.nodeMajor,22);
    assert.deepEqual(plan.commands.map(x=>x.commandText),['npm run lint','npm run test:unit']);
    assert.ok(plan.omittedJobs.includes('bun-smoke'));
    assert.doesNotMatch(plan.commands.map(x=>x.commandText).join('\n'),/bun test/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('historicalVerificationCommands prefers verification entrypoints from CI',()=>{
  const dir=fixture();
  try{
    mkdirSync(join(dir,'.github','workflows'),{recursive:true});
    writeFileSync(join(dir,'package.json'),JSON.stringify({scripts:{test:'node --test',lint:'eslint .'}}));
    writeFileSync(join(dir,'.github','workflows','ci.yml'),`jobs:\n  test:\n    steps:\n      - run: npm install\n      - run: npm test\n      - run: npm run lint\n`);
    const plan=historicalVerificationCommands(dir);
    assert.equal(plan.source,'historical-ci-job');
    assert.equal(plan.jobId,'test');
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
  assert.equal(classifyVerificationFailure({commandText:'bun test',stderr:'failed'}),'test');
  assert.equal(classifyVerificationFailure({stderr:'SyntaxError: unexpected token'}),'syntax');
  assert.equal(classifyVerificationFailure({stderr:'Cannot find module foo'}),'tooling');
  assert.equal(classifyVerificationFailure({stderr:'process exited 1'}),'verification-command');
});

test('verificationOutputSnippet removes terminal escapes and bounds output',()=>{
  const text=verificationOutputSnippet({stderr:'\u001b[31mfailed\u001b[0m '.repeat(100)},80);
  assert.ok(text.length<=80);
  assert.doesNotMatch(text,/\u001b/);
});
