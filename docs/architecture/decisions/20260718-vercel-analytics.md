# 20260718-vercel-analytics — Use Vercel Analytics for app-wide page views

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The app is hosted on Vercel and needs a lightweight way to understand which public and staff
surfaces are being used. The first analytics slice should not add database tables, custom event
plumbing, or a second external service. It must also be initialized consistently for every route.

## Decision

Use `@vercel/analytics` and render its `Analytics` component from `src/app/layout.tsx`, the root
App Router layout. Vercel owns collection and reporting; DiveDay does not store analytics data or
send customer-facing operational records to the analytics service.

## Alternatives considered

- **Build an in-house event pipeline** — adds storage, retention, privacy, and reporting work before usage patterns are known.
- **Use another analytics vendor** — introduces a separate service and account despite Vercel already hosting the app.
- **Add route-specific instrumentation** — risks incomplete coverage and duplicates setup across layouts.

## Consequences

Every route gets the same automatic page-view instrumentation with one small client integration,
while product data remains in DiveDay's database. This adds a vendor runtime dependency and makes
usage reporting dependent on Vercel Analytics availability and policy. Revisit if the product needs
custom operational events, self-hosted retention, or a different privacy boundary; migration would
mean replacing the root component and removing the package after any required data export.
