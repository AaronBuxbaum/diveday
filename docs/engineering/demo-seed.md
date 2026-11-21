# The operating demo shop

Blue Mantis is a fictional Key Largo shop with a working day, future bookings and a trading history.
The full `history` shape backs a fresh canonical demo and a visitor's demo shop. Its dates move with
the application clock; the test and visual harnesses freeze that clock. It is not a copy of a real
shop, customer, credential or payment account.

| Surface | What a full shop contains |
| --- | --- |
| Today, schedule, departures and manifests | Two boats, staffed upcoming and sailed trips, recurring sailings, check-ins, paired buddies, roll calls, a weather cancellation and the desk's handoff. Historical departures carry their own dive sites, completed dives, crew counts and pre-departure checks. |
| Divers and releases | A varied current customer list, historical customers, some people who return for future boats, certifications and releases. Historical releases point to the wording available when they were signed; fictional historical crew counts do not invent credential snapshots. |
| Sites, logs, recaps and reviews | Local dive sites and field guides, recorded dives and sightings, photos, ratings, reviews, tips and addressed private feedback. Sightings belong to the site and trip where the crew logged them. |
| Gear, rentals and service | A sized rental fleet and enough cylinders for two boats, current service clocks, upcoming holds, returned equipment tied to sailed bookings and repair tickets. The deliberately unavailable sizes still match the fit notes on the prep list. |
| Training and requests | A course catalog, future sessions, inquiries, course forms, a completed course with certifications, date requests, wait lists and a sent reply. |
| Orders, reporting and the desk | Booking payments, invoices, a prepaid dive card, local counter receipts, tax, partial and full refunds, and collection lots. An order, its booking payment and any checkout are not counted as separate receipts for the same money. |
| Team, shop and communications | Staff and roles, shifts, credentials, boat and shop settings, checklists, drills, inbox conversations, review replies and a fictional backup history. |

Not every table should have a row. One-use authentication challenges, active provider credentials,
real outbound delivery queues, external integration syncs, disputes, incidents and erasure requests
are events that may legitimately be absent. A fictional shop should not invent live integrations,
send messages, manufacture an incident, or claim an old credential or boat-paper snapshot merely to
fill a screen. Tests can create a particular exceptional state through a named shop fact.

`lean` runs the everyday demo scenarios without the added historical sets and is the default database
fixture for most unit tests. `history` adds the operating history; both are cached as migrated PGlite
snapshots by the test harness. New scenarios belong in their own module in `src/db/seed/` and in the ordered
`THE_DAY` list in `src/db/seed/schedule.ts`. New history must keep foreign keys, capacity, dates,
financial sources, release versions and equipment fit consistent with the rest of the story.

The bootstrap seeds a database only when its demo shop is absent. Existing demo data does not change
on a server restart: the in-app demo reset rebuilds the reset-owned schedule using the current full
seed. This replaces demo schedule data, so it is not a migration for real shops. The local
`pnpm db:reset` command clears the local database and should be used only when its other data can be
lost.
