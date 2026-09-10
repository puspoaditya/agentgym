import test from 'node:test';
import assert from 'node:assert/strict';
import { qualificationReason, prioritizeCommits } from '../src/qualification.js';

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
