---
name: visual-triage
description: Triage BackstopJS visual-regression differences locally or in CI, decide whether each change is expected, and approve only intentional reference updates.
---

# Visual triage

Backstop references live in `backstop_data/bitmaps_reference/`. A test run writes captures,
diffs, and an HTML report under ignored `backstop_data/` paths. CI never commits or approves
references automatically; it uploads the report and captures when the job fails.

## Triage loop

1. Read the code and route/state changes before opening images.
2. Run the smallest relevant comparison:

   ```bash
   BACKSTOP_FILTER='manifest-dark' node scripts/backstop-run.mjs test
   ```

   The filter is a regular expression over scenario labels. Use a comma-separated filter for a
   related group, such as `manifest|prep`.
3. Open `backstop_data/html_report/index.html` with `pnpm backstop:report` and inspect the
   reference, test, and diff images at every affected viewport.
4. Put each difference in one bucket:

   - **Expected:** the code change explains it. Run `pnpm backstop:approve` with the same filter
     and commit the changed reference PNGs.
   - **Regression:** the image reveals an unintended layout/content/state change. Fix the source,
     rerun the focused comparison, and do not approve the diff.
   - **Unclear:** leave the comparison failing and ask for a decision; never use approval to hide
     uncertainty.

## Mapping and stability

Scenario labels identify the surface and scheme, while the report identifies phone, desktop, or
print. Stateful setup is in `backstop/flows.cjs`; route, session, reset, and readiness changes
should be investigated there before changing a reference. If a diff appears without a relevant
code change, first check `DIVEDAY_CLOCK`, browser version, fonts, and the deterministic PGlite
reset. Do not mask a moving element to make the diff disappear.

## Handoff

Summarize the scenario/viewport, bucket, root cause, and whether references were approved. CI
reports are evidence for review; they are not a reason to auto-promote captures.
