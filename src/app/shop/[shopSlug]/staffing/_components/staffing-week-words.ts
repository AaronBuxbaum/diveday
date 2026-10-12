import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The staffing week's words, resolved on the server and handed to
 * `StaffingWeek` as plain data. Out of the route file so the page stays a
 * page (`scripts/check-page-length.mjs`).
 */
export function staffingWeekWords(t: StaffTranslator) {
  return {
    ariaLabel: t("staffing.week.ariaLabel"),
    previous: t("staffing.week.previous"),
    next: t("staffing.week.next"),
    thisWeek: t("staffing.week.thisWeek"),
    today: t("staffing.week.today"),
    print: t("print.sheet.door"),
    person: t("staffing.week.person"),
    needsCrew: t("staffing.week.needsCrew"),
    assign: t("staffing.week.assign"),
    // **`t.raw`, not `t`** — both of these name an argument that only
    // `StaffingWeek` can supply (the departure's title, the person and
    // the day), so they cross as templates and `fill()` completes them
    // on the client. `t()` would try to *format* them here, with the
    // argument by definition absent (src/i18n/fill.ts).
    assignAria: t.raw("staffing.week.assignAria"),
    crewing: t("staffing.week.crewing"),
    remove: t("staffing.working.remove"),
    removing: t("staffing.working.removing"),
    shiftAria: t.raw("staffing.week.shiftAria"),
    empty: t("staffing.week.empty"),
    away: t("staffing.week.away"),
    awayConflict: t.raw("staffing.week.awayConflict"),
    crewClash: t.raw("staffing.week.crewClash"),
    request: t("staffing.week.request"),
    requestAria: t.raw("staffing.week.requestAria"),
    requesting: t("staffing.week.requesting"),
    requested: t.raw("staffing.week.requested"),
    approve: t("staffing.week.approve"),
    decline: t("staffing.week.decline"),
    deciding: t("staffing.week.deciding"),
    requestApproved: t("staffing.week.requestApproved"),
    requestDeclined: t("staffing.week.requestDeclined"),
    askWontClose: t("staffing.week.askWontClose"),
    requestWontClose: t("staffing.week.requestWontClose"),
    ratingLapsed: t("staffing.week.ratingLapsed"),
  };
}
