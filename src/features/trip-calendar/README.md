# trip-calendar

This module owns the trip calendar use case and publishes its contract through `index.ts`.

## Owns

- `rules.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads retain their existing tenant and authorization checks.

- Charter downloads retain the shop's dock-call offset and departure wording.
- Course downloads use each recorded meeting window, without a dock-call offset. With no meeting rows, only the recorded session window is exported; catalog clock times never invent dated meetings.
- Course day titles and activities accompany meetings only when the complete numbered plan matches. Depth placeholders are resolved before rendering.
- Course locations come only from the explicitly recorded trip meeting point. Meeting rows have no location field; a dive site is not a substitute classroom, pool or dock.
- Day one keeps the trip download's UID; subsequent days use their logical day number, so rescheduling does not change identity. All events carry the trip revision.
