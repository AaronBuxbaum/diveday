import type { requireShopSurface } from "@/features/session";
import { getStaffingPage } from "@/features/staffing";
import { staffWeek } from "@/features/staffing-week";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { staffRoleLabels } from "@/i18n/staff-role-labels";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { resolveWeekStart } from "@/lib/week-board";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

type ShopSurface = Awaited<ReturnType<typeof requireShopSurface>>;

/**
 * **The crew week, read once for both of its faces**: the Crew screen
 * (`staffing/page.tsx`) and the rota sheet printed from it
 * (`staffing/print/page.tsx`, issue #2745). A sheet reads what its page reads,
 * so the paper on the noticeboard cannot drift from the week a manager just
 * reviewed.
 *
 * Returns `null` only when the week's own boundaries cannot be read as
 * shop-local midnights, which the caller answers with this week.
 */
export async function readStaffingWeek({
  db,
  shop,
  session,
  week: weekParam,
  t,
}: Pick<ShopSurface, "db" | "session" | "shop"> & {
  /** The raw `?week=` value. */
  week: string | undefined;
  t: StaffTranslator;
}) {
  // Through the clock, not `new Date()`, and through the *shop's* zone, not
  // the host's: this one value decides which week the page opens on, which
  // column is Today, and which days are already behind. A raw wall-clock read
  // here left the one staff surface that ignored DIVEDAY_CLOCK — the seeded
  // shifts sit at the frozen instant while the window opened on the real
  // today, which is both an unstable visual baseline and an e2e fixture that
  // drifts out from under itself. In production `nowDate()` is the native
  // call, unchanged.
  const now = nowDate();
  const today = calendarDateInTimezone(now, shop.timezone);
  // The same `?week=` grammar the schedule board pages by, over the same dates
  // (`src/lib/week-board.ts`; ADR 20260827-clearwater-surface-language,
  // decision 5). Total by construction: a malformed or missing value lands on
  // the week the shop is in rather than refusing the page.
  const weekStart = resolveWeekStart(weekParam, today);
  const weekEnd = shiftCalendarDate(weekStart, 6);
  // The week's boundaries are **shop-local midnights**, turned into instants
  // here. On a UTC server the naive reading starts the week four or five hours
  // early and drags the previous Sunday evening's shifts into it.
  const fromWall = parseWallTime(weekStart, "00:00");
  const toWall = parseWallTime(shiftCalendarDate(weekStart, 7), "00:00");
  if (!fromWall || !toWall) return null;
  // The grid, the away blocks of the week and the requests hanging off its gaps
  // (`getStaffingPage`).
  const {
    view,
    blocks,
    canManageStaffAccounts: canManage,
    crewRequests,
  } = await getStaffingPage(
    db,
    shop,
    {
      from: wallTimeToUtc(fromWall, shop.timezone),
      to: wallTimeToUtc(toWall, shop.timezone),
      firstDay: weekStart,
      lastDay: weekEnd,
    },
    session.user.personId,
  );

  const week = staffWeek({
    blocks,
    requests: crewRequests,
    // Who is reading. `isCrew` is deliberately every staff role: a captain
    // asking to run Saturday's boat is the ordinary case, and narrowing it to
    // instructors would rebuild the "only the owner writes here" shape this
    // slice exists to open (ADR 20260902-crew-requests-and-blackouts).
    // `holdsInstructorRole` off the signed claims rather than a live read: it
    // decides one advisory line and nothing else (#1339), and the write it
    // sits beside is gated where it always was.
    viewer: {
      personId: session.user.personId,
      isCrew: true,
      holdsInstructorRole: session.user.roles.includes("instructor"),
    },
    now,
    people: view.staff.map((member) => ({
      personId: member.person.id,
      name: member.person.fullName,
      roles: staffRoleLabels(t, member.roles),
      shifts: member.shifts.map((shift) => ({
        id: shift.id,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        note: shift.note,
      })),
      crewingTrips: member.crewingTrips,
    })),
    gaps: view.gapTrips,
    weekStart,
    timeZone: shop.timezone,
    today,
  });

  return { today, weekStart, weekEnd, view, blocks, canManage, week };
}
