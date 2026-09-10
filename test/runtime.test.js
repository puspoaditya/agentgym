import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectHistoricalRuntime, commandForRuntime } from '../src/runtime.js';

function fixture(){return mkdtempSync(join(tmpdir(),'kodematik-runtime-'));}

test('historical CI takes precedence over engines when no explicit runtime file exists',()=>{
  const dir=fixture();
  try{
    mkdirSync(join(dir,'.github','workflows'),{recursive:true});
    writeFileSync(join(dir,'package.json'),JSON.stringify({engines:{node:'>=16'}}));
    writeFileSync(join(dir,'.github','workflows','ci.yml'),`jobs:\n  test:\n    strategy:\n      matrix:\n        node-version:\n          - 20\n          - 18\n          - 16\n`);
    const runtime=detectHistoricalRuntime(dir);
    assert.equal(runtime.selectedNodeMajor,20);
    assert.equal(runtime.source,'historical-ci');
    assert.deepEqual(runtime.workflowNodeMajors,[20,18,16]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('.nvmrc overrides historical CI',()=>{
  const dir=fixture();
  try{
    mkdirSync(join(dir,'.github','workflows'),{recursive:true});
    writeFileSync(join(dir,'.nvmrc'),'18\n');
    writeFileSync(join(dir,'.github','workflows','ci.yml'),'node-version: 20\n');
    const runtime=detectHistoricalRuntime(dir);
    assert.equal(runtime.selectedNodeMajor,18);
    assert.equal(runtime.source,'.nvmrc');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('node command is wrapped with selected historical runtime',()=>{
  const [bin,args]=commandForRuntime('node',['script.js'],{usesHistoricalNode:true,selectedNodeMajor:20});
  assert.equal(bin,'npx');
  assert.deepEqual(args,['--yes','node@20','script.js']);
});
