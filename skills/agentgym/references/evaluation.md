# Evaluation contract

A valid AgentGym performance claim needs: (1) a baseline run, (2) identical task/environment conditions for the candidate, (3) deterministic verification where possible, (4) held-out tasks not used to author the mutation, and (5) explicit reporting of failures and limitations.

Suggested score inputs: task success, tests, typecheck/lint/build status, forbidden-file edits, unrelated diff size, attempts, wall-clock time, token usage, and cost when the runner exposes them.
