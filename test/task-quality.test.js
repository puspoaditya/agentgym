import test from 'node:test';
import assert from 'node:assert/strict';
import { taskUsefulness, prioritizeTasks } from '../src/task-quality.js';

test('source and test bug fix is strong benchmark material',()=>{
  const q=taskUsefulness({title:'fix: handle abort race',touchedFiles:['index.js','test/index.test.js']});
  assert.equal(q.benchmarkEligible,true);
  assert.equal(q.tier,'strong');
  assert.ok(q.score>=7);
});

test('dependency-only maintenance is excluded',()=>{
  const q=taskUsefulness({title:'chore: update dependencies',touchedFiles:['package.json']});
  assert.equal(q.benchmarkEligible,false);
  assert.equal(q.tier,'low');
  assert.ok(q.score<0);
});

test('dev-dependency update plus tests remains low usefulness without bug-fix intent',()=>{
  const q=taskUsefulness({title:'Update dev dependencies',touchedFiles:['package.json','test.js']});
  assert.equal(q.benchmarkEligible,false);
});

test('runtime migration is not treated like a bug fix merely because it touches source and tests',()=>{
  const q=taskUsefulness({title:'Require Node.js 6',touchedFiles:['package.json','index.js','test.js','.travis.yml']});
  assert.equal(q.maintenanceTitle,true);
  assert.equal(q.benchmarkEligible,false);
});

test('eligible tasks sort ahead of maintenance tasks',()=>{
  const entries=[
    {index:0,task:{id:'deps'},usefulness:taskUsefulness({title:'Update dependencies',touchedFiles:['package.json']})},
    {index:1,task:{id:'fix'},usefulness:taskUsefulness({title:'fix timeout regression',touchedFiles:['index.js','test.js']})},
  ];
  assert.deepEqual(prioritizeTasks(entries).map(x=>x.task.id),['fix','deps']);
});
