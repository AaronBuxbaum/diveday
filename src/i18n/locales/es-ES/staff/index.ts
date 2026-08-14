// The staff message bundle for es-ES, one namespace per file.
//
// Split from a single staff.json because that file was the repo's top merge
// conflict magnet: every parallel branch adds staff copy, and one 3,500-line
// file put every addition in one another's way — the same reason seed.ts
// became per-scenario modules (ADR 20260807-per-area-staff-bundles). A new
// namespace is a new <namespace>.json here plus one import line; new keys in
// an existing area touch only that area's file.
//
// **A namespace can also get too big to type.** next-intl derives the key union
// from the bundle's own shape, and past a certain size TypeScript stops
// resolving new keys in it — not with an error naming the cause, but by
// rejecting a key that is demonstrably in the JSON, at some call sites and not
// others. `trips` hit that at ~560 keys: keys added to it typechecked in a
// fresh file and failed inside `trips/[id]/_components/`. Splitting the series
// copy out into `tripSeries.json` fixed it with no other change. So the
// per-area rule above is not only about merge conflicts — if a `t()` call
// rejects a key you can see in the file, the namespace is full, and the fix is
// a new one rather than a cast.
//
// pnpm check:locale proves the file sets match across locales and that every
// file is imported here, so a stray or orphaned namespace cannot ship.

import backup from "./backup.json";
import blockers from "./blockers.json";
import blowout from "./blowout.json";
import bookings from "./bookings.json";
import calendar from "./calendar.json";
import checkIn from "./checkIn.json";
import closeout from "./closeout.json";
import courses from "./courses.json";
import divers from "./divers.json";
import diveSites from "./diveSites.json";
import feed from "./feed.json";
import incidentExport from "./incidentExport.json";
import manifest from "./manifest.json";
import orderLine from "./orderLine.json";
import orders from "./orders.json";
import promos from "./promos.json";
import reports from "./reports.json";
import requests from "./requests.json";
import reviews from "./reviews.json";
import schedule from "./schedule.json";
import seatDiver from "./seatDiver.json";
import settings from "./settings.json";
import shared from "./shared.json";
import shopHome from "./shopHome.json";
import staffing from "./staffing.json";
import tripSeries from "./tripSeries.json";
import trips from "./trips.json";
import waiversStaff from "./waiversStaff.json";
import whatsapp from "./whatsapp.json";

const staff = {
  calendar,
  staffing,
  feed,
  divers,
  courses,
  diveSites,
  orders,
  orderLine,
  promos,
  reports,
  requests,
  reviews,
  schedule,
  trips,
  tripSeries,
  manifest,
  settings,
  blockers,
  checkIn,
  closeout,
  waiversStaff,
  shopHome,
  shared,
  whatsapp,
  backup,
  bookings,
  seatDiver,
  blowout,
  incidentExport,
};

export default staff;
