import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { historicalDependencyPlan, classifyDependencyFailure } from '../src/dependencies.js';

function fixture(){return mkdtempSync(join(tmpdir(),'kodematik-deps-'));}
const npm6={packageManager:'npm',packageManagerVersion:'6',selectedNodeMajor:14,currentNodeMajor:22};

test('npm without lockfile is bounded by target commit date',()=>{
  const dir=fixture();
  try{
    writeFileSync(join(dir,'package.json'),JSON.stringify({dependencies:{foo:'^1.0.0'}}));
    const plan=historicalDependencyPlan(dir,npm6,{resolutionDate:'2021-06-01T12:00:00.000Z'});
    assert.equal(plan.resolutionMode,'commit-date-cutoff');
    assert.equal(plan.locked,false);
    assert.deepEqual(plan.args,['install','--before=2021-06-01T12:00:00.000Z','--no-package-lock']);
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
