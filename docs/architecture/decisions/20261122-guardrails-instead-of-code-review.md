# 20261122-guardrails-instead-of-code-review — Trust machine guardrails, not a human reading the code

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

Aaron does not read the code agents write and does not intend to. Until now the reading was
replaced by a large pile of checks, none of which said how much to trust them, and the checks are
written by the same agents they judge. The risks that matter are money math, dive safety, privacy
and erasure, offline roll-call races, one shop seeing another's data, and migrations. The honest
version of the deal is in [guardrails.md](../../engineering/guardrails.md).

## Decision

A change merges when the required check, `CI result`, is green on the top pull request of a stack.
Aaron's part is the screenshots and the **risk card** the stack carries: a plain-words verdict
("Fine to merge once the checks are green" or "Needs your eyes"), the areas the change touched, what
protects them, and what the card cannot tell him. Five layers stand behind it:

1. The risk card (`scripts/risk-card.mjs`) and the contract page, which also lists what is not covered.
2. Referee protection: deleting or loosening a test, floor, check or agent rule needs a written
   reason and a fresh `referee-reviewer` run, and shows in red on the card.
3. Breakage drills on money and safety lines the pull request changed; a break no test catches
   blocks the merge (`scripts/mutation/policy.json`, one word to switch to "warn").
4. Rule tests (property tests) that generate thousands of cases for the money, boarding, roll-call
   and capacity rules.
5. A cross-shop sweep that calls shop A's database functions with shop B's ids.

The rules are also written by agents, so a change to a rule is the most closely watched change
there is. A guardrail that stops fitting is changed or deleted, never kept as dead code.

## Alternatives considered

- **Aaron reads every diff** — does not scale and is the thing he asked to stop doing.
- **More hand-written example tests** — an agent that misreads a rule writes the test the same way.
- **Row-level security in Postgres** — a large change; the sweep covers most of the benefit until
  the first shop that is not a friend.
- **An external AI code reviewer on each pull request** — another model reading the same diff with
  the same blind spots, and a cost per change.

## Consequences

- A rule that is wrong from the start passes every check; the human checks before real divers board
  (V-02, V-03, V-04) stay human.
- Blocking merges on a missed breakage will sometimes cost a test-writing round. The switch is one
  word in the policy file.
- Revisit when a person goes back into the code: the first real payment, the first real boat day,
  the first shop that is not a friend, or the same area on "Needs your eyes" three pull requests in
  a row.
