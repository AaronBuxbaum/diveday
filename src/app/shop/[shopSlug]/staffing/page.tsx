import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import { ShopNotice } from "@/components/ui/outcome";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { noticeRole } from "@/components/ui/tone";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDateRange } from "@/lib/format";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { shiftWeek, WEEK_PARAM, weekStartOf } from "@/lib/week-board";
import { ScheduleViews } from "../schedule/_components/ScheduleViews";
import { CrewPageHeader } from "./_components/CrewPageHeader";
import { staffingGapWords } from "./_components/gap-words";
import { StaffingWarnings } from "./_components/StaffingWarnings";
import { StaffingWeek } from "./_components/StaffingWeek";
import { readStaffingWeek } from "./_components/staffing-week-read";
import { staffingWeekWords } from "./_components/staffing-week-words";
import {
  createShiftAction,
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

/**
 * Everything the Add-a-shift door can answer for itself. Its outcome belongs
 * in its own action row rather than in a banner under the `<h1>` — and because
 * the door is now a disclosure, the same set decides whether it opens on
 * arrival: a refusal that closed the form it came from would leave the reader
 * a red banner and nothing to correct.
 *
 * `shift-deleted` is not one of them: it comes from a Remove inside the week
 * above, so it keeps the banner, which is the nearer of the two.
 * `not-authorized` stays there too — a staffer without the right never sees
 * the door at all.
 */
const ADD_SHIFT_NOTICES = new Set(["shift-saved", "overlap", "staff-not-found", "invalid"]);

export default async function StaffingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ week?: string; notice?: string; person?: string; view?: string }>;
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
  const { today, weekStart, weekEnd, view, blocks, canManage, week, selectedPerson } = read;
  // **What the Add-a-shift form opens on: today, when the week on screen
  // contains it.** Defaulting to `weekStart` unconditionally put a Friday
  // afternoon's last-minute crew change — the busy-dock case this page exists
  // for — on Monday, silently: `createStaffShift` validates only that a shift
  // ends after it starts, so nothing refused the date, and the trip page then
  // went on reporting that crew member as not on a shift for the coverage
  // warning the manager believed they had just cleared. Paging to another week
  // still opens on that week's Monday, which is the only honest answer there.
  // Calendar dates are ISO `YYYY-MM-DD`, so the ordering is the string's.
  const defaultShiftDate = today >= weekStart && today <= weekEnd ? today : weekStart;
  const notice = noticeFromParam(query.notice, notices);
  const onShiftForm =
    canManage && plan && query.notice !== undefined && ADD_SHIFT_NOTICES.has(query.notice);
  const shiftStatus = onShiftForm ? notice : undefined;
  const pageNotice = onShiftForm ? undefined : notice;

  const gapWords = staffingGapWords(t);

  const myBlocks = blocks.filter((block) => block.personId === session.user.personId);
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

      {plan ? null : (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <SegmentedControl
            ariaLabel={t("staffing.filter.label")}
            currentKey={selectedValue === "all" || selectedValue === "me" ? selectedValue : null}
            items={(["all", "me"] as const).map((value) => ({
              key: value,
              label: t(`staffing.filter.${value}`),
              href: `${staffingPath}?week=${weekStart}&person=${value}`,
            }))}
          />
          {canManage ? (
            <form action={staffingPath} className="flex items-center gap-2">
              <input type="hidden" name="week" value={weekStart} />
              <select
                key={selectedValue}
                name="person"
                defaultValue={selectedValue}
                aria-label={t("staffing.filter.person")}
                className={`${controlClass} w-auto min-w-48`}
              >
                <option value="all">{t("staffing.filter.all")}</option>
                <option value="me">{t("staffing.filter.me")}</option>
                {view.staff
                  .filter((member) => member.person.id !== session.user.personId)
                  .map((member) => (
                    <option key={member.person.id} value={member.person.id}>
                      {member.person.fullName}
                    </option>
                  ))}
              </select>
              <SubmitButton
                pendingLabel={t("staffing.filter.show")}
                className={buttonClass({
                  variant: "secondary",
                  className: "shrink-0 whitespace-nowrap",
                })}
              >
                {t("staffing.filter.show")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      )}

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
          <StaffingWarnings shop={shop} shopSlug={shopSlug} view={view} locale={locale} />
          {canManage ? (
            <PlanSection id="add-shift" label={t("staffing.addShift.heading")}>
              <FieldGrid as="form" action={createShift} columns={2}>
                <Field label={t("staffing.addShift.person")}>
                  <select name="personId" required className={controlClass}>
                    <option value="">{t("staffing.addShift.choosePerson")}</option>
                    {view.staff.map((member) => (
                      <option key={member.person.id} value={member.person.id}>
                        {member.person.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("staffing.addShift.date")}>
                  <DateField name="date" required defaultValue={defaultShiftDate} />
                </Field>
                <Field label={t("staffing.addShift.starts")}>
                  <DateField name="startTime" type="time" required defaultValue="07:00" />
                </Field>
                <Field label={t("staffing.addShift.ends")}>
                  <DateField name="endTime" type="time" required defaultValue="15:00" />
                </Field>
                <Field label={t("staffing.addShift.note")} hint={t("staffing.addShift.noteHint")}>
                  <input
                    name="note"
                    maxLength={120}
                    className={controlClass}
                    placeholder={t("staffing.addShift.notePlaceholder")}
                  />
                </Field>
                <FieldActions>
                  <SubmitButton pendingLabel={t("words.busy.saving")} className={buttonClass()}>
                    {t("staffing.addShift.submit")}
                  </SubmitButton>
                  <FormStatus tone={shiftStatus?.tone}>
                    {shiftStatus ? t(shiftStatus.key) : undefined}
                  </FormStatus>
                </FieldActions>
              </FieldGrid>
            </PlanSection>
          ) : null}

          {/* **The crew member's own door** (issue #1235, ADR
              20260902-crew-requests-and-blackouts). Every other write on this
              page is behind `canManage`; this one is not, and that is the whole
              point of the slice. A manager's `<select>` lets them record a
              range for somebody who phoned on a Sunday; everyone else writes
              their own row and the domain layer refuses anything else. */}
          <PlanSection id="add-away" label={t("staffing.away.heading")}>
            <FieldGrid as="form" action={saveAway} columns={2}>
              {canManage ? (
                <Field label={t("staffing.away.person")}>
                  <select
                    name="personId"
                    required
                    defaultValue={session.user.personId}
                    className={controlClass}
                  >
                    {view.staff.map((member) => (
                      <option key={member.person.id} value={member.person.id}>
                        {member.person.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                // Never a form field for a crew member: the person is the
                // session's own, and the domain layer checks it again anyway.
                <input type="hidden" name="personId" value={session.user.personId} />
              )}
              <Field label={t("staffing.away.from")}>
                <DateField name="startsOn" required defaultValue={defaultShiftDate} />
              </Field>
              <Field label={t("staffing.away.to")}>
                <DateField name="endsOn" required defaultValue={defaultShiftDate} />
              </Field>
              <Field label={t("staffing.away.note")}>
                <input
                  name="note"
                  maxLength={120}
                  className={controlClass}
                  placeholder={t("staffing.away.notePlaceholder")}
                />
              </Field>
              <FieldActions>
                <SubmitButton pendingLabel={t("words.busy.saving")} className={buttonClass()}>
                  {t("staffing.away.save")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
            {/* Their own rows for the week on screen, each with its one act.
                Somebody else's are visible on the grid above as quiet chips
                and are not removable here — the row belongs to its person. */}
            {myBlocks.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-2">
                {myBlocks.map((block) => (
                  <li key={block.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      {formatCalendarDateRange(block.startsOn, block.endsOn, locale)}
                      {block.note ? ` · ${block.note}` : ""}
                    </span>
                    <form action={deleteAway}>
                      <input type="hidden" name="blockId" value={block.id} />
                      <SubmitButton
                        pendingLabel={t("words.busy.removing")}
                        className={buttonClass({ variant: "ghost", size: "sm" })}
                      >
                        {t("staffing.away.remove")}
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
          </PlanSection>
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
            links={{
              rangeLabel: formatCalendarDateRange(weekStart, weekEnd, locale),
              previousHref: `${staffingPath}?${WEEK_PARAM}=${shiftWeek(weekStart, -1)}${selectionQuery}`,
              nextHref: `${staffingPath}?${WEEK_PARAM}=${shiftWeek(weekStart, 1)}${selectionQuery}`,
              thisWeekHref:
                weekStart === weekStartOf(today)
                  ? null
                  : `${staffingPath}?person=${encodeURIComponent(selectedValue)}`,
            }}
            words={staffingWeekWords(t, week)}
          />
        </>
      )}
    </StaffPage>
  );
}

/**
 * One of the Shifts and away tab's two forms: a heading over the form, always
 * open, because the tab exists to fill them in.
 */
function PlanSection({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} id={id} className="scroll-mt-8 pt-2 pb-8">
      <h2 id={`${id}-heading`} className="mb-4 font-semibold">
        {label}
      </h2>
      {children}
    </section>
  );
}
