# 20260806-dive-site-catalog-is-a-view — The dive-site catalog is a view of the library, not a route

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

`/shop/[shopSlug]/dive-sites/catalog` was a full page — its own header, its own paginated grid,
its own `loading.tsx` — reachable from exactly two places: the "Browse templates" button in the
library's header actions, and the identical button in the library's empty state. Nothing else ever
linked to it, and nothing on the catalog page did anything the library page could not host itself:
one query (`listGlobalDiveSiteTemplates`) over one shared `Pager` (`src/components/Pager.tsx`),
with one action (`importGlobalDiveSiteTemplate`) that redirects back into the library on success.

The doctrine this repeats is [20260803-not-ready-is-a-view](20260803-not-ready-is-a-view.md):
a destination that only exists to be reached from one other page — and adds a second header, a
second loading skeleton, and a second set of back-links to keep in step — is a *view* of that page,
not a peer route, whether or not it re-sorts the same underlying evidence. Not ready re-sorted
Today's own rows; the catalog renders DiveDay's own published templates instead of the shop's saved
sites, but the shape of the mistake is the same: two page shells maintained for one relationship
that a query parameter states more honestly.

## Decision

**The dive-site library takes a `?view=catalog` query param, and `dive-sites/page.tsx` renders
exactly one of two views: the shop's saved-site library (default), or DiveDay's published catalog.**

- `view=catalog` renders the same header/grid/pager shape the old route did — title, description,
  the "← Dive-site library" back-link, and the import action — but from inside the library's own
  `page.tsx`, as a sibling render path (`CatalogView`) rather than a separate file tree. It is not
  merged into the library's own list markup: the two answer different questions (the shop's sites
  vs. DiveDay's templates) and share nothing but the `<Pager>` component and the page's URL.
- The library's two "Browse templates" buttons (header actions, empty-state) now link to
  `?view=catalog` instead of `/dive-sites/catalog`.
- `/shop/[shopSlug]/dive-sites/catalog` becomes a **308** (`permanentRedirect`) to
  `?view=catalog`, carrying `?page=` across — the same shape as
  `src/app/shop/[shopSlug]/blockers/page.tsx`. Its `loading.tsx` is deleted; a redirect-only route
  never renders a fallback.
- No entry moves in `src/lib/staff-destinations.ts` — the catalog was never a registry destination
  (it had no nav tab, no palette entry, no shortcut), so there is nothing to demote to
  `navGroup: null`. The registry-preservation clause in 20260803-not-ready-is-a-view's decision
  applies only where a destination existed to preserve.
- Part of the same change: the two pages that render the site-briefing form
  (`dive-sites/new/page.tsx`, `dive-sites/[id]/page.tsx`) shared their nineteen fields
  field-for-field, ~170 duplicated lines apart only in whether each `<input>`/`<textarea>` carried a
  `defaultValue`. Both now render one `<SiteFields>` (`dive-sites/_components/SiteFields.tsx`),
  taking an optional `values` prop — absent for a blank briefing, a site row to prefill an edit —
  plus the two genuinely page-specific strings (the certification fieldset's lead-in sentence, and
  the edit-only "Required specialties" heading the new form never showed).

## Alternatives considered

- **Keep the route, only extract `<SiteFields>`.** Rejected: it leaves the two-buttons-to-one-page
  shape the ADR above already named as the smell, and a second `loading.tsx`/header/back-link to
  maintain for a screen with no other entry point.
- **Merge the catalog grid into the library's own site list (one `<ul>`, badges distinguishing
  "yours" from "DiveDay's").** Rejected: a shop's saved sites and DiveDay's unimported templates are
  not comparable rows — one is editable and gates trips today, the other is a briefing a shop has
  not yet made its own — and interleaving them would make "how many sites do I have" ambiguous on
  the page that answers it.
- **A client-side tab switch over one payload.** Rejected for the same reason 20260803 rejected it:
  it would fetch both shapes on every library visit and the URL would stop describing what is on
  screen.

## Consequences

One fewer route, one fewer `loading.tsx`, one fewer file to keep visually in step with the page it
was always a footnote of. `pnpm check:route-coverage` still lists
`/shop/[shopSlug]/dive-sites/catalog` because the redirect itself is a route worth covering, same
as `/shop/[shopSlug]/blockers`.

Visually, the `dive-sites-catalog` capture in `e2e/visual.spec.ts` keeps its name and still
navigates through the old URL, so the surface stays covered — but the baseline moves, because
`CatalogView` now renders as a branch of `dive-sites/page.tsx` rather than its own route.

The escape hatch: if the catalog grows a second entry point that is not the library (say, a
dive-site's own edit page starts recommending a specific template), that is the point to reconsider
— a genuine second door back to a route-shaped view is the case this decision is for.
