import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageManager } from './core.js';

function commands(cwd, repoInfo) {
  const scripts = repoInfo.scripts || {};
  const pm = packageManager(cwd);
  const run = name => pm === 'npm' ? `npm run ${name}` : `${pm} ${name}`;
  return [
    scripts.test && (pm === 'npm' ? 'npm test' : `${pm} test`),
    scripts.typecheck && run('typecheck'),
    scripts['type-check'] && run('type-check'),
    scripts.lint && run('lint'),
  ].filter(Boolean);
}

function appendInstructions(cwd, title, bullets, repoInfo) {
  const path = join(cwd, 'AGENTS.md');
  const original = existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : '';
  const verify = commands(cwd, repoInfo);
  const block = [
    original,
    original ? '' : '# AGENTS.md',
    '',
    `## AgentGym candidate: ${title}`,
    ...bullets.map(x => `- ${x}`),
    ...(verify.length ? ['', '### Verification', ...verify.map(x => `- Run \`${x}\` before finishing.`)] : []),
    '',
  ].filter((line, i, all) => !(line === '' && i === 0)).join('\n');
  writeFileSync(path, block);
}

export const CANDIDATES = [
  {
    id: 'minimal', title: 'Minimal change',
    apply: (cwd, info) => appendInstructions(cwd, 'Minimal change', [
      'Make the smallest change that solves the task.',
      'Do not modify existing tests merely to make failures disappear.',
      'Avoid generated, vendor, lock, and build output unless required.',
    ], info),
  },
  {
    id: 'test-first', title: 'Test-first diagnosis',
    apply: (cwd, info) => appendInstructions(cwd, 'Test-first diagnosis', [
      'Reproduce the failure before editing code.',
      'Inspect the failing test and the nearest implementation files first.',
      'Preserve existing tests; fix the implementation rather than weakening assertions.',
      'Prefer a targeted test during iteration, then run the full available verification suite.',
    ], info),
  },
  {
    id: 'repo-map', title: 'Repository-aware',
    apply: (cwd, info) => appendInstructions(cwd, 'Repository-aware', [
      'Inspect package scripts and nearby files before choosing an implementation.',
      'Follow existing repository patterns, naming, module style, and error handling.',
      'Keep edits local to the failing behavior unless evidence requires a wider change.',
      'Do not modify tests merely to make failures disappear.',
    ], info),
  },
  {
    id: 'verify-strict', title: 'Strict verification',
    apply: (cwd, info) => appendInstructions(cwd, 'Strict verification', [
      'Diagnose the root cause before editing.',
      'Make the smallest correct implementation change.',
      'Do not modify existing tests merely to make failures disappear.',
      'Do not finish while an available deterministic verification command is failing.',
    ], info),
  },
  {
    id: 'combined', title: 'Combined discipline',
    apply: (cwd, info) => appendInstructions(cwd, 'Combined discipline', [
      'Reproduce the failure and inspect the nearest relevant test and implementation first.',
      'Follow existing repository patterns and make the smallest correct change.',
      'Preserve existing tests and avoid unrelated/generated/vendor/build files.',
      'Run targeted verification while iterating, then all available deterministic checks before finishing.',
      'Report the root cause, changed files, and verification performed.',
    ], info),
  },
];

export function candidatePool(limit = CANDIDATES.length) {
  return CANDIDATES.slice(0, Math.max(1, Math.min(CANDIDATES.length, limit)));
}

export function rankTournament(entries) {
  return [...entries].sort((a, b) =>
    b.suite.summary.passRate - a.suite.summary.passRate ||
    b.suite.summary.score - a.suite.summary.score ||
    (a.suite.summary.inputTokens + a.suite.summary.outputTokens) - (b.suite.summary.inputTokens + b.suite.summary.outputTokens) ||
    a.candidate.id.localeCompare(b.candidate.id)
  );
}
