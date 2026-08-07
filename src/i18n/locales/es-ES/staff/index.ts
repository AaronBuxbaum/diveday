// The staff message bundle for es-ES, one namespace per file.
//
// Split from a single staff.json because that file was the repo's top merge
// conflict magnet: every parallel branch adds staff copy, and one 3,500-line
// file put every addition in one another's way — the same reason seed.ts
// became per-scenario modules (ADR 20260807-per-area-staff-bundles). A new
// namespace is a new <namespace>.json here plus one import line; new keys in
// an existing area touch only that area's file.
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
import orderLine from "./orderLine.json";
import orders from "./orders.json";
import promos from "./promos.json";
import reports from "./reports.json";
import reviews from "./reviews.json";
import schedule from "./schedule.json";
import seatDiver from "./seatDiver.json";
import settings from "./settings.json";
import shared from "./shared.json";
import shopHome from "./shopHome.json";
import staffing from "./staffing.json";
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
  reviews,
  schedule,
  trips,
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
