# Marketing page: SEO checklist

Part of the **marketing-page** skill ([SKILL.md](SKILL.md)). Read it for a new page or any metadata change.

## SEO checklist (for new pages or metadata changes)

- Read the bundled Next docs first (`node_modules/next/dist/docs/` — metadata conventions differ
  from training data).
- Page-level `metadata`: buyer-worded title, description, canonical, Open Graph + Twitter card.
- New public page → add to the sitemap; tokened/private pages stay `robots: noindex`.
- Structured data values read from `src/lib/marketing.ts`, never literals.
