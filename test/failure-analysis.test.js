import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFailureResult, rememberFailureProfile, failureProfileFor, clearFailureProfiles } from '../src/failure-analysis.js';

function failedResult(overrides={}){return{taskId:'abc123',title:'fix regression',pass:false,agent:{ok:false,status:1,stderr:'OpenRouter agent exceeded 8 tool-call turns',events:[{type:'tool.call',name:'read_file',args:{path:'src/foo.js'}},{type:'tool.call',name:'run_command',args:{command:'npm run lint'}}]},testOracleFiles:['tests/foo.test.js'],verificationCommands:['npm run test:unit -- tests/foo.test.js'],files:['AGENTS.md'],testFilesTouched:[],modifiedOracleFiles:[],after:[{ok:true,family:'lint',commandText:'npm run lint',status:0},{ok:false,family:'test',commandText:'npm run test:unit -- tests/foo.test.js',status:1}],...overrides};}

test('failure profile detects missing oracle, targeted verification, production edit, and turn exhaustion',()=>{
  const profile=analyzeFailureResult(failedResult());
  assert.equal(profile.turnExhausted,true);
  assert.equal(profile.didNotReadOracle,true);
  assert.equal(profile.didNotRunTargetedVerification,true);
  assert.equal(profile.noProductionEdit,true);
  assert.deepEqual(profile.signals,['turn-budget-exhausted','oracle-not-read','targeted-verify-not-run','no-production-edit','verification-still-failing']);
});

test('failure profile recognizes useful baseline behavior',()=>{
  const profile=analyzeFailureResult(failedResult({agent:{ok:true,status:0,stderr:'',events:[{type:'tool.call',name:'read_file',args:{path:'tests/foo.test.js'}},{type:'tool.call',name:'write_file',args:{path:'src/foo.js',chars:42}},{type:'tool.call',name:'run_command',args:{command:'npm run test:unit -- tests/foo.test.js'}}]},files:['src/foo.js']}));
  assert.equal(profile.turnExhausted,false);
  assert.equal(profile.didNotReadOracle,false);
  assert.equal(profile.didNotRunTargetedVerification,false);
  assert.equal(profile.noProductionEdit,false);
});

test('failure profiles are remembered per repository and task',()=>{
  clearFailureProfiles();
  const result=failedResult();rememberFailureProfile('/repo','abc123',result);
  assert.equal(failureProfileFor('/repo','abc123')?.taskId,'abc123');
  assert.equal(failureProfileFor('/other','abc123'),null);
});
