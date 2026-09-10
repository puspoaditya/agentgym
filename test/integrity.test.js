import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSuites, decideEvolution, suitesUseSameTasks } from '../src/integrity.js';

function suite(entries,score=50,passRate=50){const results=entries.map(([taskId,usable=true])=>({taskId,usable,pass:false,score}));const usable=results.filter(x=>x.usable).length;return{results,summary:{total:results.length,usable,passed:0,score,passRate,inputTokens:0,outputTokens:0}};}

test('suite comparison requires exact usable task IDs',()=>{
  const baseline=suite([['a'],['b']],50,50),same=suite([['b'],['a']],75,100),mismatch=suite([['a'],['c']],100,100);
  assert.equal(suitesUseSameTasks(baseline,same),true);
  assert.equal(compareSuites(baseline,same).valid,true);
  assert.equal(compareSuites(baseline,mismatch).valid,false);
  assert.equal(compareSuites(baseline,mismatch).reason,'task-set-mismatch');
});

test('candidate becoming unusable invalidates comparison',()=>{
  const baseline=suite([['a'],['b']],50,50),candidate=suite([['a'],['b',false]],100,100);
  assert.equal(compareSuites(baseline,candidate).valid,false);
});

test('training-only improvement is provisional and never KEEP',()=>{
  const baseline=suite([['a'],['b']],50,50),candidate=suite([['a'],['b']],100,100),empty=suite([],0,0);
  const decision=decideEvolution({trainingBaseline:baseline,trainingCandidate:candidate,heldoutBaseline:empty,heldoutCandidate:empty});
  assert.equal(decision.keep,false);
  assert.equal(decision.outcome,'PROVISIONAL');
});

test('KEEP requires non-regressing exact held-out evidence',()=>{
  const trainingBaseline=suite([['a'],['b']],50,50),trainingCandidate=suite([['a'],['b']],100,100),heldoutBaseline=suite([['h']],50,50),heldoutCandidate=suite([['h']],50,50);
  assert.equal(decideEvolution({trainingBaseline,trainingCandidate,heldoutBaseline,heldoutCandidate}).outcome,'KEEP');
  const mismatched=suite([['other']],100,100);
  assert.equal(decideEvolution({trainingBaseline,trainingCandidate,heldoutBaseline,heldoutCandidate:mismatched}).outcome,'REJECT');
});
