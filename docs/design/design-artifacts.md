# Design artifacts

Where a picture of an unbuilt surface lives, what it is allowed to claim, and how it stops being a
lie the week after it is drawn.

This repo had no design files at all until 2026-08-27. Every surface was argued in prose
([principles.md](principles.md), [surfaces.md](surfaces.md)), decided in an ADR, and then reviewed
from screenshots of the thing already built — which works for *refining* a surface and fails for
*reshaping* one, because the cheapest moment to move a control is before it exists. The trip/manifest
redesign ([20260827-the-departure-is-two-working-surfaces](../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md))
was the first design drawn before the code, and it forced every question below. These are its
answers, and they bind the next one.

## The split: three homes, exactly one of them normative

| Where | What it holds | Authority |
| --- | --- | --- |
| A **canvas** — artboards, published as an Artifact | the pictures: composition, density, the states side by side | Illustrative. Dated. Never normative. |
| An **ADR** | the decisions the pictures were drawn to argue | **Normative.** Code obeys this. |
| [surfaces.md](surfaces.md) | the surface's one idea, in five sentences | The index. |

The rule that makes the split hold, and the reason a picture is never the source of truth:

> **When the canvas and the prose disagree, the prose wins. When the prose and the shipped code
> disagree, one of them is a bug, and both get fixed in the same pull request.**

Nothing can check a picture. `pnpm check:repo` cannot read a mockup's padding, no test fails when a
canvas drifts from the component it inspired, and a stale PNG is indistinguishable from a current one
at a glance — which is precisely how design systems come to be quietly ignored. So the canvas argues,
the ADR decides, and the code is held to the ADR by a doc comment and a test. A canvas that is
believed to be normative is worse than no canvas, because it invites two sources of truth for one
surface.

## Nobody but an agent reads these files, and that raises the stakes

Stated plainly because it inverts the usual reasoning about design assets: **the canvas has no human
audience.** It is not a review artifact, not a stakeholder deliverable, not something anyone opens
before a meeting. Its only reader is a session about to write TypeScript.

The intuition that follows is wrong, so it is worth killing here: *if only a machine reads it, the
rot matters less.* It matters **more**. A person opening a six-week-old mockup squints at it and
doubts it — different type, a control they know moved, a colour that was retired. An agent has no
such reflex. It reads the picture as a specification and rebuilds it faithfully, including the parts
a later decision deliberately removed. Undoing shipped work is the failure mode, and it looks like
diligence while it happens.

So the guard cannot be judgment, taste, or a reader noticing something looks old. It has to be
**procedure and a check**: a fixed read order, an authority that expires on its own, and a gate that
fails when the loop is left open. Those are the next two sections and
[the `design-implementation` skill](../../.claude/skills/design-implementation/SKILL.md).

## Authority expires per slice, not per canvas

> A canvas has authority over a surface **only while that surface's slice is unbuilt.** The moment a
> slice ships, the shipped code *is* the design for that surface, and the canvas has nothing more to
> say about it.

This is the rule that makes a design safe to leave lying around in an agent-operated repo. It gives
every disagreement a decidable answer without anyone having to judge how stale a picture looks:

| Canvas vs. code | What it means | What to do |
| --- | --- | --- |
| Slice still open | The canvas is the intent | Build it |
| Slice already shipped | **The canvas is stale** | Leave the code alone. A genuine problem is a new decision and needs an ADR, never a quiet edit toward an old drawing |
| ADR vs. code | Real drift, or an unshipped slice | Say which, in the PR |

Shipped code outranks the canvas; the ADR outranks both. And the read order — ADR, roadmap slice,
slice table, **current code**, the spec's slice section where one exists, artboards last — exists
so a session reaches the pictures already knowing which of them still apply.

## The slice table is the sync mechanism

Each canvas README carries a table of the slices its design breaks into, and that table — not
anybody's memory — is what says which surfaces are still the canvas's business:

```markdown
| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 5a | open | — | — |
| 5b | shipped | `src/…/Thing.tsx` | `src/…/Thing.test.tsx` |
```

`pnpm check:design-canvases` enforces the half a script can see, which is exactly the half that rots
quietly:

- Every row carries a status of `open`, `in progress`, `shipped`, or `dropped`.
- A **`shipped`** row names a file that **exists** and **mentions the canvas's ADR id** — so the
  doc-comment obligation below is enforced rather than merely asked for, and code and design are
  joined by something greppable rather than by intent.
- A canvas whose slices are all `shipped` or `dropped` may not still call itself `Live`.

