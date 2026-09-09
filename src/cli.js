#!/usr/bin/env node
import { mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { detectRepo, listReplayTasks, evaluateSuite, splitTasks, decideEvolution } from './core.js';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const cwd = process.cwd();

function flag(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
function has(name) { return args.includes(name); }
function intFlag(name, fallback) { const n = Number.parseInt(flag(name) || '', 10); return Number.isFinite(n) && n > 0 ? n : fallback; }

function printReport(r) {
  console.log('\nAGENTGYM — repository training baseline\n');
  for (const [name, ok] of r.checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
  console.log(`\nReadiness metadata: ${r.score}/100`);
  console.log('Note: readiness is diagnostic metadata, not an agent-performance benchmark.');
}
function doctor() { printReport(detectRepo(cwd)); }
function init() {
  const target = join(cwd,'skills','agentgym'); mkdirSync(target,{recursive:true});
  const src = new URL('../skills/agentgym/', import.meta.url);
  cpSync(src, target, { recursive: true });
  console.log('Created skills/agentgym/ with SKILL.md and references.');
}
function loadTasks(repo) {
  const count = intFlag('--tasks', 10);
  const tasks = listReplayTasks(repo.root, { limit: count });
  if (!tasks.length) throw new Error('Need at least one non-merge commit with a parent and changed files.');
  return tasks;
}
function printSuite(label, suite) {
  const s = suite.summary;
  console.log(`\n${label}`);
  for (const r of suite.results) {
    const marker = !r.usable ? 'SKIP' : r.pass ? 'PASS' : 'FAIL';
    console.log(`${marker.padEnd(4)} ${r.taskId}  ${r.score.toString().padStart(3)}/100  ${r.title}`);
  }
  console.log(`Usable: ${s.usable}/${s.total} · Pass rate: ${s.passRate}% · Verification: ${s.score}/100`);
  if (s.inputTokens || s.outputTokens) console.log(`Tokens: in=${s.inputTokens} out=${s.outputTokens}`);
}
function benchmark() {
  const repo = detectRepo(cwd);
  if (!repo.root) throw new Error('Run AgentGym inside a git repository.');
  const tasks = loadTasks(repo);
  console.log(`\nBenchmarking ${tasks.length} replay task${tasks.length === 1 ? '' : 's'}...`);
  const suite = evaluateSuite(repo.root, tasks, { candidate: has('--candidate'), runAgent: !has('--no-agent'), model: flag('--model') });
  printSuite(has('--candidate') ? 'Candidate' : 'Baseline', suite);
  if (!suite.summary.usable) console.log('\nNo usable regression tasks were found: pre-fix verification must fail for a task to count.');
}
function evolve() {
  const repo = detectRepo(cwd); printReport(repo);
  if (!repo.root) throw new Error('Run AgentGym inside a git repository.');
  const tasks = loadTasks(repo);
  const holdout = intFlag('--holdout', 30);
  const { training, heldout } = splitTasks(tasks, holdout);
  const options = { runAgent: !has('--no-agent'), model: flag('--model') };
  console.log(`\nTask split: ${training.length} training · ${heldout.length} held-out`);
  console.log('\nRunning training baseline...');
  const trainingBaseline = evaluateSuite(repo.root, training, { ...options, candidate: false });
  console.log('Running training candidate...');
  const trainingCandidate = evaluateSuite(repo.root, training, { ...options, candidate: true });
  printSuite('Training baseline', trainingBaseline);
  printSuite('Training candidate', trainingCandidate);
  let heldoutBaseline = { results: [], summary: { total:0, usable:0,passed:0,score:0,passRate:0,inputTokens:0,outputTokens:0 } };
  let heldoutCandidate = structuredClone(heldoutBaseline);
  if (heldout.length) {
    console.log('\nRunning held-out validation...');
    heldoutBaseline = evaluateSuite(repo.root, heldout, { ...options, candidate: false });
    heldoutCandidate = evaluateSuite(repo.root, heldout, { ...options, candidate: true });
    printSuite('Held-out baseline', heldoutBaseline); printSuite('Held-out candidate', heldoutCandidate);
  }
  const decision = decideEvolution({ trainingBaseline, trainingCandidate, heldoutBaseline, heldoutCandidate });
  console.log(`\nTraining delta: ${decision.training.scoreDelta >= 0 ? '+' : ''}${decision.training.scoreDelta} score, ${decision.training.passRateDelta >= 0 ? '+' : ''}${decision.training.passRateDelta} pass-rate points`);
  if (decision.hasHeldout) console.log(`Held-out delta: ${decision.heldout.scoreDelta >= 0 ? '+' : ''}${decision.heldout.scoreDelta} score, ${decision.heldout.passRateDelta >= 0 ? '+' : ''}${decision.heldout.passRateDelta} pass-rate points`);
  if (decision.keep) console.log('KEEP ✓ Candidate improved training and did not regress held-out evaluation.');
  else console.log('REJECT ✗ Candidate failed the train/held-out acceptance rule; repository is unchanged.');
  console.log('\nSafety: evaluations run in detached temporary Git worktrees and are removed afterward.');
}
function help() {
  console.log(`AgentGym v0.3.0\n\nUsage:\n  agentgym doctor\n  agentgym benchmark [--tasks N] [--candidate] [--model MODEL] [--no-agent]\n  agentgym evolve [--tasks N] [--holdout PERCENT] [--model MODEL] [--no-agent]\n  agentgym init\n\nv0.3:\n  benchmark  samples multiple non-merge commits and replays them in isolated worktrees\n  evolve     optimizes on a training split and validates the candidate on held-out tasks\n\nRequires Codex CLI for real agent runs. --no-agent exercises the harness without invoking Codex.\n`);
}
try { if (cmd==='doctor') doctor(); else if (cmd==='benchmark') benchmark(); else if (cmd==='evolve') evolve(); else if (cmd==='init') init(); else help(); }
catch (e) { console.error(`AgentGym error: ${e.message}`); process.exitCode = 1; }
