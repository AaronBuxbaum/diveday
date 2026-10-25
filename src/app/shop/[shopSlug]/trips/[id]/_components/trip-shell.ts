import { staffPageClass } from "../../../_components/staff-page";

/**
 * **The one shell a departure is worked and printed in**: the `<main>` of
 * every trip surface (`trips/[id]/layout.tsx`) and of the day's packet
 * (`/shop/<slug>/print`), which is not under that layout.
 *
 * On screen it is a staff page at `full` width (`_components/staff-page.ts`):
 * a departure is a surface a crew scans across, every tab of it. On paper it drops the measure and keeps a
 * gutter of its own, `print:px-10 print:py-8`: `@page` owns the paper margin,
 * but a print dialog set to "None" zeroes that, and padding on the printed
 * surface is content, so it survives (`globals.css`, the print block's note
 * on padding).
 *
 * The day packet rendered its bundle straight into the shop shell, with no
 * `<main>` and so no gutter: its ink started at x 1, the roll call's tone rule
 * on the paper's edge, where the trip packet's started at x 33 (pixel probe,
 * `day-packet-print`). `trip-shell.test.ts` holds every wearer to this class,
 * refuses a packet rendered outside a wearer, and refuses a packet that pads
 * itself, which would be a second gutter.
 */
export const TRIP_SHELL_CLASS = staffPageClass("full", "print:max-w-none print:px-10 print:py-8");
