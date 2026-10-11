# What a shop says about itself

- **Conservation note** — a shop's own prose about its conservation practice at one dive site.
  The shop's words, in the shop's language, alongside the rest of the briefing — not a code and
  not a claim DiveDay renders on the shop's behalf.
- **Lens** — the shop's own word for a kind of day ("Easygoing reef", "After dark", "First time
  back in a while"), called a **trip tag** on every screen (Settings → Trip tags), written once in `trip_lenses` and hung on a departure by `trips.lens_id`. It
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
