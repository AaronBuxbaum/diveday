# FU-20260821-ready-never-reaches-network-idle — Find out what keeps /ready's network busy forever on CI

- **Status:** Open
- **Raised:** 2026-08-21 — PR #585, un-redding `main` after #583 merged
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/app/ready/[token]/page.tsx`, `src/app/observability-client.tsx`, `e2e/a11y.spec.ts`

## What I noticed

`e2e/a11y.spec.ts`'s booking scan sat on `page.waitForLoadState("networkidle")` on the `/ready`
page and never came back. Across three CI runs it consumed **exactly** its whole budget each time —
30s (run 32439332010), then 60s (run 32440808953), then 120s (run 32441820119). A merely slow test
passes at some budget; this one never would.

It does not reproduce locally. Instrumented on this machine, `/ready` reaches network idle **2ms**
after the booking redirect, and the axe scan on it takes 1.84s finding zero violations. The same
helper reaches idle fine on every other surface the file scans, on CI included — the public
schedule, the trip page, the waiver, roll call, the staff detail pages. `/ready` on a CI runner is
the only combination that hangs.

PR #585 removed the `networkidle` wait, which is the right call for the test regardless (every
caller already gates on the surface's own heading, and `check:e2e-hygiene` bans the API for exactly
this reason). But that fixes the *test*, and leaves the question underneath it unanswered.

**A page that never reaches network idle is a real thing on a real phone.** If something on `/ready`
is retrying, polling, or holding a connection open indefinitely, the diver reading their pre-trip
checklist at the dock pays for it in battery and data, and nothing in the product would ever say so.
It is equally possible this is a CI-only artifact — an outbound request to a host the runner cannot
reach, hanging rather than failing fast. Both are worth knowing; only one is a bug.

## Why it isn't already done

PR #585 needed `main` green, and this needs instrumentation on a CI runner rather than a guess. I
was twice wrong about this failure by reasoning from the stack trace instead of measuring, and the
third attempt only succeeded by removing the mechanism rather than explaining it. Explaining it is
still worth doing, and it is a different job.

## Proposed change

Find what is in flight. The Playwright report artifact from run 32441820119 (`playwright-report-1`)
carries a trace for the failing test — open it with `pnpm exec playwright show-trace` and read the
network panel at the point of the hang. That should name the request directly.

Prime suspects, in the order worth checking:

- **The telemetry mounted by `src/app/observability-client.tsx`** — web vitals to `/api/vitals` and
  CloudWatch RUM. The fleet runs against a configured non-loopback `APP_HOST`, so a client call to
  an origin the runner cannot reach would hang rather than fail. This would be CI-only and not a
  product bug, but it should be confirmed, not assumed.
- **A prefetch of a Route Handler.** `/ready` renders the add-to-calendar action, which points at
  `/s/[shopSlug]/trips/[id]/calendar` — a Route Handler, not a page. A `next/link` prefetch of one
  has no RSC payload to resolve. `src/app/s/[shopSlug]/trips/[id]/_components/EmbedBookedNotice.tsx`
  deliberately uses a bare `<a>` for its own route link for this reason; check whether the calendar
  and share actions do the same.
- **A client-side retry loop** in anything `/ready` mounts.

If it turns out to be product-side, fix it there. If it is a CI-only unreachable host, say so in a
comment where the telemetry mounts, so the next person to meet this does not spend the evening on it.

**Not** proposed: putting the `networkidle` wait back.

## Prompt

```text
Work out why /ready never reaches network idle on a CI runner, when it settles in 2ms locally.

Background: e2e/a11y.spec.ts's booking scan hung on `page.waitForLoadState("networkidle")` on that
page across CI runs 32439332010, 32440808953 and 32441820119, consuming exactly its whole budget
each time (30s, 60s, 120s). PR #585 removed that wait — do not put it back; check:e2e-hygiene bans
the API and every caller already gates on the surface's own heading. Read the note above
`expectNoA11yViolations` in e2e/a11y.spec.ts first for the full history.

Start from the trace in the `playwright-report-1` artifact on run 32441820119 and read its network
panel at the hang. Then check, in this order: the telemetry in src/app/observability-client.tsx
(web vitals plus CloudWatch RUM — the fleet runs against a non-loopback APP_HOST, so a call to an
unreachable origin would hang rather than fail); whether anything on /ready prefetches a Route
Handler such as /s/[shopSlug]/trips/[id]/calendar via next/link, which has no RSC payload to
resolve (EmbedBookedNotice.tsx uses a bare <a> for exactly this reason); and any client-side retry
loop on that page.

Done when: you can name the in-flight request. If it is product-side — a retry loop, a held
connection — fix it, since a page that never idles costs a diver battery and data at the dock, and
add a regression test. If it is a CI-only unreachable host, leave a comment where the telemetry
mounts saying so. Run `pnpm check` and `pnpm e2e e2e/a11y.spec.ts --reporter=line`. Delete
docs/product/follow-ups/FU-20260821-ready-never-reaches-network-idle.md as part of the change.
```
