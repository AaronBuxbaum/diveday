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
 * Only the `primary` nav group needs artwork today; the map is typed partial
 * so a palette-only destination doesn't demand an icon it never shows. A
 * destination promoted into the dock without artwork falls back to a neutral
 * dot rather than crashing — visible enough to notice, harmless to ship.
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
  // Money in: a receipt.
  orders: (
    <>
      <path d="M5 3h14v18l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
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
