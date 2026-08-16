# FU-20260816-boat-aware-request-advisor — Decide how optional boats should improve request suggestions

- **Status:** Open
- **Raised:** 2026-08-16 — request-to-departure invitations and the imported-payment-history work
- **Kind:** question
- **Effort:** M
- **Touches:** `src/lib/request-advisor.ts`, `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx`, `src/db/schema.ts`, `docs/architecture/decisions/20260816-trip-invitations-are-outreach.md`

## What I noticed

Requests currently offer a transparent six-seat head-count suggestion from the people and party
sizes selected for a possible departure. That works without a boat record, which matters for a new
shop, but it cannot explain how an available boat's capacity, class, or operating constraints would
make one option better than another once the product models boats.

## Why it isn't already done

The current request/invitation slice was explicitly scoped to leads and outreach, not fleet or
operations modelling. A Boat concept changes the meaning of a capacity recommendation and could
touch scheduling, availability, staffing, manifests, and safety rules. Deciding those boundaries
without a product model would risk making the optional boat setup a hidden requirement for ordinary
departure creation.

## Proposed change

First choose a small optional Boat model and write its ADR. If accepted, let the request advisor use
configured boat capacity only as an explainable planning input: name a fitting boat where one exists,
show why it fits, and flag a request group that exceeds every known boat. Keep the current generic
capacity suggestion when no boat is configured. Do not turn a recommendation into a boat assignment,
capacity reservation, readiness decision, manifest gate, or safety clearance; each of those needs its
own decision and operational evidence.

## Prompt

```text
Read docs/architecture/decisions/20260816-trip-invitations-are-outreach.md,
src/lib/request-advisor.ts, src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx,
src/db/schema.ts, and the schedule/manifest readers named in AGENTS.md. Propose and obtain the
product decision for an optional Boat model before implementing it. A shop with no boats configured
must keep today's request suggestion and departure-creation flow unchanged. If the model is approved,
add a focused ADR, migration, seed data, exports, locale copy, unit tests, and focused e2e coverage.
Use boat data only to explain a best-fit planning recommendation or a known-capacity warning; never
silently assign a boat, reserve seats, change trip capacity, affect booking admission/readiness, or
alter a manifest. Run the focused tests, relevant browser flow, pnpm check:follow-ups, and pnpm check.
Delete docs/product/follow-ups/FU-20260816-boat-aware-request-advisor.md only if the approved Boat
slice actually lands; otherwise leave it Open with the decision still needed.
```
