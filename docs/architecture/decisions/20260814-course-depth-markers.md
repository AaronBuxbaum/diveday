# 20260814-course-depth-markers — A depth in course prose is a marker, resolved into the shop's own unit at render

- **Status:** Accepted
- **Date:** 2026-08-14
- **Closes:** `FU-20260812-course-depth-copy-cannot-follow-shop-units` (option 2, the product
  owner's call).

## Context

A course page's prose — overview, day plan, includes, FAQ answers — is free text in the shop's own
`courses` row, seeded from `src/db/course-templates.ts` and then rewritten by whoever runs the shop.
Roughly thirty of those sentences name a depth.

Nothing could reach them. `depthInUnit`/`depthText` (`src/lib/depth-units.ts`) convert a *stored
number*; a sentence is not a number, and parsing depths back out of shop-edited prose is the obvious
wrong turn — it would rewrite words a human typed. So a Key Largo shop set to feet, reading feet on
every other surface in the app, was told "No deeper than 12 meters" by its own course page.

The interim fix wrote every depth as the pair the agencies publish — "12 meters (40 feet)". Honest
and unit-neutral, but not responsive: the shop's setting still did not reach the page, and the
parenthetical lengthened copy that was already dense ("Dive 3: to 30–40 meters (100–130 feet), with
a safety cylinder staged on the line").

The follow-up laid out three options and named the thing that makes this hard: **this content exists
to be rewritten by shops**, so any solution that turns it into a template language has to survive a
human editing it.

## Decision

Course prose carries **depth markers**, resolved into `shops.depth_unit` at render.

- **The grammar is two forms and nothing else.** `{depth18}` renders "18 meters" or "60 feet";
  `{depth18n}` renders the bare number, for a range ("to `{depth30n}`–`{depth40}`"). No arguments,
  no nesting, no options.
- **Resolution is a lookup, not a conversion.** `COURSE_DEPTHS` (`src/lib/courses.ts`) holds the
  five recreational pairs — 12/40, 18/60, 21/70, 30/100, 40/130 — the same table `DepthCeiling`
  (`src/lib/depth-ceiling.ts`) holds, so a course page and a roster warning can never quote
  different limits. Converting instead would print "59 ft", the number that produced the false
  ceiling warning `DepthCeiling` was created to kill. A depth outside the table has no marker.
- **The markers are not ICU, and shop prose never touches MessageFormat.** `resolveCourseDepths` is
  a purpose-built scanner. It is total: it rewrites what it recognises and leaves every other
  character — braces included — exactly as typed.
- **A whole `courses` row is resolved once, at the top of the page**
  (`resolveCourseContentDepths`), never field by field in components. A prose field added to
  `CourseContent` that the resolver forgets is a compile error, not a sentence that quietly stops
  following the unit.
- **Deleting a marker is allowed. Breaking one is refused at save.** The course editor
  (`saveCourseContentAction`) runs `courseDepthPlaceholderIssues` over every prose field before
  anything is written and refuses the whole save with `?error=depth-placeholder&field=…`, focusing
  the offending box. The editor also carries a standing note above the form naming the grammar and
  the five choices.

## Alternatives considered

**Leave it as pairs** ("12 meters (40 feet)"). Zero machinery, always true, reads like the agency
manuals. Rejected because it still ignores the shop's setting — a Florida shop reads a metric-first
sentence with its own unit in parentheses — and because the parenthetical is dead weight in copy
that is already dense.

**Seed in the shop's unit.** Pick the wording once, at seed/import time, from `depth_unit`, leaving
ordinary editable prose behind. This was the follow-up's own recommendation and it is genuinely
simpler. Rejected because it fixes the wording at creation: a shop that later switches units is back
where it started, silently, with no signal that its pages now contradict the rest of the app. It
also doubles the template content, and "was this row seeded before or after they switched?" becomes
a question support has to answer.

**Convert the numbers found in the prose.** Never seriously on the table, and named here so it stays
off it: parsing a depth back out of a shop-edited sentence means rewriting words a human typed, and
would be wrong the first time someone writes "we stayed at 18 meters because the viz was better".

**ICU, through the real translator.** See below.

## Why not ICU, given the markers look like ICU

Because the translators are built with `onError: () => {}` (`src/i18n/messages.ts`,
`staff-messages.ts`) — right in production, where one bad string should degrade rather than blank a
page, and exactly wrong for a format pass over text a shop typed. An apostrophe before a brace, a
`#`, or a single stray `{` in a paragraph is an ICU syntax error; swallowed, it hands the page a
degraded or empty string. The failure mode would be *a paragraph of the shop's own marketing copy
silently disappearing*, with nothing in the log.

The scanner cannot do that. Its worst case is `{depth 18}` rendering its own braces on the page:
visible, inert, and already refused by the save that would have created it.

## Consequences

- A shop that switches units sees its course pages follow, immediately, with no re-seed — which
  option 3 (seed in the shop's unit) could not do.
- Depth prose is shorter: "maximum 40 feet" rather than "maximum 12 meters (40 feet)".
- **A shop owner now has one piece of syntax to learn**, which is a real cost and the reason the
  save-time refusal exists rather than a render-time best effort. The escape hatch is deliberate and
  advertised: delete the marker and write the depth however you like. The sentence stops following
  the shop's unit, which is the shop's call to make about its own words.
- Two surfaces resolve markers with the **shop's** locale rather than the reader's:
  `generateMetadata`, which Next resolves ahead of locale negotiation (and where reading request
  headers would cost the route its static shell). Body copy uses the reader's negotiated locale like
  everything else.
- The prose around a marker is still in whatever single language the shop wrote it in, while the
  unit word follows the reader. A Spanish reader of an English course page reads "60 pies" inside an
  English sentence. That is the pre-existing shape of this content — one row, one language — not
  something markers introduced, and it is not fixed here.
- A depth the agencies do not publish (25 m, say) cannot be a marker. Written as plain prose it
  behaves exactly as all of this content did before.