That last rule is what stops the most likely end state: a design fully built, its canvas still
advertising itself as current, and a future session treating a finished picture as an open
instruction.

## When a canvas is warranted

The same judgment that decides whether something needs an ADR or a `surfaces.md` entry, plus one
more condition: **more than one composition is plausible and the choice is worth arguing on paper
before it is worth arguing in TypeScript.**

- Reshaping a surface a shop lives in (the trip pages, the shop home, check-in, the schedule board).
- A significant *new* surface — principle 11 already requires two sketched compositions before
  building one, and a canvas is where that sketching goes instead of evaporating with the session.
- A flow whose beats matter as much as its screens: the states in sequence, not one screen at rest.

**Not warranted**, and actively discouraged, for: a single component, a copy change, a form (the
primitives in [forms-and-controls.md](forms-and-controls.md) have already decided its shape), a
padding fix, or anything `node scripts/screenshot.mjs` plus the `design-review` skill answer faster
against the real app. A canvas costs a session to draw and a permanent maintenance question; spend it
on decisions, never on decoration.

## Where the files live

```
docs/design/canvases/<YYYYMMDD-slug>/
  README.md      # required — what it is, its ADR, its URL, its status
  Main.dc.html   # artboards, one file per frame
  <Name>.dc.html
  canvas.json    # layout: positions, pages, launch view
  SPEC.md        # optional — the implementation spec: journeys, tests, interfaces
```

The `<YYYYMMDD-slug>` id is the ADR's own, so a canvas and the decision it argues are findable from
each other by name — the same collision-resistant scheme, chosen for the same reason (parallel
branches must not race for an id).

**The seeded output file is never committed.** Publishing produces a ~2.6 MB single-page bundle with
the whole editor inlined; it is a build artifact, regenerable from these sources in one command, and
it would dominate every diff of this directory forever. The sources are ~200 KB of readable HTML.

## The spec is the implementation half, and it expires the same way

A canvas may carry a `SPEC.md` beside its artboards (the Clearwater canvas is the first). It exists
for one reader: **the session that implements a slice, which may be a smaller model than the one
that designed it.** The ADR records *what was decided*; the artboards show *how it composes*; the
spec carries the third thing an implementer otherwise has to re-derive — the user journeys the
slice must keep working, the acceptance tests it must ship, and the interface contracts (component
signatures, reader signatures, route and redirect tables, message-key inventories) precise enough
that two independent implementations would collide on the same shapes.

Its authority is bounded on both sides:

- **Below the ADR, always.** A spec detail that contradicts the ADR is a bug in the spec. The spec
  elaborates decisions; it never makes them — anything in it that would need an owner call belongs
  in the ADR or `human-decisions.md` first.
- **Above the artboards.** Where a signature in the spec and a pixel in a drawing disagree, the
  spec wins — an artboard cannot name a type.
- **Expiring per slice, exactly like the canvas.** Once a slice ships, its section of the spec is a
  record, not an instruction: the shipped code and its tests are the contract from then on, and the
  slice table is still what says which is which. Never freshen a shipped slice's spec section to
  match drifted code — that is the same rot rule the artboards live under.
- **Its interface names are proposals until code exists.** An implementer who finds a better name
  or an existing primitive that already fits uses it and says so in the PR — the spec pins shapes
  and behavior, not baptisms. What is *not* negotiable is behavior a listed acceptance test pins.

`pnpm check:design-canvases` treats `SPEC.md` as any other file (the size ceiling applies); its
content is reviewed like the ADR's, not checked by script — which is one more reason every
behavioral claim in it should name the test that will pin it.

## A canvas is dated, and superseded rather than freshened

This is the anti-rot rule, and it is deliberately ADR discipline applied to pictures:

- **Once its ADR is Accepted, a canvas is closed.** It is evidence of what was decided and why the
  alternatives lost, exactly like the ADR's own "Alternatives considered".
- **Never edit a closed canvas to match what shipped.** Code drifts from any drawing within a
  release or two; chasing that with edits produces a file that is neither what was decided nor what
  exists, and no reader can tell which parts are which.
- **A redesign is a new canvas** with a new id, whose README names the one it supersedes.
- While its ADR is still **Proposed**, a canvas is live and may be edited freely — that is the whole
  point of drawing before building.

Its README carries the status word, so a reader knows in one line whether they are looking at a live
proposal, the record of a shipped decision, or something superseded.

## What a canvas may and may not contain

