/**
 * The schema, one module per domain, re-exported here so `@/db/schema` and
 * `./schema` imports read the whole of it. This file is also what both drizzle
 * configs point at, so a table that is not re-exported here does not exist as far
 * as `pnpm db:generate` is concerned.
 *
 * The domain spine. Multi-tenant from day one: every domain table carries
 * shop_id (ADR-0005, docs/architecture/overview.md). People get roles, not
 * types — a person can be staff and a diver (docs/product/glossary.md).
 */

export * from "./accounts";
export * from "./activity";
export * from "./billing";
export * from "./bookings";
export * from "./certifications";
export * from "./core";
export * from "./courses";
export * from "./crew";
export * from "./dive-day";
export * from "./dive-sites";
export * from "./erasure";
export * from "./funnel";
export * from "./gear";
export * from "./integrations";
export * from "./notifications";
export * from "./payments";
export * from "./reviews";
export * from "./trips";
export * from "./waivers";
export * from "./weekly-digest";
export * from "./work-order-follow-up";
export * from "./work-orders";
