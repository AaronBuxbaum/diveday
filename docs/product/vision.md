# Vision

**One place to run a dive shop — bookings, waivers, cert checks, gear, and boat manifests —
that is a genuine pleasure to use.**

## The problem

Dive shop software exists (EVE, DiveShop360, Bloowatch, spreadsheets + paper clipboards), but it
is uniformly utilitarian at best and hostile at worst: dated UIs, desktop-bound workflows, forms
that fight you. Shops tolerate it because the domain plumbing (agencies, waivers, manifests) is
annoying to rebuild. Nobody has won on experience.

## The bet

**Delight is the differentiator.** Feature parity on the five pillars is table stakes; we win by
being the product that staff *want* to open — fast, beautiful, forgiving, and usable on a wet
phone at the dock. See [design/principles.md](../design/principles.md) for what delight means
concretely here.

## The five pillars

1. **Bookings** — trips, courses, and charters; capacity-aware scheduling; a public booking flow
   a diver finishes in under a minute.
2. **Waivers** — templated releases signed before arrival, stored durably, attached to the
   person and the booking. No printer anywhere in the flow.
3. **Cert checks** — record divers' agency cards (PADI, SSI, NAUI, …), verify levels against a
   trip's requirements up front, so the dock stays drama-free.
4. **Gear** — rental *fit*: the sizes each diver takes from the shop, feeding trip prep and
   packing lists. (Item-level inventory, booking assignment, and service history were deliberately
   removed as a half-maintained duplicate; a lightweight who-has-what / service-due register may
   return — see [roadmap.md](roadmap.md).)
5. **Boat manifests** — who's aboard, who's certified for the sites, roll call before departure
   and after every dive. A safety document first, a UI second.

## Who it's for

- **Shop owner / manager** — configures the shop, watches the calendar and the money.
- **Front desk staff** — creates bookings, checks divers in, chases missing waivers/certs.
- **Instructor / divemaster** — sees their schedule, their students, their boat.
- **Boat captain / crew** — runs the manifest and roll call, often offline, always in sunlight.
- **The diver (customer)** — books, signs, uploads a cert. Never needs an account manual.

## Non-goals (for now)

- Not a dive-agency LMS (we track certs, we don't issue them).
- Not a general POS/retail system (gear *rental*, not merchandise sales).
- Not a dive-log social network.

## Success signal

Staff at a busy shop choose to run the whole day from it — unprompted — and a diver compliments
the booking flow. Retention over feature count.
