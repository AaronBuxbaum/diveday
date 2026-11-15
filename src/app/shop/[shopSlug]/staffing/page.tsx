import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { buttonClass } from "@/components/ui/button";
import { ShopNotice } from "@/components/ui/outcome";
import { noticeRole } from "@/components/ui/tone";
import { WeekPager } from "@/components/ui/week-pager";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDateRange } from "@/lib/format";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { shiftWeek, WEEK_PARAM, weekStartOf } from "@/lib/week-board";
import { ScheduleViews } from "../schedule/_components/ScheduleViews";
import { CrewPageHeader } from "./_components/CrewPageHeader";
import { staffingGapWords } from "./_components/gap-words";
import { SchedulePicker } from "./_components/SchedulePicker";
import { StaffingMyWeek } from "./_components/StaffingMyWeek";
import { StaffingWarnings } from "./_components/StaffingWarnings";
import { StaffingWeek } from "./_components/StaffingWeek";
import { weekDayFaces } from "./_components/staffing-day-faces";
import { readStaffingWeek } from "./_components/staffing-week-read";
import { staffingWeekWords } from "./_components/staffing-week-words";
import { TimeOffApprovals } from "./_components/TimeOffApprovals";
import {
  createShiftAction,
  decideAwayAction,
  decideCrewRequestAction,
  deleteAwayAction,
  deleteShiftAction,
  requestCrewAction,
  saveAwayAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints immediately — this segment's
// `loading.tsx`, with no request read above it. Since the staff shell became synchronous (issue
// 1446) that holds for a cold, direct visit too: the shell's session, shop row and nav stream in
// beside the page from `ShopChrome` rather than above it, so the route gets a static shell and its
// own reads are the only ones the reader waits on. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Crew schedule — DiveDay" };

/**
 * A notice query param maps to a message key, never to a sentence — the words
 * come from the staff bundle at render time (docs ADR
 * 20260730-staff-copy-localization). Typing the value as `StaffMessageKey`
 * makes a stale key a compile error rather than a rendered key on screen.
 */
const notices: Record<string, { tone: "success" | "danger" | "warning"; key: StaffMessageKey }> = {
  "shift-saved": { tone: "success", key: "staffing.notice.shiftSaved" },
  "shift-deleted": { tone: "success", key: "staffing.notice.shiftDeleted" },
  overlap: { tone: "danger", key: "staffing.notice.overlap" },
  "staff-not-found": { tone: "danger", key: "staffing.notice.staffNotFound" },
  invalid: { tone: "danger", key: "staffing.notice.invalid" },
  "not-authorized": { tone: "danger", key: "staffing.notice.notAuthorized" },

  // The crew's own acts and the owner's answer (issue #1235). The refusal
  // codes are the domain layer's own, in its casing — `noticeUrl` normalises
  // them to the kebab spelling this map holds.
  "away-saved": { tone: "success", key: "staffing.notice.awaySaved" },
  "away-deleted": { tone: "success", key: "staffing.notice.awayDeleted" },
  "away-requested": { tone: "success", key: "staffing.notice.awayRequested" },
  "away-approved": { tone: "success", key: "staffing.notice.awayApproved" },
  "away-declined": { tone: "success", key: "staffing.notice.awayDeclined" },
  "request-sent": { tone: "success", key: "staffing.notice.requestSent" },
  "request-approved": { tone: "success", key: "staffing.notice.requestApproved" },
  // Loud on purpose: a shop that believes it has crewed a departure it has not
  // is the failure worth interrupting for.
  "request-approved-not-assigned": {
    tone: "warning",
    key: "staffing.notice.requestApprovedNotAssigned",
  },
  // Approved, assigned, and the session is *still* over an intro ratio (issue
  // #1339). Warning, not success: the plain success line read as a gap closed
  // to the one person who could close it, and the boat has not changed.
  "request-approved-ratio-open": {
    tone: "warning",
    key: "staffing.notice.requestApprovedRatioOpen",
  },
  "request-declined": { tone: "success", key: "staffing.notice.requestDeclined" },
  "not-allowed": { tone: "danger", key: "staffing.notice.notAllowed" },
  "person-not-found": { tone: "danger", key: "staffing.notice.personNotFound" },
  "trip-not-found": { tone: "danger", key: "staffing.notice.tripNotFound" },
  "request-not-found": { tone: "danger", key: "staffing.notice.requestNotFound" },
  "invalid-range": { tone: "danger", key: "staffing.notice.invalidRange" },
};

export default async function StaffingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    week?: string;
    day?: string;
    notice?: string;
    person?: string;
    view?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const query = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  // A shop that keeps no crew schedule has no Crew view: a bookmark lands on
  // the week of departures it was one tab away from.
  if (!shop.crewScheduleEnabled) redirect(shopPath(shopSlug, "schedule", "board"));
  // Negotiated from the request, falling back to the shop's default — a staff
  // member reads dates and copy in their own language, not the shop row's.
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const read = await readStaffingWeek({
    db,
    shop,
    session,
    week: query[WEEK_PARAM],
    person: query.person,
    t,
  });
  if (!read) redirect(shopPath(shopSlug, "staffing"));
  const plan = query.view === "plan";
  const {
    today,
    weekStart,
    weekEnd,
    view,
    blocks,
    pendingTimeOff,
    canManage,
    week,
    selectedPerson,
  } = read;
  const notice = noticeFromParam(query.notice, notices);
  const pageNotice = notice;

  const gapWords = staffingGapWords(t);

  const myBlocks = blocks.filter((block) => block.personId === session.user.personId);
  const myShifts =
    view.staff.find((member) => member.person.id === session.user.personId)?.shifts ?? [];
  const weekWords = staffingWeekWords(t, week);
  const selectedValue = selectedPerson === session.user.personId ? "me" : (selectedPerson ?? "all");
  const selectionQuery = `&person=${encodeURIComponent(selectedValue)}`;
  const staffingPath = shopPath(shopSlug, "staffing");
  // **Every act carries the week it was performed in.** The page grew a week
  // dimension and the actions did not, so building next week's roster — the
  // ordinary Sunday-evening job — meant being thrown back to this week after
  // every save, with the shift just added nowhere on screen and the add form's
  // date reset under it. Bound rather than a hidden field in six forms: the
  // week is the page's own reading of the URL, not something a submitter gets
  // to choose, and one binding cannot drift from another.
  const createShift = createShiftAction.bind(null, weekStart);
  const deleteShift = deleteShiftAction.bind(null, weekStart);
  // Crew requests and availability, plus the manager's
  // answer (issue #1235). Each carries the week so a save keeps the reader on
  // the roster they were editing.
  const requestCrew = requestCrewAction.bind(null, weekStart);
  const decideRequest = decideCrewRequestAction.bind(null, weekStart);
  const saveAway = saveAwayAction.bind(null, weekStart);
  const deleteAway = deleteAwayAction.bind(null, weekStart);
  const decideAway = decideAwayAction.bind(null, weekStart);
  return (
    <StaffPage width="full">
      {/* `week` is a reading of the page and stays in the URL; the rest is
          one-shot chrome. */}
      <FlashParams params={["notice"]} />
      {/* Schedule's Crew view (ADR 20261001-logbook) carries the week across. */}
      <CrewPageHeader
        printHref={`${shopPath(shopSlug, "staffing", "print")}?${WEEK_PARAM}=${weekStart}${selectionQuery}`}
        t={t}
      />
      <ScheduleViews
        shopSlug={shopSlug}
        crewSchedule
        current={plan ? "plan" : "crew"}
        week={weekStart}
        copy={{
          label: t("schedule.views.label"),
          week: t("schedule.views.week"),
          crew: t("schedule.views.crew"),
          plan: t("schedule.views.plan"),
        }}
      />

      {pageNotice ? (
        <div className="mb-6">
          <ShopNotice tone={pageNotice.tone} role={noticeRole(pageNotice.tone)}>
            {t(pageNotice.key)}
          </ShopNotice>
        </div>
      ) : null}

      {/* Nobody on the roster used to render as an empty grid — a heading, a
          date range, and then nothing at all, which reads as a page that
          failed to load. Who can fix it decides what it says: a manager gets
          the door to Team, everyone else gets the honest "ask an owner". The
          week and both doors stay off the page until there is a team, because
          a shift needs somebody to give it to. */}
      {view.staff.length === 0 ? (
        <EmptyState
          titleAs="h2"
          title={t("staffing.working.rosterEmptyHeading")}
          body={
            canManage
              ? t("staffing.working.rosterEmptyManagerBody")
              : t("staffing.working.rosterEmptyBody")
          }
          action={
            canManage ? (
              <Link href={shopPath(shopSlug, "settings", "team")} className={buttonClass()}>
                {t("staffing.working.rosterEmptyAction")}
              </Link>
            ) : null
          }
        />
      ) : plan ? (
        <>
          <WeekPager
            className="mb-6"
            rangeLabel={formatCalendarDateRange(weekStart, weekEnd, locale)}
            previousHref={`${staffingPath}?view=plan&${WEEK_PARAM}=${shiftWeek(weekStart, -1)}`}
            nextHref={`${staffingPath}?view=plan&${WEEK_PARAM}=${shiftWeek(weekStart, 1)}`}
            thisWeekHref={weekStart === weekStartOf(today) ? null : `${staffingPath}?view=plan`}
            words={weekWords}
          />
          <TimeOffApprovals
            pending={pendingTimeOff}
            locale={locale}
            t={t}
            decideAction={decideAway}
          />
          <StaffingMyWeek
            days={weekDayFaces(week.days, locale)}
            shifts={myShifts}
            blocks={myBlocks}
            locale={locale}
            timeZone={shop.timezone}
            selfId={session.user.personId}
            people={
              canManage
                ? view.staff.map((member) => ({
                    id: member.person.id,
                    name: member.person.fullName,
                  }))
                : undefined
            }
            approvalRequired={shop.timeOffApprovalEnabled && !canManage}
            createShiftAction={createShift}
            saveAwayAction={saveAway}
            deleteShiftAction={deleteShift}
            deleteAwayAction={deleteAway}
            t={t}
          />
          <StaffingWarnings shop={shop} shopSlug={shopSlug} view={view} locale={locale} />
        </>
      ) : (
        <>
          {!selectedPerson ? (
            <StaffingWarnings shop={shop} shopSlug={shopSlug} view={view} locale={locale} />
          ) : null}
          <StaffingWeek
            week={week}
            gapWords={gapWords}
            locale={locale}
            timeZone={shop.timezone}
            shopSlug={shopSlug}
            canManage={canManage}
            canDecide={canManage}
            deleteShiftAction={deleteShift}
            requestAction={requestCrew}
            decideRequestAction={decideRequest}
            dayParam={query.day}
            picker={
              <SchedulePicker
                week={weekStart}
                value={selectedValue}
                label={t("staffing.filter.person")}
                options={[
                  { value: "all", label: t("staffing.filter.all") },
                  { value: "me", label: t("staffing.filter.me") },
                  ...(canManage
                    ? view.staff
                        .filter((member) => member.person.id !== session.user.personId)
                        .map((member) => ({
                          value: member.person.id,
                          label: member.person.fullName,
                        }))
                    : []),
                ]}
              />
            }
            links={{
              rangeLabel: formatCalendarDateRange(weekStart, weekEnd, locale),
              dayHrefPrefix: `${staffingPath}?${WEEK_PARAM}=${weekStart}${selectionQuery}&day=`,
              previousHref: `${staffingPath}?${WEEK_PARAM}=${shiftWeek(weekStart, -1)}${selectionQuery}`,
              nextHref: `${staffingPath}?${WEEK_PARAM}=${shiftWeek(weekStart, 1)}${selectionQuery}`,
              thisWeekHref:
                weekStart === weekStartOf(today)
                  ? null
                  : `${staffingPath}?person=${encodeURIComponent(selectedValue)}`,
            }}
            words={weekWords}
          />
        </>
      )}
    </StaffPage>
  );
}
