import { staffPageClass } from "../../../_components/staff-page";

/**
 * **The one shell a departure is worked in**: the `<main>` of every trip
 * surface (`trips/[id]/layout.tsx`).
 *
 * On screen it is a staff page at `full` width (`_components/staff-page.ts`):
 * a departure is a surface a crew scans across, every tab of it. It knows
 * nothing of paper: the packets are sheets (issue #2745), and on paper a page
 * that holds a sheet drops its shell's measure and gutter (`globals.css`).
 */
export const TRIP_SHELL_CLASS = staffPageClass("full");
