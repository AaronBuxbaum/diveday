# 20260803-instant-opt-out-placement — Declare `instant = false` once per subtree, plus once per genuinely-blocking page segment

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

The 2026-08-02 review raised ARCH-7: "51 of 56 pages carry the identical `instant = false`
Cache-Components TODO — up from 46, because new pages inherit it." The TODO in question, repeated
verbatim in 39 files, read:

```
// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;
```

The obvious hypothesis was that `src/app/shop/[shopSlug]/layout.tsx`'s heavily-reasoned
`instant = false` already opts its whole subtree out, making every page-level declaration beneath
it dead code deletable in one tranche. That hypothesis is **half right**, and the half that is
wrong is what has made this look like unpayable debt. `instant` does two separable jobs, and they
resolve through the tree by different rules.

Read from the installed framework, not from memory —
`node_modules/next/dist/server/app-render/instant-validation/instant-config.js`:

**Job 1 — permitting a blocking prerender (the build-relevant one).** `isPageAllowedToBlock(tree)`
walks the loader tree from the root and **returns at the first segment carrying an explicit
`instant`**:

```js
if (instantConfig !== undefined) {
    if (instantConfig === false) return true;   // allowed to block
    else return false;
}
// otherwise recurse into parallelRoutes
```

Its result becomes `allowEmptyStaticShell`, which `throwIfDisallowedDynamic` and
`getStaticShellDisallowedDynamicReasons` (`dynamic-rendering.js`, whose own comment says
"`allowEmptyStaticShell` covers `instant = false` (user opt-in)") short-circuit on. It is called
once per render with the full root tree (`app-render.js:1622` passes `loaderTree` into
`prerenderToStream`, which computes it at line 4891). The bundled doc states the same rule:
"To opt a route out of this validation, ensure the highest `instant` config in the route's tree is
`false` — a `false` higher in the tree takes precedence over any deeper `true` for the static-shell
check" (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`).
So for job 1, **only the outermost declaration in a route is ever read**; every deeper one is dead.

**Job 2 — suppressing dev-time instant-navigation validation.** `anySegmentNeedsInstantValidation`
visits the *whole* tree and does not stop at a `false`. A `false` means "explicit opt-out, doesn't
itself trigger validation" for **that segment only**; a segment with no config falls through to
`applyDefaultValidation && isImplicitValidationSegment(tree[0])`, and `isImplicitValidationSegment`
matches only `__PAGE__` and `__DEFAULT__` keys. `applyDefaultValidation` is true here because
`next.config.ts` sets no `experimental.instantInsights`, and `config.js:1244` defaults
`validationLevel` to `'warning'` — "Every Page and Default segment is implicitly validated at
warning level (dev only)."

The consequence is the part the hypothesis missed: **deleting `instant = false` from a page segment
under a `false` layout does not change the build at all, but it flips that route from
"no instant validation" to "implicitly validated in dev"** — dev-overlay errors on ~40 staff pages
that block deliberately, plus `needsFullTree` (`app-render.js:348`) forcing every dev navigation to
re-render the shop layout's `auth()` and three DB queries instead of skipping the shared layout.
That is a real dev-experience regression bought for zero production benefit.

Layouts have no such second job: they are never `__PAGE__`/`__DEFAULT__` segments, so they are
never implicitly validated, so a layout's `instant = false` does *only* job 1.

## Decision

Two rules, applied by segment kind.

1. **A `layout.tsx` declares `instant = false` only when it is the outermost `instant` in the
   routes below it *and* it is actually covering something** — a subtree whose pages do not each
   declare their own, especially one that keeps gaining pages. `src/app/shop/[shopSlug]/layout.tsx`
   and `src/app/s/[shopSlug]/layout.tsx` qualify and stay. A layout already inside a `false`
   subtree, or a layout above a single leaf page that already declares `false`, is covering
   nothing: `isPageAllowedToBlock` returns at whichever it meets first and the result is byte-identical.
   Delete it and leave a one-line pointer here.

2. **A `page.tsx` that performs an unwrapped request-scoped read keeps `export const instant = false`,
   and this is not debt.** Under the default `validationLevel: 'warning'` it is the only way to keep
   that page segment out of dev-time instant validation. The comment above it must say that, not a
   TODO promising a refactor that would not change the build.

The genuine alternative to a page-level opt-out remains what
`/sign-in`, `/shop/[shopSlug]/trips/new`, `/shop/[shopSlug]/trips/[id]/guests`, and
`/shop/[shopSlug]/dive-sites/new` already do: wrap the request-scoped read in a real `<Suspense>`
boundary, which makes the route legitimately instant and removes the need for any declaration.
That is a per-page restructure with a real user-visible payoff (a static shell instead of a blocking
render), and it is gated by the safety-critical-surfaces rule in AGENTS.md — not a comment cleanup.

