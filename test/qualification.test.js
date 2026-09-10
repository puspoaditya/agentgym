import test from 'node:test';
import assert from 'node:assert/strict';
import { qualificationReason, prioritizeCommits } from '../src/qualification.js';

test('qualificationReason classifies rejection causes',()=>{
  assert.equal(qualificationReason({preparation:{ok:false},before:[],regressionDetected:false,groundTruthPass:false}),'dependency-failure');
  assert.equal(qualificationReason({preparation:{ok:true},before:[],regressionDetected:false,groundTruthPass:false}),'no-verification');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:true}],regressionDetected:false,groundTruthPass:false}),'no-regression');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:false}],regressionDetected:true,groundTruthPass:false}),'ground-truth-failed');
  assert.equal(qualificationReason({preparation:{ok:true},before:[{ok:false}],regressionDetected:true,groundTruthPass:true}),'qualified');
});

test('prioritizeCommits moves fix-like subjects ahead while preserving order',()=>{
  const commits=[
    {hash:'1',subject:'docs: update readme',index:0},
    {hash:'2',subject:'fix: handle abort signal',index:1},
    {hash:'3',subject:'chore: release',index:2},
    {hash:'4',subject:'bugfix timeout regression',index:3},
  ];
  assert.deepEqual(prioritizeCommits(commits).map(x=>x.hash),['2','4','1','3']);
});
