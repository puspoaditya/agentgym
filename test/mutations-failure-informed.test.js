import test from 'node:test';
import assert from 'node:assert/strict';
import { failureRules, selectMutations } from '../src/mutations.js';

test('top mutation candidates are failure-informed',()=>{
  const mutations=selectMutations(3);
  assert.deepEqual(mutations.map(x=>x.id),['failure-localized','oracle-guided','turn-efficient']);
});

test('failure-informed rules encode observed baseline misses',()=>{
  const rules=failureRules({
    oracleFiles:['tests/unit/foo.test.js'],
    verificationCommands:['npm run test:unit -- tests/unit/foo.test.js'],
    didNotReadOracle:true,
    didNotRunTargetedVerification:true,
    noProductionEdit:true,
    turnExhausted:true,
    remainingFailures:[{family:'test'}],
  },{},'budget').join('\n');
  assert.match(rules,/tests\/unit\/foo\.test\.js/);
  assert.match(rules,/did not read the regression oracle/i);
  assert.match(rules,/did not run the locked targeted verification/i);
  assert.match(rules,/no production-code edit/i);
  assert.match(rules,/exhausted its tool-call budget/i);
  assert.match(rules,/strict sequence/i);
});
