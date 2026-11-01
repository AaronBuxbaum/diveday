---
name: new-feature
description: "Build a product feature, docs to shipped slice. A ready spec: implement."
---

# Build a feature

Use this sequence for feature work. The [engineering workflow index](../../../docs/engineering/workflow.md)
links to the current authorities for verification, filing, stacking, design, and review; follow its
references instead of keeping a second checklist here.

1. **Context** — find the relevant milestone in [roadmap.md](../../../docs/product/features/roadmap.md),
   terms in [glossary.md](../../../docs/product/glossary.md), and relevant ADRs. Read the docs map
   ([docs/README.md](../../../docs/README.md)) for other contracts. When touching Next.js APIs,
   first read the matching guide in `node_modules/next/dist/docs/`.
2. **Slice** — state the smallest vertical slice a user could see working in one sentence before
   coding. If it requires a deferred decision such as database or auth, stop and use the `adr` skill
   first.
3. **Domain first** — put pure rules in `src/lib/` with unit tests alongside. Include the slice's
   concrete failure paths, such as a full boat, an uncertified diver, or an unsigned waiver.
4. **Design before UI** — for a new or reshaped surface, read `docs/design/principles.md` §10–11
   before writing components. State the screen's one idea, list the questions its user arrives with
   (answer them inline), and sketch at least two compositions in prose. Attach actions to the
   objects they affect and prefer in-place edits with undo over button-and-form detours. A
   card-stack-plus-button-row is a fallback, not the target. For a significant new surface, record
   the five-sentence brief in [`docs/design/surfaces.md`](../../../docs/design/surfaces.md) and put
   the constrained idea in a nearby code comment.
5. **UI second** — keep routes thin in `src/app/`, use semantic tokens and briefing voice, and
   render relative time through `nowDate()` from `src/lib/clock.ts`. Choose test layers using
   [testing.md](../../../docs/engineering/testing.md#how-a-change-decides-its-tests): changed flows
   extend the spec that walks them; new screens or states get captures when
   [captures.md](../e2e-and-visual/captures.md) calls for them; new critical journeys get a ledger
   row. Geometry is proven by a rendered capture, source rules by a `check:repo` guard. Follow
   [e2e-and-visual](../e2e-and-visual/SKILL.md) for flow and capture mechanics.
6. **Verify and review** — follow the [verify](../verify/SKILL.md) checklist; user-facing work also
   gets a [design-review](../design-review/SKILL.md). For UI changes, inspect the CI report for the
   exact commit with `pnpm visual:report --commit <sha>` and explain every changed, new, or deleted
   image using [visual-triage](../visual-triage/SKILL.md). Read every open PR review thread; act on
   findings, then reply as fixed, declined with a reason, or filed with the issue number in the
   thread. Follow the verify skill's review process and review-round limit.
7. **Document** — update docs invalidated by the change, including the glossary for new terms,
   overview for structural changes, roadmap status, and ADR index as applicable.
8. **File what remains** — follow the current classification and filing rules in
   [verify/filing.md](../verify/filing.md) and
   [issue-tracker.md](../../../docs/agents/issue-tracker.md#filing-a-follow-up). Those sources also
   define when requested work, a bug in your change, or a failing test must be handled in the change
   instead of filed as a follow-up.
9. **Ship in stack order** — commit with an imperative subject and why-body. Branches follow the
   newest open branch across threads; open the draft PR at the first commit and register it then.
   Keep it draft until CI is green and applicable review obligations are met. Follow
   [stacked-prs](../stacked-prs/SKILL.md) for the chain, push, CI, and landing mechanics. Remove
   leftover debug code; give every `biome-ignore` a reason ([repo-checks](../../../docs/agents/repo-checks.md#now-biome-rules)).
