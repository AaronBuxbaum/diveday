# public-site

What a stranger sees before signing in: the home page's diver door, the shop's public pick, the
staff profiles, crawler files and the operating company's facts.

## Owns

- `home-diver-door.ts`, `shop-pick.ts`, `public-staff-profiles/`, `company-identity.ts`.
- Crawlers and cards: `robots.ts`, `llms-txt.ts`, `og-rasterizer.ts`.
- The public route table's checks: `public-route-existence.ts`, `public-route-shape.ts`.

## Does not own

The pages (`src/app/(marketing)/`, `src/app/s/[shopSlug]/`), their copy (the marketing bundles,
`docs/product/marketing.md`'s claims policy) and the public paths (`src/lib/public-routes.ts`).

## Invariants

- The home hero's "Find your booking" line is hidden unless `HOME_DIVER_DOOR` is exactly `1`.
- A shop's pick is read back through the live, public, still-ahead scope, so one that sailed, went
  private or was deleted stops showing without a cleanup job; at most one of its two columns is set.
- `company-identity.ts` holds facts Aaron supplied (2026-11-11), never copy and never inferred; the
  founder's name signs `/about` and appears nowhere else.
