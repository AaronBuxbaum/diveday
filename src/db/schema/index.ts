/**
 * The schema, one module per domain, re-exported here so `@/db/schema` and
 * `./schema` imports read the whole of it. This file is also what both drizzle
 * configs consume through the migration barrel. That barrel temporarily keeps
 * one retired physical column which the running app no longer selects.
 *
 * The domain spine. Multi-tenant from day one: every domain table carries
 * shop_id (ADR-0005, docs/architecture/overview.md). People get roles, not
 * types — a person can be staff and a diver (docs/product/glossary.md).
 */

export * from "./accounts";
export * from "./activity";
export * from "./assists";
export * from "./billing";
export * from "./bookings";
export * from "./certifications";
export * from "./core";
export * from "./course-forms";
export * from "./courses";
export * from "./crew";
export * from "./departure-desk";
export * from "./dive-day";
export * from "./dive-sites";
export * from "./erasure";
export * from "./funnel";
export * from "./gear";
export * from "./incidents";
export * from "./integrations";
export * from "./interests";
export * from "./notifications";
export * from "./offline-manifests";
export * from "./payments";
export * from "./retention";
export * from "./reviews";
export * from "./trips";
export * from "./waivers";
export * from "./website-setup";
export * from "./weekly-digest";
export * from "./work-order-follow-up";
export * from "./work-orders";
