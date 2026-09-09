---
name: kodematik
description: Benchmark and improve coding-agent performance on the current repository by replaying historical regressions, testing competing repository-instruction mutations, and validating the training winner on held-out tasks.
compatibility: Requires git; Node.js 20+ is required for the bundled Kodematik CLI.
---
# Kodematik

Improve repository-specific coding-agent behavior through measured experiments, not intuition.

## Workflow
1. Establish a clean git baseline. Never benchmark unknown uncommitted changes unless the user explicitly accepts them.
2. Discover executable verification such as tests, typecheck, lint, build, and repository-specific checks.
3. Turn suitable historical commits into replay tasks and verify that the historical parent actually fails a deterministic check.
4. Split usable tasks into training and held-out sets before selecting an instruction strategy.
5. Record the training baseline once.
6. Evaluate multiple mutation candidates in isolated disposable Git worktrees against the same training tasks.
7. Rank candidates deterministically by pass rate, verification score, lower token usage, then candidate id.
8. Evaluate only the training winner against the baseline on held-out tasks.
9. Keep a winner only when it improves training without weakening measured metrics and does not regress held-out evaluation.
10. Report baseline, winner, score deltas, failures, token usage when available, and evaluation limitations.

## Built-in mutation strategies
- `minimal` — smallest correct patch with strict scope.
- `test-first` — reproduce and diagnose the narrow failure before editing.
- `repo-map` — inspect repository structure and follow local conventions.
- `verify-strict` — require every available deterministic check to pass.
- `combined` — combine repository inspection, root-cause diagnosis, minimal edits, and full verification.

## Rules
- Never claim an improvement from a static readiness score.
- Prefer executable ground truth over LLM-as-judge scoring.
- Never modify tests merely to make an agent patch pass.
- Never use held-out results to choose or author a candidate.
- Preserve existing historical `AGENTS.md` guidance; candidate instructions may augment it only inside disposable worktrees.
- Preserve the source repository during evaluation.
- Treat generated instructions as hypotheses that require evidence.
- Clearly label illustrative benchmark numbers as illustrative until reproduced by a real run.

## Commands
- `kodematik doctor` — inspect prerequisites and static repository signals.
- `kodematik benchmark --tasks N` — replay historical tasks and measure the agent.
- `kodematik evolve --tasks N --holdout PERCENT --candidates N` — run the mutation tournament and winner-only held-out validation.
- `kodematik init` — install this skill bundle into the current repository.

Defaults: `--tasks 10`, `--holdout 30`, `--candidates 5`.

## References
See `references/evaluation.md` for the evaluation contract.
