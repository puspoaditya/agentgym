import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectHistoricalRuntime, detectHistoricalPackageManager, commandForRuntime } from '../src/runtime.js';

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
    assert.equal(runtime.packageManager,'npm');
    assert.equal(runtime.packageManagerVersion,'10');
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

test('Node 14 without a lockfile pairs with npm 6',()=>{
  const dir=fixture();
  try{
    writeFileSync(join(dir,'package.json'),JSON.stringify({engines:{node:'>=12'}}));
    const pm=detectHistoricalPackageManager(dir,14);
    assert.deepEqual(pm,{name:'npm',version:'6',source:'node-compatibility'});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('packageManager field wins and keeps exact version',()=>{
  const dir=fixture();
  try{
    writeFileSync(join(dir,'package.json'),JSON.stringify({packageManager:'pnpm@8.15.9'}));
    writeFileSync(join(dir,'pnpm-lock.yaml'),'lockfileVersion: 6.0\n');
    assert.deepEqual(detectHistoricalPackageManager(dir,18),{name:'pnpm',version:'8.15.9',source:'package.json#packageManager'});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('package-lock v1 pairs npm commands with npm 6',()=>{
  const dir=fixture();
  try{
    writeFileSync(join(dir,'package.json'),'{}\n');
    writeFileSync(join(dir,'package-lock.json'),JSON.stringify({lockfileVersion:1}));
    assert.equal(detectHistoricalPackageManager(dir,16).version,'6');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('package manager command is wrapped with both historical Node and npm',()=>{
  const [bin,args]=commandForRuntime('npm',['install'],{currentNodeMajor:22,selectedNodeMajor:14,packageManager:'npm',packageManagerVersion:'6'});
  assert.equal(bin,'npx');
  assert.deepEqual(args,['--yes','--package','node@14','--package','npm@6','npm','install']);
});

test('node command is wrapped with selected historical runtime',()=>{
  const [bin,args]=commandForRuntime('node',['script.js'],{currentNodeMajor:22,selectedNodeMajor:20,packageManager:'npm',packageManagerVersion:'10'});
  assert.equal(bin,'npx');
  assert.deepEqual(args,['--yes','--package','node@20','node','script.js']);
});
