<!-- Fill every section; write "none" where nothing applies. Why each is here: docs/agents/repo-checks.md#pr-body -->

## Before

<!-- One paragraph: what a person saw or could not do before this change. -->

## After

<!-- One paragraph: what they see or can do now. -->

## What

<!-- The change, in a few bullets a reviewer can check against the diff. -->

- [ ] A new feature a shop could run without has a Features switch (default on), or a `core` entry in `src/lib/feature-coverage.ts` saying why not; "none" if no feature is new.

## How

<!-- The approach and the decision that was not obvious. What you ran, and what you did not. -->

## Reviews launched

<!-- Each line: "launched" and what it found and what changed, or "not needed because <reason>".
     A diff touching manifests, roll call, readiness, cert gating, medical, waivers, nitrox,
     erasure or src/db/bookings.ts needs two dive-domain-expert runs launched in parallel, one line
     each: one framed as a dock operator, one as an attacker (each line names its framing). Auth,
     tokens, personal data, waivers, src/lib/payments/, src/app/api/webhooks/ or export/import
     must name security-reviewer. CI's "Pull request body names its reviews" step
     (scripts/check-pr-body.mjs) reads these lines. -->

- `dive-domain-expert` (dock operator):
- `dive-domain-expert` (attacker):
- `security-reviewer`:

## Visual diffs

<!-- Paste `pnpm visual:report` output and say why each moved surface moved, or "no surface moved". -->

## Follow-ups filed

<!-- Issue numbers, one per line, or "none". Then "Closes #n", one per line, for every issue
     whose ## Claim names this branch; CI refuses the body without it. -->

## ADRs and glossary

<!-- ADR ids added or superseded, glossary terms added, or "none". -->

## Stack position

<!-- "Layer N of M — based on `<branch>` (#n). Above: `<branch>` (#n)." `node scripts/stack-map.mjs` prints the layers. -->
