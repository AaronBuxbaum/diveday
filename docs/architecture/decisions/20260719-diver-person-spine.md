# 20260719-diver-person-spine — Person-first diver records

- **Status:** Accepted for the staff shop surface
- **Date:** 2026-07-19

## Context

The database already models `people` as the shared identity spine. Certification cards,
specialty cards, rental fit profiles, bookings, and gear assignments all reference a person. The
staff UI had drifted into a cards-first workflow: `/certifications` asked staff to choose a diver
from a form and then showed every card together in one list. That is the wrong starting point for a
returning diver, because the person—not a document—is the object staff are trying to help.

## Decision

The primary shop workflow is `/shop/[shopSlug]/divers`, followed by
`/shop/[shopSlug]/divers/[personId]`.

- The Divers index lists shop people with the diver role and provides a lightweight way to add a
  returning diver before their next booking.
- The person detail page is the home for contact details, level and specialty card capture/review,
  rental fit preferences, booking history, and currently issued gear.
- Existing source-of-truth tables remain unchanged. The page composes those records through a
  shop-scoped query service rather than introducing a duplicate customer entity.
- `/certifications` remains a protected redirect for old bookmarks. It no longer presents a
  cards-on-file inbox or a diver picker.
- Inventory, service holds, and packing remain on the Gear room because those are shop equipment
  workflows. A diver profile shows the person's fit and issued-gear context and links back to the
  inventory workflow when staff need to manage an item.

## Safety and tenancy

Every detail query and mutation scopes both `shop_id` and `person_id`; a valid UUID from another
shop cannot expose or mutate a diver. Card evidence still starts pending, and only explicit staff
verification feeds readiness. Rental fit remains planning input, never authorization to substitute
equipment or skip the dock-side fit check.

## Alternatives considered

- **Keep a cards-first certifications inbox** — rejected because staff usually need the whole
  returning-diver context, not an isolated document list.
- **Create a separate customer entity** — rejected because `people` already provides the shared
  identity spine and a duplicate would split bookings, staff roles, and operational history.

## Consequences

Returning-diver work becomes a single, recognizable path and leaves room for future person-level
features such as emergency contacts, consent history, payments, and communications. Certification
review is no longer a separate mental model, but old deep links continue to work through the
redirect while staff learn the new workflow.
