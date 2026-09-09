<p align="center"><img src="assets/agentgym-banner.jpg" alt="AgentGym — Train your coding agent on your own codebase" width="100%"></p>
<h1 align="center">AgentGym</h1>
<p align="center"><strong>Train your coding agent on your own codebase.</strong></p>
<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-v0.4.0-7c3aed?style=for-the-badge">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge">
  <img alt="GitHub stars" src="https://img.shields.io/github/stars/puspoaditya/agentgym?style=for-the-badge&logo=github">
  <img alt="GitHub issues" src="https://img.shields.io/github/issues/puspoaditya/agentgym?style=for-the-badge&logo=github">
</p>
<p align="center">
  <img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=flat-square&logo=javascript&logoColor=black">
  <img alt="Git" src="https://img.shields.io/badge/Git-worktrees-F05032?style=flat-square&logo=git&logoColor=white">
  <img alt="OpenAI Codex" src="https://img.shields.io/badge/OpenAI-Codex-412991?style=flat-square&logo=openai&logoColor=white">
  <img alt="Evolution tournament" src="https://img.shields.io/badge/evolution-tournament-ec4899?style=flat-square">
  <img alt="Held-out validation" src="https://img.shields.io/badge/held--out-validation-f97316?style=flat-square">
  <img alt="No runtime dependencies" src="https://img.shields.io/badge/runtime_dependencies-0-16a34a?style=flat-square">
</p>

AgentGym is a local evaluation and evolution harness for coding agents. It turns repository history into executable replay tasks, benchmarks agent behavior in isolated Git worktrees, generates competing repository-instruction strategies, selects a winner on training tasks, and validates that winner on held-out tasks.

> **Benchmark → Mutate → Compete → Validate → Keep or Reject.**

## v0.4 — Actual Evolution

`agentgym evolve` now runs a real mutation tournament instead of comparing one static candidate.

```text
Historical repository tasks
          │
     Train / Held-out
          │
          ├──────── Training ──────────────────────┐
          │                                        │
       Baseline                            Mutation candidates
                                             ├─ minimal
                                             ├─ test-first
                                             ├─ repo-map
                                             ├─ verify-strict
                                             └─ combined
                                                   │
                                             Tournament
                                                   │
                                                Winner
                                                   │
          └──────── Held-out ──────────────────────┤
                                                   │
                                          Baseline vs Winner
                                                   │
                                             KEEP / REJECT
```

The five built-in strategies emphasize different agent behaviors: minimal patches, test-first diagnosis, repository-aware changes, strict verification, and a combined strategy. Existing historical `AGENTS.md` content is preserved and augmented inside the disposable evaluation worktree.

Tournament ranking is deterministic: **pass rate → verification score → lower token usage → candidate id**. Only the training winner reaches held-out evaluation, reducing evaluation cost and avoiding candidate-selection leakage into the holdout set.

## Quick start

```bash
git clone https://github.com/puspoaditya/agentgym.git
cd agentgym
npm install
npm link

agentgym doctor
agentgym benchmark --tasks 10 --no-agent
agentgym evolve --tasks 10 --holdout 30 --candidates 5 --no-agent
```

For real agent runs, install/authenticate Codex CLI and remove `--no-agent`:

```bash
agentgym evolve --tasks 20 --holdout 30 --candidates 5
```

Select a model with `--model <model>`.

## Example tournament

```text
Task split: 14 training · 6 held-out
Evolution tournament: 5 mutation candidates

Training tournament
candidate              pass rate  verify  tokens
baseline                    58%        64     18420
minimal                     67%        71     17790
test-first                  72%        78     19120
repo-map                    76%        82     18840
verify-strict               69%        80     19600
combined                    81%        87     20110  ← winner

Training winner: Combined strategy

Validating only the winner on held-out tasks...
Held-out baseline: 61%
Held-out winner:   78%

KEEP ✓ Combined strategy won training and did not regress held-out evaluation.
```

Numbers above are illustrative; AgentGym reports only results produced by the repository being evaluated.

## How replay evaluation works

1. Sample recent non-merge commits with a single parent.
2. Create a detached disposable worktree at the historical parent commit.
3. Run available deterministic checks before the agent.
4. Count the task only when the historical state actually contains a failing check.
5. Run the coding agent with baseline or mutation instructions.
6. Re-run the same checks.
7. Reject repairs that modify test/spec files merely to hide failures.
8. Remove the worktree.

Available Node verification currently includes `test`, `typecheck` / `type-check`, and `lint` package scripts.

## Commands

| Command | Purpose |
| --- | --- |
| `agentgym doctor` | Inspect repository readiness metadata |
| `agentgym benchmark --tasks N` | Replay historical tasks and measure the agent |
| `agentgym evolve --tasks N --holdout P --candidates N` | Run mutation tournament + held-out validation |
| `agentgym init` | Install the AgentGym skill bundle |

Defaults: `--tasks 10`, `--holdout 30`, `--candidates 5`.

## Safety and evaluation integrity

Agent runs use Codex's workspace-write sandbox inside disposable detached Git worktrees. Benchmark/evolution runs do not intentionally modify the source repository. Project verification scripts can execute repository code, so only evaluate repositories you trust.

AgentGym separates **readiness metadata** from **agent performance**. Static signals such as an `AGENTS.md` file or CI workflow are useful diagnostics, but they are never presented as proof that an agent performs better.

## Agent Skill

The repository includes `skills/agentgym/SKILL.md` plus an evaluation contract under `skills/agentgym/references/`. Install the bundle into another repository with:

```bash
agentgym init
```

## v0.4 test coverage

The suite covers worktree isolation, historical replay, non-vacuous regression detection, ground-truth patch replay, deterministic train/holdout splitting, suite/token scoring, held-out rejection, mutation catalog integrity, candidate isolation, and tournament tie-breaking.

```bash
npm run check
npm test
```

## Roadmap

- [x] Multi-task historical replay
- [x] Train / held-out evaluation
- [x] Multiple competing instruction mutations
- [x] Deterministic training tournament
- [x] Winner-only held-out validation
- [ ] Stronger bug-fix task qualification
- [ ] Historical dependency-install strategies
- [ ] Generated repo-specific mutations
- [ ] Repeated stochastic trials and confidence intervals
- [ ] Additional coding-agent adapters
- [ ] JSON / HTML reports
- [ ] GitHub Action and npm release automation

## Why AgentGym?

Most evaluation tools answer **“How good is my coding agent?”**

AgentGym is built to answer a different question:

> **“Which repository instructions measurably make my coding agent better — including on tasks they were not selected on?”**

## Contributing

Reproducible failure cases, new mutation strategies, agent adapters, and evaluation ideas are welcome. If AgentGym is useful to you, starring the repository helps other agent builders discover it.

## License

MIT © AgentGym contributors
