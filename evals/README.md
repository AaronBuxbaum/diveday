# Agent setup evaluations

`agents/tasks.json` is live input to [the runner](../scripts/agent-evals.mjs), not application data
or a discarded experiment. Its golden tasks check whether a headless Claude planning session
finds the skills and reviewers required by the repository's current rules. The runner's
[unit tests](../scripts/agent-evals.test.mjs) load the same file.

## Run

From the repository root:

```sh
node scripts/agent-evals.mjs --validate
node scripts/agent-evals.mjs --task manifest-count --runs 2 --out /tmp/agent-evals.txt
```

`--validate` checks task shape and that named skills/reviewers exist, offline and without model
calls. Without it, the runner invokes the installed, signed-in Claude CLI in plan mode with
editing tools denied. Each task/run costs tokens; an unfiltered invocation runs every task
twice. These model evaluations are deliberately manual, outside CI and `pnpm check`. Ordinary
unit tests exercise the runner without invoking Claude. See the
[working rules](../docs/agents/working-rules.md#commands) for when to rerun them.

Maintain each task with the rule named by its `source`; update changed expectations and retire
tasks whose underlying requirement has gone away. A source description is not itself a rule.

`agents/baseline-2026-11-02.txt` is the first dated observation, including stable failures and a
flipped result. Keep it as historical evidence, not a current pass/fail gate. New transcripts
and ad hoc reports belong outside the checkout; commit a new dated summary only when it is a
useful comparison with a stated model, mode, turn cap and run count.
