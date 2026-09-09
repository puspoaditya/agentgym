# Evaluation contract

A valid Kodematik performance claim needs: (1) a baseline run, (2) identical task and environment conditions for each candidate, (3) deterministic verification where possible, (4) a training/held-out split created before candidate selection, (5) no use of held-out results to author or rank mutations, and (6) explicit reporting of failures and limitations.

The training tournament ranks candidates by pass rate, verification score, lower token usage, then candidate id. Only the training winner should reach held-out evaluation.

Suggested score inputs: task success, tests, typecheck/lint/build status, forbidden-file edits, unrelated diff size, attempts, wall-clock time, token usage, and cost when the runner exposes them.

Illustrative examples are not benchmark claims. Publish performance numbers only when they come from a reproducible real-agent run.
