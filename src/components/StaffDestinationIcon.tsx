// i18n-exempt-file: pure SVG artwork — every node is aria-hidden path data,
// no words; the accessible name comes from the destination-label record the
// rendering surface resolves from the staff bundle.
import type { ReactNode } from "react";
import { DiveDayGlyph, trimmedViewBox } from "@/components/DiveDayIcon";
import type { StaffDestinationId } from "@/lib/staff-destinations";

/**
 * One stroke icon per staff destination, for the surfaces that show the
 * destination as an icon-first control (the phone dock in StaffTabBar). Drawn
 * on a 24px grid with a shared weight so the set reads as one family, and
 * always `aria-hidden`: the destination's label (the same record the header
 * tabs and the palette read) is the accessible name, never the picture.
 *
 * **Every destination a staffer can reach has artwork, and `tsc` keeps it
 * that way.** The map started as the five `primary` tabs the dock draws, and
 * grew to every destination once the command palette drew the same rail down
 * all of its rows (issue #773), where a partial set is worse than none. It was
 * still typed partial, with a neutral dot promised for a destination added
 * without artwork, and that dot could never render: `DiveDayIcon` tested
 * `name in ICON_PATHS`, found nothing, and fell through to the shared marks, so
 * "Took a call" shipped as the palette's one blank rail (pixel-craft K-275).
 * A full record makes a destination without a picture a type error instead.
 */
const ICON_PATHS: Record<StaffDestinationId, ReactNode> = {
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
  // Money in: a receipt.
  orders: (
    <>
      <path d="M5 3h14v18l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
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
  // Lost and found: a tagged item — a luggage tag on its string.
  lostFound: (
    <>
      <path d="M20 12.6 12.6 20a2 2 0 0 1-2.8 0L4 14.2a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7.8a2 2 0 0 1 1.4.6L20 9.8a2 2 0 0 1 0 2.8Z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  certifications: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 8h6M7 12h3m5 0 2 2 3-4" />
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
  // Boats: a hull on the waterline, mast and sail.
  boats: (
    <>
      <path d="M3 17h18l-2.5 4h-13L3 17Z" />
      <path d="M12 3v14" />
      <path d="M12 4c3 2 5 6 5 11h-5" />
    </>
  ),
  // Trip tags: the same eyelet tag the discount codes draw, turned over.
  tripTags: (
    <>
      <path d="M3 12V4h8l10 10-8 8L3 12Z" />
      <circle cx="7.5" cy="8.5" r="1.25" />
    </>
  ),
  // The pre-departure checklist: a clipboard with ticked lines.
  safetyChecklist: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2.5h6V4" />
      <path d="m8.5 11 1.5 1.5 3-3" />
      <path d="M8.5 17h7" />
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
  // Work orders: a wrench on the bench.
  workOrders: (
    <>
      <path d="M14.5 6.5a3.5 3.5 0 0 0 4.6 4.6l-8 8a2.1 2.1 0 1 1-3-3l8-8a3.5 3.5 0 0 0-1.6-1.6Z" />
      <path d="M15.5 3.2a4.8 4.8 0 0 1 5.3 5.3" />
    </>
  ),
  // The same wrench, with the plus every "new" door carries.
  newWorkOrder: (
    <>
      <path d="M12.5 8.5a3.5 3.5 0 0 0 4.6 4.6l-6 6a2.1 2.1 0 1 1-3-3l6-6a3.5 3.5 0 0 0-1.6-1.6Z" />
      <path d="M18 3v5" />
      <path d="M15.5 5.5h5" />
    </>
  ),
  // Rent out: the same cylinder, handed across the counter — an arrow away.
  rentOut: (
    <>
      <rect x="3" y="6" width="8" height="15" rx="3" />
      <path d="M5.5 6V3.5h3V6" />
      <path d="M3 11h8" />
      <path d="M14 14h7" />
      <path d="m18 11 3 3-3 3" />
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
  // Messages: what a diver wrote back — a speech bubble.
  inbox: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      <path d="M8 9.5h8" />
      <path d="M8 12.5h5" />
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
  // Safety: the month's safety record — a shield.
  safety: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </>
  ),
  // Drills: a whistle, for the practice a crew runs before it is needed.
  drills: (
    <>
      <circle cx="9" cy="14.5" r="5" />
      <path d="M13.2 11.6 21 8.5v4.2l-4.3 1.3" />
      <path d="M9 12.2v2.6" />
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
  // Email settings: an envelope.
  emailSettings: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  // The login's own security: a padlock.
  security: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  // The activity log: a clock face, for "who did what, when".
  activity: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

/**
 * A destination glyph's ink across its box, for the ones a caller may draw
 * `trim`med; `TRIM_X` in `DiveDayIcon.tsx` says why, and holds the shared
 * marks' entries.
 */
const STAFF_TRIM_X = {
  // The pin's teardrop: its arc and both curves reach x 5 and x 19.
  diveSites: [5, 19],
} as const satisfies Partial<Record<StaffDestinationId, readonly [number, number]>>;

type TrimmableDestination = keyof typeof STAFF_TRIM_X;

/** A staff destination's drawing, in the family `DiveDayGlyph` draws. */
export function StaffDestinationIcon<I extends StaffDestinationId>({
  id,
  className = "size-6",
  strokeWidth = 1.8,
  trim,
}: {
  id: I;
  className?: string;
  strokeWidth?: number;
  /** Crop to the ink across, as `DiveDayIcon`'s `trim`; only on a measured glyph. */
  trim?: [I] extends [TrimmableDestination] ? boolean : never;
}) {
  return (
    <DiveDayGlyph
      viewBox={
        trim && id in STAFF_TRIM_X
          ? trimmedViewBox(STAFF_TRIM_X[id as TrimmableDestination], strokeWidth)
          : undefined
      }
      stroke={strokeWidth}
      className={className}
    >
      {ICON_PATHS[id]}
    </DiveDayGlyph>
  );
}
