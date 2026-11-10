# Features and priorities

GitHub is the work queue. This folder holds direction, documentation that would be lost in a
ticket, and raw ideas that do not yet warrant one, not a duplicate set of delivery checklists.
Reconciled 2026-11-10; [the archive map](../archive/README.md) preserves source research and the
issue handoff.

| Reference | What it owns |
| --- | --- |
| [roadmap.md](roadmap.md) | Direction and where to find work; the issue tracker owns the queue |
| [brainstorm.md](brainstorm.md) | Raw non-AI ideas with no ticket yet, not approved scope |
| [ai-ml.md](ai-ml.md) | How the Claude assists work, their guardrails, and AI/ML ideas with no ticket yet |
| [../human-decisions/](../human-decisions/README.md) | Durable human outcomes, rationale and policy defaults |
| [../shipped.md](../shipped.md) | Built slices and ADR evidence, distinct from operational activation |
| [Open issues](https://github.com/AaronBuxbaum/diveday/issues) | Implementation acceptance, claims and current task status |

## Promote an idea once

Search current code, issues and PRs before filing. Preserve the human's actual decision; an audit
recommendation is not approval. Reuse an existing issue, or file a narrowly scoped issue (an `idea` when it is not yet ready to
work) with acceptance and verification; the idea then leaves these files. Follow
[the issue workflow](../../agents/issue-tracker.md).

The old persona story backlog and participant-type plan are [archived](../archive/README.md):
participant types shipped, and the old minimum-age proposal was superseded by the recorded
[minimum-age policy](../human-decisions/H-20260724-minimum-age-gate-fail.md) and
[birth-date decision](../human-decisions/H-20260730-minimum-age-gate-data.md). Do not reopen either
from an old missing-feature description.
