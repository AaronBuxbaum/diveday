// i18n-exempt-file: pure SVG artwork — every node is aria-hidden path data,
// no words; the accessible name comes from the destination-label record the
// rendering surface resolves from the staff bundle.
import type { StaffDestinationId } from "@/lib/staff-destinations";

/**
 * One stroke icon per staff destination, for the surfaces that show the
 * destination as an icon-first control (the phone dock in StaffTabBar). Drawn
 * on a 24px grid with a shared weight so the set reads as one family, and
 * always `aria-hidden`: the destination's label (the same record the header
 * tabs and the palette read) is the accessible name, never the picture.
 *
 * **Every destination a staffer can reach has artwork now.** The map started
 * as the five `primary` tabs the dock draws, and stayed that way until the
 * command palette began drawing the same rail down all twenty-one of its rows
 * (issue #773) — where a partial set is worse than none, because two thirds of
 * the list would have been the fallback dot. The map is still typed partial and
 * the fallback still stands: a destination added tomorrow renders a neutral dot
 * rather than crashing, which is visible enough to notice and harmless to ship.
 */
const ICON_PATHS: Partial<Record<StaffDestinationId, React.ReactNode>> = {
  // The day itself: a sun over the horizon line.
  today: (
    <>
      <circle cx="12" cy="13" r="4" />
      <path d="M12 5V3" />
      <path d="m5.6 6.6 1.4 1.4" />
      <path d="m18.4 6.6-1.4 1.4" />
      <path d="M3 13h2" />
      <path d="M19 13h2" />
      <path d="M4 19h16" />
    </>
  ),
  // The counter clipboard with the tick that clears someone to board.
  checkIn: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 13.5 2 2 4-4" />
    </>
  ),
  // People — the roster of divers themselves.
  divers: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
  // The schedule board: a calendar month.
  board: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 9.5h18" />
    </>
  ),
  // The signed-off day: a checklist closed after the boat is home.
  closeOut: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="m8 12 2.5 2.5L16 9" />
      <path d="M8 7h8" />
    </>
  ),
  // Money in: a receipt.
  orders: (
    <>
      <path d="M5 3h14v18l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </>
  ),
  // Not ready: a departure with something still open on it — a triangle of
  // attention over the day it belongs to.
  blockers: (
    <>
      <path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 10v4" />
      <path d="M12 17.5h.01" />
    </>
  ),
  // Add a booking: a seat taken on a boat — the plus that fills one.
  addBooking: (
    <>
      <circle cx="10" cy="7" r="4" />
      <path d="M14 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <path d="M18 8v8" />
      <path d="M14 12h8" />
    </>
  ),
  // Walk-in: someone through the door, at the counter.
  walkIn: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" />
      <path d="M2 21h20" />
      <path d="M11.5 12.5h.01" />
      <path d="M18 21v-6a2 2 0 0 1 2-2" />
    </>
  ),
  // Staffing: who is on which day — a person against a week.
  staffing: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3" />
      <rect x="13" y="12" width="9" height="9" rx="2" />
      <path d="M13 15.5h9" />
      <path d="M16 12v-1.5" />
    </>
  ),
  // Courses: teaching — an open book.
  courses: (
    <>
      <path d="M12 7v13" />
      <path d="M12 7a4 4 0 0 0-4-3H3v13h5a4 4 0 0 1 4 3" />
      <path d="M12 7a4 4 0 0 1 4-3h5v13h-5a4 4 0 0 0-4 3" />
    </>
  ),
  // Dive sites: a pin dropped on water.
  diveSites: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  // Gear: a cylinder standing with its valve.
  gear: (
    <>
      <rect x="8" y="6" width="8" height="15" rx="3" />
      <path d="M10.5 6V3.5h3V6" />
      <path d="M13.5 4.5H16" />
      <path d="M8 11h8" />
    </>
  ),
  // Waivers: a signed page.
  waivers: (
    <>
      <path d="M15 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6Z" />
      <path d="M14 2v4h5" />
      <path d="M8.5 16c1.5-2.5 2.5-2.5 3.5 0s2 2.5 3.5 0" />
    </>
  ),
  // Reviews: what a diver said afterwards — a star.
  reviews: (
    <>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9Z" />
    </>
  ),
  // Requests: a diver asking for a day that is not on the board.
  requests: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 9.5h18" />
      <path d="M10.5 13.5a1.6 1.6 0 1 1 2 1.5v1" />
      <path d="M12.5 18.5h.01" />
    </>
  ),
  // Reports: how the month went — bars.
  reports: (
    <>
      <path d="M3 21h18" />
      <rect x="5" y="12" width="4" height="6" rx="1" />
      <rect x="11" y="7" width="4" height="11" rx="1" />
      <rect x="17" y="9" width="4" height="9" rx="1" />
    </>
  ),
  // Team: the people who work here.
  team: (
    <>
      <circle cx="8" cy="9" r="3.2" />
      <circle cx="16.5" cy="10.5" r="2.5" />
      <path d="M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h2a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M15 15.5h1a4 4 0 0 1 4 4V20" />
    </>
  ),
  // Discount codes: a tag with its eyelet.
  promoCodes: (
    <>
      <path d="M3 11.7V4a1 1 0 0 1 1-1h7.7a2 2 0 0 1 1.4.6l7.3 7.3a2 2 0 0 1 0 2.8l-6.9 6.9a2 2 0 0 1-2.8 0L3.6 13.1a2 2 0 0 1-.6-1.4Z" />
      <path d="M7.5 7.5h.01" />
    </>
  ),
  // Calendar feed: a subscription — the broadcast arcs on a calendar.
  calendarFeed: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 9.5h18" />
      <path d="M7.5 18a2 2 0 0 1 2 2" />
      <path d="M7.5 14.5a5.5 5.5 0 0 1 5.5 5.5" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

export function StaffDestinationIcon({
  id,
  className = "size-6",
}: {
  id: StaffDestinationId;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICON_PATHS[id] ?? <circle cx="12" cy="12" r="4" />}
    </svg>
  );
}
