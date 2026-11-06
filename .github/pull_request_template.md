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
     erasure or src/db/bookings.ts needs one dive-domain-expert run framed as a dock operator (the line names its framing in parentheses right after the agent name, and a "not needed because" line is accepted only alone). Auth,
     tokens, personal data, waivers, src/lib/payments/, src/app/api/webhooks/ or export/import
     must name security-reviewer. CI's "Pull request body names its reviews" step
     (scripts/check-pr-body.mjs) reads these lines. -->

- `dive-domain-expert` (dock operator):
- `security-reviewer`:

## Seen filled in

<!-- A PR that changes the departure log, manifest, readiness, waiver or medical screens names the filled state it was seen in (the seeded dawn boat's log with its boat-safety snapshot, a signed waiver, a flagged medical) and the capture, or writes "no filled state because <reason>". "none" alone fails. CI's "Pull request body names its reviews" step reads it. -->

## Visual diffs

<!-- Paste `pnpm visual:report` output and say why each moved surface moved, or "no surface moved". -->

## Follow-ups filed

<!-- Issue numbers, one per line, or "none". Then "Closes #n", one per line, for every issue
     whose ## Claim names this branch; CI refuses the body without it. -->

## ADRs and glossary

<!-- ADR ids added or superseded, glossary terms added, or "none". -->

## Stack position

<!-- "Layer N of M — based on `<branch>` (#n). Above: `<branch>` (#n)." `node scripts/stack-map.mjs` prints the layers. -->
