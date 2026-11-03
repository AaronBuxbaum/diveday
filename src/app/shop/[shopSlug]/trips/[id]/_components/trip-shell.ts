import { staffPageClass } from "../../../_components/staff-page";

/**
 * **The one shell a departure is worked in**: the `<main>` of every trip
 * surface (`trips/[id]/layout.tsx`).
 *
 * On screen it is a staff page at `full` width (`_components/staff-page.ts`):
 * a departure is a surface a crew scans across, every tab of it. On paper it
 * drops the measure and keeps a gutter of its own, `print:px-10 print:py-8`:
 * `@page` owns the paper margin, but a print dialog set to "None" zeroes
 * that, and padding on the printed surface is content, so it survives. The
 * packets are sheets (issue #2745), at most the paper's width, so they print
 * inside this gutter without a second one.
 */
export const TRIP_SHELL_CLASS = staffPageClass("full", "print:max-w-none print:px-10 print:py-8");
