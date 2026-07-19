# 20260719-shop-owner-workspace — Shop owner workspace navigation

- **Status:** Accepted for the current staff web app
- **Date:** 2026-07-19

## Context

The staff dashboard exposed every operational surface as a peer-level button: waivers, cards,
courses, dive sites, gear, nitrox, reports, orders, payments, and scheduling. Child pages then
provided inconsistent one-off links back to the shop. That made the product feel like a collection
of tools instead of one operating system for the shop.

## Decision

Use a persistent shop shell with three primary workspaces:

- **Today** — upcoming trips, delivery issues, and workspaces that need attention now.
- **Divers** — the person-first customer record and its cards, fit, history, and issued gear.
- **Schedule** — trips and course sessions as the operational spine.

Place the remaining tools in a grouped **More** menu:

- **Prepare:** waivers, gear room, nitrox.
- **Plan:** courses, dive sites, reports.
- **Business:** orders, payments, and schedule-trip creation.

The dashboard also presents four connected workspaces as explanatory cards: People, Plan, Prepare,
and Business. These are task-oriented handoffs, not a second navigation system.

## Alternatives considered

- **Keep every tool as a top-level tab** — rejected because the dashboard becomes a crowded tool
  launcher and the destinations have no visible workflow relationship.
- **Hide all secondary tools behind a single undifferentiated menu** — rejected because waivers,
  gear, and payment work need recognizable operational grouping.

## Consequences

The persistent header stays small enough to scan while every existing route remains discoverable.
The dashboard explains how tools connect, and operational pages can link directly to the relevant
diver record—for example, a trip roster name opens that diver's cards and rental context. Future
navigation changes should add a workflow handoff or replace a destination; they should not add
another peer-level tab by default.
