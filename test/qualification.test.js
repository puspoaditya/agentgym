import test from 'node:test';
import assert from 'node:assert/strict';
import { qualificationReason, prioritizeCommits, classifyDependencyFailure, qualificationFingerprint, qualificationSetFingerprint } from '../src/qualification.js';

test('qualificationReason classifies rejection causes',()=>{
  assert.equal(qualificationReason({preparation:{ok:false},before:[],regressionDetected:false,stableRegression:false,groundTruthPass:false}),'dependency-failure');
  assert.equal(qualificationReason({preparation:{ok:true},before:[],regressionDetected:false,stableRegression:false,groundTruthPass:false}),'no-verification');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:true}],regressionDetected:false,stableRegression:false,groundTruthPass:false}),'no-regression');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:false}],regressionDetected:true,stableRegression:false,groundTruthPass:false}),'unstable-regression');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:false}],regressionDetected:true,stableRegression:true,patchApplied:false,groundTruthPass:false}),'patch-apply-failure');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:false}],regressionDetected:true,stableRegression:true,patchApplied:true,postPatchPreparation:{ok:false},groundTruthPass:false}),'post-patch-dependency-failure');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:false}],regressionDetected:true,stableRegression:true,patchApplied:true,postPatchPreparation:{ok:true},groundTruthPass:false}),'ground-truth-verification-failure');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:false}],regressionDetected:true,stableRegression:true,patchApplied:true,postPatchPreparation:{ok:true},groundTruthPass:true}),'qualified');
});

test('classifyDependencyFailure separates common install causes',()=>{
  assert.equal(classifyDependencyFailure({stderr:'npm ERR! code EBADENGINE Unsupported engine'}),'node-engine');
  assert.equal(classifyDependencyFailure({stderr:'npm ci can only install when package-lock.json is in sync'}),'lockfile');
  assert.equal(classifyDependencyFailure({stderr:'npm ERR! ERESOLVE unable to resolve dependency tree'}),'dependency-resolution');
  assert.equal(classifyDependencyFailure({stderr:'sh: pnpm: command not found'}),'missing-tool');
  assert.equal(classifyDependencyFailure({stderr:'network request failed ECONNRESET'}),'network');
  assert.equal(classifyDependencyFailure({stderr:'arbitrary install script exited 1'}),'install-command');
});

test('prioritizeCommits moves fix-like subjects ahead while preserving order',()=>{
  const commits=[
    {hash:'1',subject:'docs: update readme',index:0},
    {hash:'2',subject:'fix: handle abort signal',index:1},
    {hash:'3',subject:'chore: release',index:2},
    {hash:'4',subject:'bugfix timeout regression',index:3},
    {hash:'5',subject:'handle incorrect result',index:4},
  ];
  assert.deepEqual(prioritizeCommits(commits).map(x=>x.hash),['2','4','5','1','3']);
});

test('qualification fingerprints are deterministic and environment-sensitive',()=>{
  const task={id:'abc123',commit:'commit-a',parent:'parent-a'};
  const base={runtime:{selectedNodeMajor:14,source:'historical-ci',packageManager:'npm',packageManagerVersion:'6',packageManagerSource:'node-compatibility'},postRuntime:{selectedNodeMajor:14,source:'historical-ci',packageManager:'npm',packageManagerVersion:'6',packageManagerSource:'node-compatibility'},dependencyResolutionMode:'commit-date-cutoff',dependencyResolutionDate:'2021-01-01T00:00:00.000Z',dependencyRefreshNeeded:false,verificationSource:'historical-ci',verificationCommands:['npm test'],failureSignature:'ci:test:1',beforeFailureDetails:[{name:'ci:test',kind:'test',command:'npm test'}],groundTruthRuns:[[{name:'ci:test',ok:true,status:0}],[{name:'ci:test',ok:true,status:0}]]};
  const a=qualificationFingerprint(task,base),b=qualificationFingerprint(task,structuredClone(base));
  assert.equal(a,b);
  assert.notEqual(a,qualificationFingerprint(task,{...base,runtime:{...base.runtime,selectedNodeMajor:16}}));
  const setA=qualificationSetFingerprint([{id:task.id,qualification:{fingerprint:a}}]);
  const setB=qualificationSetFingerprint([{id:task.id,qualification:{fingerprint:b}}]);
  assert.equal(setA,setB);
});