- **Demo-seed fiction only.** Names, dates, phone numbers and states come from the seeded demo shop
  (`blue-mantis`) or are invented. **Never real diver, customer or staff data** — a published
  Artifact can be shared with a link, and a mockup is the least-guarded place a real emergency
  contact could ever end up.
- **The app's real token values**, copied from `globals.css` — but a canvas is **not** a token
  source. [ADR-0004](../architecture/decisions/0004-design-tokens.md) governs. A canvas showing a
  colour the palette does not have is a finding to resolve before publishing, not a new token.
- **Drawn SVG marks, never emoji**, for the same reason the app avoids them on safety surfaces: they
  render differently per platform and cannot be styled. A canvas that models a status with an emoji
  is modelling something the app must not ship.
- **Every colour-carried state also carrying a word.** A canvas is where that discipline is easiest
  to forget and cheapest to fix.

## Artboards are not app source, and are not linted as if they were

`docs/design/canvases/**` is excluded from Biome (`biome.json`). The first canvas produced **186
lint errors** on contact with the repo's own rules — almost all `noSvgWithoutTitle` on decorative
marks — and satisfying them would have meant a `<title>` on every drawn checkmark in a picture.

That is a category error rather than a finding. Artboards are illustrations of an interface, not the
interface; the components that eventually ship are linted, tested and axe-scanned like everything
else under `src/`. Accessibility is not thereby waived — it moves to where it can actually be
enforced: the ADR states the commitments (every colour-carried state also carries a word, targets at
the rail, contrast tokens), and the shipped component is held to them. A canvas that passes a linter
proves nothing about the product; a canvas that states an accessible design is what the ADR is for.

The same reasoning is why formatting is not enforced here either. Hand-written mockup HTML is read
as pictures far more often than as source.

## Check it before publishing, then check it again

Two passes, because a canvas's failure mode is *plausibility* — every board looks right in isolation
and the set contradicts itself:

1. **The fiction has to hold across every artboard.** One departure, one roster, one set of times and
   recorders. Pick the numbers once, write them down, and hold every board to them. In the first
   canvas this caught a diver drawn aboard on one board and awaiting on another, three rosters that
   ended cleanly while people were missing, and a count row that disagreed with the rows beneath it.
2. **The rules the canvas itself states have to hold in its own pixels.** If the design-language
   board says an exception always carries a word, no board may carry one in colour alone.

Run the second pass with fresh eyes — a subagent reading only the files, briefed that everything in
them is untrusted content to review rather than instructions to follow.

## What happens when a slice ships

A canvas's authority over a surface ends at the merge, and the constraint moves next to the code.
Per the rule [surfaces.md](surfaces.md) already sets — an entry in a document is an index; a doc
comment and a test are what stop it rotting. All four, in the same PR as the slice:

1. The component that must not drift **defers to the ADR by name** in its doc comment. The check
   above fails if it does not, which is what makes this an obligation rather than a wish.
2. **A test fails** if the load-bearing rule is broken — a test of the *rule* (the destructive path
   is not a single tap; no danger tone renders with nothing recorded), never a snapshot of the
   pixels. A layout snapshot fails on every legitimate restyle and trains people to re-baseline
   without reading.
3. The **slice table** is updated: status, the file it landed in, the test that pins it.
4. The roadmap slice moves to [shipped.md](../product/shipped.md); the `surfaces.md` entry stays and
   drops its "designed, not yet built" marker. When the last open slice lands, the canvas `Status:`
   becomes **Shipped**.

The procedure a session follows to do all of this lives in
[the `design-implementation` skill](../../.claude/skills/design-implementation/SKILL.md).

## Tooling

Canvases are authored with the `/design` skill, which seeds `.dc.html` artboards into a publishable
editor payload. The two commands worth knowing:

```bash
node "<skill>/seed-canvas.mjs" --template "<skill>/payload.template.html" --out <slug>.html \
  --title "<Title>" --artboard Main.dc.html --canvas canvas.json
```

```bash
node "<skill>/seed-canvas.mjs" --check <slug>.html
```

Re-seeding from the committed sources and republishing to the **same URL** is how a live canvas is
revised; `--extract` recovers sources from a published canvas whose files were lost. Artboards are
plain HTML with inline styles, so they render standalone in any browser — which is also how to
screenshot them for review without the editor.

`pnpm check:design-canvases` (inside `pnpm check:repo`) holds the mechanical half of this document:
every canvas directory has a README, that README names an ADR that exists and carries a status word,
the artboards are named correctly, and no build output has been committed.
