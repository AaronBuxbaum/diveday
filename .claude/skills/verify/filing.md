# Verify: file what you're leaving behind

Part of the **verify** skill ([SKILL.md](SKILL.md)). Read it before you report done.

## 5. File what you're leaving behind

Before you report done, empty your head. A bug, a safety gap or a decision only a human can make
becomes a GitHub issue labelled `needs-triage`, ten a run at most (see
[docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md)'s "Filing a follow-up"
section); anything else is a bullet in one "Notes" comment on the PR (AGENTS.md's hard rule).
Candidates:

- the improvement you can see but were not asked for
- the question whose answer would have changed what you built
- the risk or latent bug you noticed in nearby code
- the assumption you made where the other branch deserves a human's look
- work you started and deliberately stopped (say what is half-done, and where)

Then say in your closing message that you filed them, by issue number. A thought that exists only
in your final message is gone the moment the session ends — that is the whole reason the tracker
exists. `pnpm check:follow-ups` will refuse an issue whose prompt is too thin to run cold. Filing is
never a substitute for the work you were asked to do, and never the answer to a failing test.
