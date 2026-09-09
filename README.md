<p align="center">
  <img src="assets/agentgym-banner.jpg" alt="AgentGym — Train your coding agent on your own codebase" width="100%">
</p>

<h1 align="center">AgentGym</h1>

<p align="center"><strong>Train your coding agent on your own codebase.</strong></p>

<p align="center">
  <a href="https://github.com/puspoaditya/agentgym"><img alt="Version" src="https://img.shields.io/badge/version-v0.3.0-7c3aed?style=for-the-badge"></a>
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge"></a>
  <a href="https://github.com/puspoaditya/agentgym/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/puspoaditya/agentgym?style=for-the-badge&logo=github"></a>
  <a href="https://github.com/puspoaditya/agentgym/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/puspoaditya/agentgym?style=for-the-badge&logo=github"></a>
</p>

<p align="center">
  <img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=flat-square&logo=javascript&logoColor=black">
  <img alt="Git" src="https://img.shields.io/badge/Git-worktrees-F05032?style=flat-square&logo=git&logoColor=white">
  <img alt="OpenAI Codex" src="https://img.shields.io/badge/OpenAI-Codex-412991?style=flat-square&logo=openai&logoColor=white">
  <img alt="Agent Skills" src="https://img.shields.io/badge/Agent-Skills-0ea5e9?style=flat-square">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-evaluation-111827?style=flat-square">
  <img alt="Held-out validation" src="https://img.shields.io/badge/held--out-validation-f97316?style=flat-square">
  <img alt="No runtime dependencies" src="https://img.shields.io/badge/runtime_dependencies-0-16a34a?style=flat-square">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#multi-commit-replay-tasks">How It Works</a> ·
  <a href="#held-out-evolution">Evolution</a> ·
  <a href="#commands">CLI</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

AgentGym is an experimental local evaluation harness for coding agents. It turns repository history into replay tasks, runs an agent inside isolated Git worktrees, verifies results with deterministic project checks, and compares baseline behavior against candidate repository instructions.

> **Benchmark → Diagnose → Improve → Validate → Retest.**

## Why AgentGym?

Coding-agent instructions are usually changed by intuition. AgentGym treats them like an optimization problem: replay real repository history, measure executable outcomes, mutate instructions, and keep a candidate only when the evidence says it improved performance.

| Capability | AgentGym |
| --- | --- |
| 🧪 Real tasks | Replays historical commits instead of synthetic prompts |
| 🧱 Isolation | Every experiment runs in a disposable detached Git worktree |
| ✅ Ground truth | Uses tests, typecheck, and lint instead of vibes-only scoring |
| 🧬 Evolution | Compares baseline behavior against candidate repository instructions |
| 🔒 Validation | Separates training tasks from held-out tasks |
| 🛡️ Safety | Rejects repairs that simply modify tests to hide failures |

## Status

`v0.3.0` is an early MVP focused on JavaScript/TypeScript repositories with package scripts and a Codex CLI adapter. The key change in v0.3 is **multi-task evaluation with held-out validation**: AgentGym no longer decides whether an instruction is useful from a single commit.

AgentGym intentionally separates two ideas:

- **readiness metadata** — static signals such as AGENTS.md, test scripts, lint and CI;
- **agent performance** — executable outcomes on replay tasks.

A readiness score is never presented as an agent benchmark score.

## Quick start

```bash
git clone https://github.com/puspoaditya/agentgym.git
cd agentgym
npm install
npm link

agentgym doctor
agentgym benchmark --tasks 10 --no-agent
agentgym evolve --tasks 10 --holdout 30 --no-agent
```

For a real coding-agent run, install and authenticate Codex CLI, then remove `--no-agent`:

```bash
agentgym benchmark --tasks 10
agentgym evolve --tasks 10 --holdout 30
```

Select a Codex model with:

```bash
agentgym evolve --tasks 10 --model <model>
```

## Multi-commit replay tasks

AgentGym samples non-merge commits from Git history. Each selected commit becomes a replay task:

1. Identify commit `C` and its single parent `P`.
2. Create a detached disposable Git worktree at `P`.
3. Run the repository verification commands before the agent.
4. Count the task only if the historical pre-fix state actually fails at least one check.
5. Ask the coding agent to diagnose and fix the regression.
6. Run the same verification commands after the agent.
7. Reject solutions that modify test files merely to make failures disappear.
8. Remove the worktree.

