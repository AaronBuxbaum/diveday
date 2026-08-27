---
name: design-implementation
description: Build a surface from a design canvas — the read order that keeps a drawing from overriding shipped code, and the obligations that close the loop when a slice lands. Use when implementing any slice of a design recorded in docs/design/canvases/, or whenever a canvas and the code disagree.
---

# Building from a design canvas

A canvas is a set of pictures drawn **before** the code, published as an Artifact and committed as
artboard sources under `docs/design/canvases/<YYYYMMDD-slug>/`. The conventions are
[docs/design/design-artifacts.md](../../../docs/design/design-artifacts.md); this skill is the
half you need while turning one into TypeScript.

**The one fact that shapes everything below: nobody but an agent ever reads these files.** No
human is squinting at the mockup thinking "that looks out of date". A stale drawing gets rebuilt
faithfully unless the procedure stops it — so the procedure, not judgment, is what stops it.

## Read in this order. It is not a suggestion.

1. **The ADR.** Normative. It carries the decisions; the pictures only argue for them. Everything
   you must not get wrong is in words there.
2. **The roadmap slice** in [docs/product/features/roadmap.md](../../../docs/product/features/roadmap.md)
   — what this slice is, what it depends on, and whether an owner call still blocks it.
3. **The canvas README's slice table** — which slices already shipped, and where they landed.
4. **The code as it exists now**, for every surface the slice touches.
5. **The artboards, last**, and only for the slice you are building.

Reading the pictures first is how a session ends up re-implementing a surface that already
shipped, or "restoring" something a later decision deliberately removed.

## Authority expires per slice, not per canvas

> A canvas has authority over a surface **only while that surface's slice is unbuilt.** The moment
> a slice ships, the shipped code *is* the design for that surface and the canvas has nothing more
> to say about it.

So when a canvas and the code disagree:

- **The slice is still open** → the canvas is the intent. Build it.
- **The slice already shipped** → you have found a **stale canvas**, not a bug in the code. Do not
  "fix" the code toward the picture. If the shipped behaviour is genuinely wrong, that is a new
  decision and it needs a new ADR (or an amendment), never a silent edit toward an old drawing.
- **The ADR and the code disagree** → that is real, and it is one of two things: an unshipped slice,
  or drift worth fixing. Say which in the PR.

The same rule in one line for a hurry: **shipped code outranks the canvas; the ADR outranks both.**

## Do not edit the canvas to match what you built

The artboards are the record of what was decided, like an ADR's "Alternatives considered". Editing
them to match shipped code produces a file that is neither the decision nor the product, and
nothing downstream can tell which parts are which. A genuine redesign is a **new** canvas with a
new id whose README names the one it supersedes.

The one thing you *do* edit is the README's **slice table** — see below.

## When your slice lands, close the loop

These are the obligations that keep the design and the code in sync as the product moves. All four,
in the same PR as the slice:

1. **The component that must not drift names the ADR in its doc comment.** Not "see the design" —
   the ADR's id, so the next reader can find the reasoning. `pnpm check:design-canvases` fails if a
   slice is marked shipped and the file it names does not mention its ADR.
2. **A test pins the rule, not the pixels.** Test the invariant the ADR states ("the destructive
   path is never a single tap", "no danger tone renders with nothing recorded"), never a screenshot
   of the layout. A pixel snapshot fails on every legitimate restyle and teaches people to
   re-baseline without reading.
3. **Update the canvas README's slice table** — status, the file it landed in, the test that pins
   it. When the last open slice lands, flip the canvas `Status:` to `Shipped`.
4. **Move the roadmap slice to [shipped.md](../../../docs/product/shipped.md)**; the `surfaces.md`
   entry stays and drops its "designed, not yet built" marker.

## Verifying a design slice

The canvas is not the check. Build it, then look at the real thing:

- `node scripts/screenshot.mjs <path…>` against a running `pnpm dev` — light and dark, phone and
  desktop.
- The **design-review** skill for the principles pass, and **verify** before commit.
- **e2e-and-visual** for the flow spec and the visual capture; **visual-triage** for the diffs a new
  surface necessarily produces. Expect them, explain them in the PR — a redesign that moves pixels
  and reports none captured nothing.
- Safety surfaces (manifest, roll call, cert gating, medical flags) get the `dive-domain-expert`
  review the hard rules already require, and the design's own safety decisions get named in the
  request.

## What a canvas never licenses

Bespoke composition never exempts a slice from the mechanics. Semantic tokens only, the
form/button/card primitives, `<Field>`/`buttonClass()`/`SectionCard`, copy from a message bundle in
every locale, the clock, the timezone, the loading skeleton, `instant = true`. If an artboard shows
a colour the palette does not have or a control the primitives do not offer, the artboard is wrong —
raise it rather than hand-rolling a class string to match a picture.
