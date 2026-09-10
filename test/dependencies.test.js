import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { historicalDependencyPlan, classifyDependencyFailure } from '../src/dependencies.js';

function fixture(){return mkdtempSync(join(tmpdir(),'kodematik-deps-'));}
const npm6={packageManager:'npm',packageManagerVersion:'6',selectedNodeMajor:14,currentNodeMajor:22};
const npm2={packageManager:'npm',packageManagerVersion:'2.15.11',selectedNodeMajor:4,currentNodeMajor:22,source:'package.json#engines.node'};

test('npm without lockfile is bounded by target commit date',()=>{
  const dir=fixture();
  try{
    writeFileSync(join(dir,'package.json'),JSON.stringify({dependencies:{foo:'^1.0.0'}}));
    const plan=historicalDependencyPlan(dir,npm6,{resolutionDate:'2021-06-01T12:00:00.000Z'});
    assert.equal(plan.resolutionMode,'commit-date-cutoff');
    assert.equal(plan.locked,false);
    assert.deepEqual(plan.args,['install','--before=2021-06-01T12:00:00.000Z','--no-package-lock']);
    assert.equal(plan.steps.length,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('legacy npm uses modern cutoff resolver then historical rebuild and root lifecycle',()=>{
  const dir=fixture();
  try{
    writeFileSync(join(dir,'package.json'),JSON.stringify({scripts:{prepublish:'node build.js'},dependencies:{foo:'^1.0.0'}}));
    const plan=historicalDependencyPlan(dir,npm2,{resolutionDate:'2018-07-28T15:18:48.000Z'});
    assert.equal(plan.resolutionMode,'legacy-two-phase-cutoff');
    assert.equal(plan.locked,false);
    assert.deepEqual(plan.steps.map(x=>x.role),['resolve','rebuild','root-prepublish']);
    assert.deepEqual(plan.steps[0].args,['install','--before=2018-07-28T15:18:48.000Z','--no-package-lock','--ignore-scripts']);
    assert.equal(plan.steps[0].runtime.selectedNodeMajor,14);
    assert.equal(plan.steps[0].runtime.packageManagerVersion,'6');
    assert.deepEqual(plan.steps[1].args,['rebuild']);
    assert.equal(plan.steps[1].runtime.selectedNodeMajor,4);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('historical npm lockfile wins over date cutoff',()=>{
  const dir=fixture();
  try{
    writeFileSync(join(dir,'package.json'),'{}');
    writeFileSync(join(dir,'package-lock.json'),JSON.stringify({lockfileVersion:1}));
    const plan=historicalDependencyPlan(dir,npm6,{resolutionDate:'2021-06-01T12:00:00.000Z'});
    assert.equal(plan.resolutionMode,'lockfile');
    assert.equal(plan.locked,true);
    assert.deepEqual(plan.args,['ci']);
    assert.equal(plan.resolutionDate,null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('historical cutoff failures are classified separately',()=>{
  assert.equal(classifyDependencyFailure({stderr:'npm ERR! code ETARGET No matching version found; no versions available on or before the requested date'}),'historical-resolution');
});