Tasks whose parent state is already green are reported as `SKIP` rather than becoming vacuous successes.

## Held-out evolution

`agentgym evolve` splits sampled tasks into **training** and **held-out** partitions.

```text
Git history
    │
    ├── training tasks
    │      ├── baseline
    │      └── candidate + generated AGENTS.md
    │
    └── held-out tasks
           ├── baseline
           └── candidate + generated AGENTS.md
```

The current candidate adds a concise `AGENTS.md` containing minimal-edit and verification guidance. AgentGym reports `KEEP` only when:

1. the candidate improves training performance;
2. it is not worse on either training metric;
3. it does not regress held-out evaluation when usable held-out tasks exist.

This is deliberately stricter than choosing the prompt that happens to win on the same task used to create it.

## Example output

```text
Task split: 7 training · 3 held-out

Training baseline
PASS a1b2c3d4  100/100  fix parser edge case
FAIL d4e5f6a7    0/100  fix stale cache
...
Usable: 6/7 · Pass rate: 50% · Verification: 58/100

Training candidate
...
Usable: 6/7 · Pass rate: 67% · Verification: 75/100

Held-out baseline
Usable: 3/3 · Pass rate: 67% · Verification: 67/100

Held-out candidate
Usable: 3/3 · Pass rate: 67% · Verification: 67/100

Training delta: +17 score, +17 pass-rate points
Held-out delta: +0 score, +0 pass-rate points
KEEP ✓ Candidate improved training and did not regress held-out evaluation.
```

The numbers above illustrate the output format; AgentGym only prints real results from the repository being evaluated.

## Commands

| Command | Purpose |
| --- | --- |
| `agentgym doctor` | Inspect prerequisites and repository readiness signals |
| `agentgym benchmark --tasks N` | Replay multiple historical tasks and measure the agent |
| `agentgym benchmark --candidate` | Benchmark with candidate repository instructions |
| `agentgym evolve --tasks N --holdout PERCENT` | Train on one partition and validate on held-out tasks |
| `agentgym init` | Install the AgentGym skill bundle into the current repository |

`--tasks N` defaults to `10`. `--holdout PERCENT` defaults to `30` and is clamped to a conservative range by the current MVP.

## Deterministic verification

For Node repositories AgentGym detects these package scripts when present:

- `test`
- `typecheck` / `type-check`
- `lint`

The verification score is the percentage of available checks that pass. A task can only count as a successful repair if a regression was detected before the agent and every detected verification command passes afterward.

## Safety model

Agent runs are launched with Codex's workspace-write sandbox and no approval prompts, inside disposable detached Git worktrees. The original repository is not modified by benchmark/evolution runs.

Repository verification commands can themselves execute arbitrary project code. Only benchmark repositories you trust.

## Agent Skill

The repository includes:

```text
skills/agentgym/
├── SKILL.md
└── references/
    └── evaluation.md
```

Install the skill bundle into another repository with:

```bash
agentgym init
```

## What v0.3 proves

The test suite covers:

- source/worktree isolation;
- historical replay task construction;
- non-vacuous regression detection;
- a ground-truth historical patch successfully solving a replay task;
- deterministic training/held-out partitioning;
- suite scoring and token aggregation;
- rejection when training improves but held-out performance regresses.

Run it with:

```bash
npm test
```

## Roadmap

- [ ] Stronger replay-task qualification and likely bug-fix filtering
- [ ] Historical dependency-install strategies
- [ ] Multiple competing mutations for `AGENTS.md`, skills, and hooks
- [ ] Cost-aware candidate selection and repeated stochastic trials
- [ ] Additional coding-agent adapters
- [ ] JSON and HTML benchmark reports
- [ ] GitHub Action for continuous agent evaluation
- [ ] npm package and release automation

## Contributing

AgentGym is early and intentionally small. Issues, experiments, reproducible failure cases, agent adapters, and evaluation ideas are welcome.

If AgentGym helps your coding-agent workflow, consider starring the repository — it makes the project easier for other agent builders to discover.

## License

MIT © AgentGym contributors
