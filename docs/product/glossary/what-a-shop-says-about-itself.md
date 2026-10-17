# What a shop says about itself

- **Register** — a table of the shop's things that have identity: each row is `shop_id` plus a name
  plus `deleted_at`, and a departure, a diver or a booking points at it. Dive sites, gear, courses,
  waivers, boats, trip tags and the pre-departure checklist are registers. A register is edited
  whenever the world changes (a hull is bought, a site is added), lives at `/shop/<slug>/<noun>`
  beside dive sites and gear, and carries a permission of its own rather than borrowing Settings':
  `canManageBoats`, `canManageTripTags` and `canManageSafetyChecklist` (`src/lib/authz.ts`) are owner
  and manager today, the same people who held the Settings gate before the move. Delete is soft and
  worded Delete. Decided by Aaron on 2026-10-17 (issue #2659), who moved boats, trip tags and the
  safety checklist out of Settings; Team stays in Settings because it is a connection to people's
  accounts rather than a list a departure points at. Settings still links to each register as a door,
  so a staffer who thinks "where do I add a boat" finds it, but the page is not a settings page.
- **Setting** — a fact of the shop with no identity, set once and read everywhere: the time zone,
  the units, the address, the tax rate, the pass-through fee, whether tips are on. Settings holds
  settings and connections (Stripe, WhatsApp, the embed), never a list of the shop's things. The
  test for a new row: does a departure, a diver or a booking point at it by id? Yes is a register;
  no is a setting.
- **Conservation note** — a shop's own prose about its conservation practice at one dive site.
  The shop's words, in the shop's language, alongside the rest of the briefing — not a code and
  not a claim DiveDay renders on the shop's behalf.
- **Lens** — the shop's own word for a kind of day ("Easygoing reef", "After dark", "First time
  back in a while"), called a **trip tag** on every screen (the Trip tags register, beside dive sites), written once in `trip_lenses` and hung on a departure by `trips.lens_id`. It
  is **shop prose**, like a site briefing and unlike the marine-life catalog: DiveDay never translates it, and the whole value is that the schedule sounds like the
  shop rather than like every other shop. Shop prose is a decision rather than a default: the owner
  chose it on 2026-09-10 (issue #1392) over the fixed DiveDay taxonomy issue #1162's triage
  recommended, and the untranslated rail is the accepted cost. A diver filters the public schedule
  by one (`?lens=<slug>`, whose slug is derived on create and never rewritten, so a shared link
  survives a rename).
  **It is never a safety label and never an eligibility signal.** Nothing in
  `src/lib/trip-admission.ts` or `src/lib/readiness.ts` reads it, and it is deliberately kept
  structurally separate from the requirement markers it sits beside on a schedule row: "First time
  back in a while" next to a certification marker, in the same tint or weight, would read as a rule
  about who may board rather than as the shop describing its own morning (the trap issue #1162's
  triage names). One lens per departure — settled on 2026-09-10 (issue #1393), not a first cut, and
  the canvas's two-word row is a deviation that stays; none is the ordinary case and renders
  nothing at all (ADR
  [20260904-reef-all-the-way-down](../../architecture/decisions/20260904-reef-all-the-way-down.md),
  decision 2).
- **Crew public name** — the string a consenting staff member shows divers on the departures they
  crew (`people.crew_public_name`). Theirs to type, not derived: `full_name` is one free-text box
  a shop fills in, so taking its first whitespace token assumes the given name was typed first and
  publishes the **surname** for a row entered "Tanaka Keiko" or "Smith, John" — to an anonymous,
  indexed page, and not to the disclosure anybody agreed to. Defaulted to that first token so the
  ordinary case is still one tap, and paired with `crew_public_consent_at` by a check constraint
  in both directions: a consent with nothing to show would render an empty crew line, and a name
  left standing after a withdrawal would republish itself the moment anything set the stamp again.
- **Our year** — the shopfront panel at the foot of the public schedule that states the shop's year
  so far in counts: divers, boats out, and reefs or wrecks, with the range it covers. The same read
  as the Reports year card (`getShopYear`, which carries no money across its boundary), and the
  card's own sentence (`shopYear.card.*`). Opt-in: `shops.public_year_enabled` is the one optional
  feature that defaults off, switched under Settings → Website. Absent before a departure has
  sailed, and never inside the embed. Component in `src/app/s/[shopSlug]/_components/OurYear.tsx`.
- **Published desk hours** — the shop's **desk hours** printed in its public footer ("Desk open
  8:00 AM to 6:00 PM"), only once the shop has saved them (`shops.desk_hours_confirmed_at`, stamped
  by `setShopDeskHours`); the 08:00 to 18:00 default decides after-hours pings but is never printed
  as a promise. Beside it, when the shop has connected its own WhatsApp Business sender, "Message
  us on WhatsApp" links its printed number (`shopPublicWhatsAppNumber`, which selects that one
  column and nothing of the stored credential).
