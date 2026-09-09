---
name: agentgym
description: Benchmark, diagnose, and improve coding-agent performance on the current repository. Use when asked to evaluate agent readiness, investigate recurring coding-agent failures, optimize AGENTS.md or repository skills, or compare a proposed instruction change against a reproducible baseline.
compatibility: Requires git; Node.js 20+ is required for the bundled AgentGym CLI.
---
# AgentGym

Improve repository-specific agent behavior through measured experiments, not intuition.

## Workflow
1. Establish a clean git baseline. Never benchmark with unknown uncommitted changes unless the user explicitly accepts them.
2. Discover executable verification: tests, typecheck, lint, build, and repository-specific checks.
3. Record a baseline before changing agent instructions.
4. Diagnose observed failures. Do not infer a weakness solely from missing documentation.
5. Propose one small mutation at a time to `AGENTS.md`, a focused skill, or a verification hook.
6. Evaluate each mutation in an isolated worktree against the same training tasks.
7. Re-test promising mutations on held-out tasks.
8. Keep a mutation only when it improves the held-out result without weakening deterministic checks.
9. Report baseline, final score, failures fixed, regressions, runtime, and evaluation limitations.

## Rules
- Never claim an improvement from a static readiness score.
- Prefer executable ground truth over LLM-as-judge scoring.
- Do not modify tests merely to make an agent patch pass.
- Separate training tasks from held-out evaluation tasks.
- Minimize context: prefer a narrow skill over a large global instruction file when the knowledge is task-specific.
- Preserve user code. Use git worktrees or disposable copies for experiments.
- Treat generated instructions as hypotheses that require evaluation.

## Commands
- `agentgym doctor` — inspect prerequisites and static repository signals.
- `agentgym benchmark --tasks N` — replay multiple historical tasks in isolated worktrees and report executable results.
- `agentgym evolve --tasks N --holdout PERCENT` — compare baseline vs candidate instructions on training tasks, then validate on held-out tasks.

## References
See `references/evaluation.md` for the evaluation contract.
