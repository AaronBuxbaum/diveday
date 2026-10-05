# 20261005-crew-schedule-is-a-setting — Make the crew schedule a shop setting, off by default

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Every shop got the whole crew layer whether it planned crew in DiveDay or not: the Crew view of
Schedule (shifts, days away, crew asking for a departure, credentials, the public-name consent), a
"Crew: …" line under every departure on the week, the crew editor on every departure's Details tab,
and the nudges measured against the shop's divemaster target — `uncrewed_departure` and
`crew_below_target` on Today, "9 divers with no supervisor" on the trip page, a divemaster count in
the Requests planner. A two-person shop where the owner skippers every boat keeps no roster, so all
of it rendered as empty rows and standing warnings it had to learn to ignore. The owner asked for
the crew functionality to sit behind a configuration, because not every shop wants it (2026-10-05).

One part of the layer is not about rostering at all. A course session's in-water training ratio is
an agency safety cap, and `createBookingRecord` refuses seats from the instructors named on the
departure (`courseSeatCapacity`, `src/lib/course-ratios.ts`). Hiding that roster would leave a
teaching shop unable to enrol anyone.

## Decision

- `shops.crew_schedule_enabled`, boolean, **default false**. The canonical demo and every minted
  demo shop set it true, because they are where every crew surface is photographed and tested.
- The switch is a row in Settings → Team ("Crew schedule"), and the divemaster target moved into
  it from "Diving options": the target is only ever read while the switch is on.
- `src/lib/crew-schedule.ts` is the one place the rule lives. `shopCrewTarget(shop)` hands every
  reader of the target `null` when the switch is off, and `divemasterRatioGap` reads `null` as
  "never short" — so Today, the trip page and the planner cannot disagree.
  `departureShowsCrew(shop, trip)` decides whether a departure's page offers its crew editor.
- **Off** removes: the Crew tab (and `/staffing`, which redirects to the week), the palette's
  "Crew schedule" row, the week's crew line, the fun-dive crew editor (the Details row shows the
  boat alone), the divemaster-target and crew-language nudges, the shift badges and the
  "Manage shifts" door, and the planner's divemaster suggestion.
- **Off keeps**: a course session's crew editor and every agency-ratio signal
  (`instructor_missing`, the trip pulse's "Needs an instructor" and "Over student ratio"). With the
  target gone a course with nobody aboard reads as `instructor_missing` rather than
  `uncrewed_course`. Existing assignments stay on the manifest and roll call — the switch hides
  planning, never who is aboard.
- Turning it off deletes nothing. Shifts, days away, requests and assignments are all where they
  were when it comes back on.

## Alternatives considered

- **Opt in by presence, like the gear register** — show crew UI once a shift or assignment exists.
  Rejected: an assignment exists on every course session, so presence would switch the whole layer
  on for every teaching shop, and the seed's own fixtures would decide what a new shop sees.
- **Default on** — what every shop had before. Rejected: the shops that do not plan crew are the
  ones the noise hurts, and a new shop cannot tell an empty roster from a broken one.
- **Hide the course-session crew editor too** — the cleanest switch, and a teaching shop could not
  take an enrolment. Not a trade a setting about rosters gets to make.

## Consequences

A new shop opens on a week with no crew vocabulary in it, and a shop that wants rostering turns one
row on. Every new crew surface must ask `crewScheduleEnabled` (or take `shopCrewTarget`) rather
than assuming the layer is there; a surface that forgets shows crew UI to a shop that turned it off,
which is noisy rather than unsafe. Revisit if pilot shops split the layer differently — for example
wanting crew on departures without shifts — which would turn one boolean into two.