Applied on 2026-08-03: nine declarations deleted as provably unread (`src/app/shop/[shopSlug]/waivers/layout.tsx`,
`src/app/shop/[shopSlug]/trips/[id]/layout.tsx`, and the seven bearer-token layouts under
`invite/`, `ready/`, `recap/`, `reset-password/`, `unsubscribe/`, `verify/`, `waivers/`), and the
37 surviving page-level declarations had the inherited TODO replaced with what the line actually
does. Declarations fell 57 → 48; identical-TODO files fell 39 → 0.

## Alternatives considered

- **Delete every page-level `instant = false` under `/shop/[shopSlug]/` in one tranche** — the
  original hypothesis. Build-neutral and provably so, but it turns on implicit dev validation for
  ~40 deliberately-blocking staff routes: dev-overlay errors plus `needsFullTree` re-rendering the
  shop layout on every dev navigation. Rejected as a regression with no offsetting benefit.
- **Set `experimental.instantInsights.validationLevel: 'manual-warning'` and then delete all of
  them** — this would make the page-level declarations genuinely dead (only explicit configs get
  validated) and is a one-line config change. Rejected because no segment in this app sets
  `instant = true`, so it would switch instant validation off app-wide, including on the marketing
  and public shop pages where an accidental blocking read is exactly the bug worth catching. Worth
  revisiting only alongside opting those pages in explicitly.
- **In the bearer-token layout/page pairs, keep the layout's declaration and delete the page's** —
  symmetric for job 1, but the page's is the one doing double duty, so this trades a no-op for a
  dev regression. Rejected. The residual cost of the choice made: if a token route ever gains a
  second page, the declaration must move back up to the layout.
- **Leave the TODOs and record the rule only in this ADR** — rejected. New pages inherit the
  comment from a neighbouring page, not from `docs/`; the wrong text is the propagation mechanism.

## Consequences

Makes easy: deciding, mechanically and without re-litigating, whether a new page needs the
declaration (does it do an unwrapped request-scoped read? then yes, and it is not debt) and whether
a new layout does (is it the outermost, covering pages that lack their own? then yes, else no).

Makes hard: nothing that was previously easy. The remaining 46 page-level declarations are not
removable by deletion; each is removable only by giving that page a real `<Suspense>` boundary,
which is a separate, larger, individually-verified change.

Commits us to: the framework-default `validationLevel: 'warning'`. If that default changes — the
`instant.md` doc warns it "may change in future versions to opt users into higher levels of
validation," and `anySegmentNeedsInstantValidationInBuild` already exists for a build-level
`experimental-error` mode — rule 2's justification strengthens rather than weakens, but the blast
radius moves from the dev overlay to the build, and this ADR should be revisited with
`validationLevel` pinned explicitly in `next.config.ts`.

Revisit when: the app adopts `<Suspense>` boundaries broadly enough that a page-level declaration
becomes the exception, or when `instant` graduates from experimental and its resolution rules change.
Re-verify both rules against `instant-config.js` at that point — both were established by reading
the installed source, and neither is guaranteed across Next versions.

## Amendment, 2026-08-04 — the two `/shop/**` layout deletions are reverted

Rule 1 said a layout inside an already-`false` subtree is covering nothing, so
`shop/[shopSlug]/trips/[id]/layout.tsx` and `shop/[shopSlug]/waivers/layout.tsx` had theirs
deleted. The reading behind that — `isPageAllowedToBlock` walks from the root and returns at the
first explicit config — was taken from the installed `instant-config.js`, not from prose, and
`next build` raised nothing.

It is reverted anyway. Across two CI runs after the deletion, three Playwright specs went
intermittently red that had never failed locally: `staffing.spec.ts` waiting on a "Shift removed."
banner that never appeared, `trip-admission.spec.ts` hitting a strict-mode violation because the
*same* `?notice=` banner resolved to **two** DOM nodes, and `add-diver.spec.ts` on a third banner.
Two of the three run on `trips/[id]/guests` — under one of the two layouts changed here — and all
three fail in hydration-shaped ways rather than by timing out on a slow query.

That is not proof. It was never reproduced locally (15 runs of one spec, a full local suite, a
local production build) and the causal chain from a route-segment config to a duplicated DOM node
is not one this ADR can currently explain. But the argument for the deletion was only ever "this
line is provably unread", and the value of removing it is one line per layout. Weighed against an
unexplained correlation with intermittently duplicated banners on auth-gated, safety-critical staff
surfaces, that is not a trade worth taking on the strength of a source reading.

What survives: the two-jobs analysis, rule 2, the seven bearer-token layout deletions (a different
subtree, not touched by any failing spec, and the routes the build was specifically checked
against), and the collapse of 39 duplicated TODO comments to zero — which was always the larger
part of ARCH-7.

Reopen this if someone can either reproduce the failures with the declarations restored — proving
them unrelated — or explain the mechanism. Until then the queue item stays open with the
page-level declarations intact, and ARCH-7 is narrower than it looked.
