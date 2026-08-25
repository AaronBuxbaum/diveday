import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getStaffingView } from "@/db/staffing";
import { listStaff } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import {
  calendarDateInTimezone,
  formatCalendarDate,
  isValidCalendarDate,
  shiftCalendarDate,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatTimeRangeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, noticeRole, shopPath } from "@/lib/staff-notices";
import { parseWallTime, toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { createShiftAction, deleteShiftAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Staffing — DiveDay" };

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
};

/**
 * Everything the Add-a-shift form itself can say. It lives a long way down the
 * page, under the working list, so its outcome belongs in its own action row
 * rather than in a banner under the `<h1>`.
 * `shift-deleted` is not one of them: it comes from a per-row Remove button in
 * the working list *above*, so it keeps the banner, which is the nearer of the
 * two. `not-authorized` stays there too — a staffer without the right never
 * sees the form at all.
 */
const ADD_SHIFT_NOTICES = new Set(["shift-saved", "overlap", "staff-not-found", "invalid"]);

export default async function StaffingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ from?: string; to?: string; notice?: string }>;
}) {
  const { shopSlug } = await params;
  const query = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  // Negotiated from the request, falling back to the shop's default — a staff
  // member reads dates and copy in their own language, not the shop row's.
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // Through the clock, not `new Date()`: this default window is what the whole
  // page renders from, so a raw wall-clock read here left the one staff surface
  // that ignores DIVEDAY_CLOCK — the seeded shifts sit at the frozen instant
  // while the window opened on the real today, which is both an unstable visual
  // baseline and an e2e fixture that drifts out from under itself. In
  // production `nowDate()` is the native call, unchanged.
  const today = calendarDateInTimezone(nowDate(), shop.timezone);
  const fromValue = query.from && isValidCalendarDate(query.from) ? query.from : today;
  const toValue =
    query.to && isValidCalendarDate(query.to) ? query.to : shiftCalendarDate(fromValue, 6);
  const fromWall = parseWallTime(fromValue, "00:00");
  const toWall = parseWallTime(shiftCalendarDate(toValue, 1), "00:00");
  if (!fromWall || !toWall) redirect(shopPath(shopSlug, "staffing"));
  const view = await getStaffingView(
    db,
    shop.id,
    wallTimeToUtc(fromWall, shop.timezone),
    wallTimeToUtc(toWall, shop.timezone),
  );
  const staff = await listStaff(db, shop.id);
  const canManage = await canPersonManageStaffAccounts(db, shop.id, session.user.personId);
  const notice = noticeFromParam(query.notice, notices);
  // The shift form answers for itself; only what is genuinely about the page
  // (or what the form is not on screen to answer) keeps the banner.
  const onShiftForm =
    canManage && query.notice !== undefined && ADD_SHIFT_NOTICES.has(query.notice);
  const shiftStatus = onShiftForm ? notice : undefined;
  const pageNotice = onShiftForm ? undefined : notice;
  const defaultStart = utcToWallTime(view.from, shop.timezone);
  const defaultDate = toDateInputValue(defaultStart);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["from", "to", "notice"]} />
      <ShopPageHeader
        eyebrow={t("staffing.eyebrow")}
        title={t("staffing.title")}
        description={t("staffing.description")}
      />

      {pageNotice ? (
        <div className="mt-6">
          <ShopNotice tone={pageNotice.tone} role={noticeRole(pageNotice.tone)}>
            {t(pageNotice.key)}
          </ShopNotice>
        </div>
      ) : null}

      <SectionCard as="div" padding="lg" className="mt-8">
        {/* `QueryForm`, not a native GET form: moving the window is a filter
            over this page, and a document reload dropped the manager back at
            the top of it every time. */}
        <QueryForm>
          <FieldGrid columns={3}>
            <Field label={t("staffing.window.from")}>
              <input name="from" type="date" defaultValue={fromValue} className={controlClass} />
            </Field>
            <Field label={t("staffing.window.through")}>
              <input name="to" type="date" defaultValue={toValue} className={controlClass} />
            </Field>
            <FieldActions>
              <button type="submit" className={buttonClass({ variant: "secondary" })}>
                {t("staffing.window.show")}
              </button>
            </FieldActions>
          </FieldGrid>
        </QueryForm>
      </SectionCard>

      {/* One line about crewing, not a table of it. Which departures still
          need people is Today's question — it is the surface that can answer
          it, by dragging a name onto a boat — so the roster states the count
          and hands over. Composed from the same reader Today's own detection
          runs on, never a second pass (ADR 20260806-staffing-is-the-shift-roster). */}
      {/* Weight follows what there is to do (design principle 3): a gap gets a
          card and a way out, while "all crewed" and "nothing scheduled" are
          quiet lines — a bordered box around good news is a border the page
          has not earned. */}
      {view.crewGaps.needCrew > 0 ? (
        // This is an operational warning panel, not a neutral section: the
        // warning tone tells the manager that a departure still needs crew.
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
          {/* 16px, not 14: this is the page's one operational message, and the
              dock test (design principle 2) sets the floor for the text a
              manager reads on a phone between boats.
              No button beside it. The "Assign crew on Today" link this
              replaces went to a permanent nav tab, which the header and the
              phone dock already put one tap away from every page — chrome
              restated as a call to action. The sentence names where the work
              is done; getting there was never the hard part. */}
          <p className="text-base font-medium text-warning">
            {t("staffing.crewGaps.needCrew", { count: view.crewGaps.needCrew })}
          </p>
        </section>
      ) : (
        <p className="mt-4 text-sm text-muted">
          {view.crewGaps.departures === 0
            ? t("staffing.crewGaps.noDepartures")
            : t("staffing.crewGaps.allCrewed")}
        </p>
      )}

      <section className="mt-8" aria-labelledby="working-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="working-heading" className="text-lg font-semibold">
              {t("staffing.working.heading")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {formatCalendarDate(fromValue, locale)} – {formatCalendarDate(toValue, locale)}
            </p>
          </div>
          {canManage ? <Badge tone="neutral">{t("staffing.working.managerOnly")}</Badge> : null}
        </div>
        {/* Nobody on the roster used to render as an empty grid — a heading, a
            date range, and then nothing at all, which reads as a page that
            failed to load. Who can fix it decides what it says: a manager gets
            the door to Team, everyone else gets the honest "ask an owner". */}
        {view.staff.length === 0 ? (
          <EmptyState
            titleAs="h3"
            title={t("staffing.working.rosterEmptyHeading")}
            body={
              canManage
                ? t("staffing.working.rosterEmptyManagerBody")
                : t("staffing.working.rosterEmptyBody")
            }
            action={
              canManage ? (
                <Link
                  href={`/shop/${shopSlug}/settings/team`}
                  className={buttonClass({ className: "mt-4" })}
                >
                  {t("staffing.working.rosterEmptyAction")}
                </Link>
              ) : null
            }
            className="mt-4"
          />
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {view.staff.map((member) => (
              <SectionCard as="article" key={member.person.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{member.person.fullName}</h3>
                    <p className="mt-1 text-sm text-muted">{member.roles.join(" · ")}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {member.capabilities.map((capability) => (
                      <Badge key={capability} tone="primary">
                        {t(`staffing.capability.${capability}`)}
                      </Badge>
                    ))}
                  </div>
                </div>
                {member.shifts.length === 0 ? (
                  <p className="mt-4 text-sm text-warning">{t("staffing.working.notScheduled")}</p>
                ) : (
                  <ul className="mt-4 space-y-2 text-sm">
                    {member.shifts.map((shift) => (
                      <li
                        key={shift.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2"
                      >
                        <span>
                          <span className="font-medium">
                            {formatTimeRangeTz(shift.startsAt, shift.endsAt, locale, shop.timezone)}
                          </span>
                          {shift.note ? (
                            <span className="ml-2 text-muted">{shift.note}</span>
                          ) : null}
                        </span>
                        {canManage ? (
                          <form action={deleteShiftAction}>
                            <input type="hidden" name="shiftId" value={shift.id} />
                            <SubmitButton
                              pendingLabel={t("staffing.working.removing")}
                              className={buttonClass({ variant: "ghost", size: "sm" })}
                            >
                              {t("staffing.working.remove")}
                            </SubmitButton>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {/* The other half of the shift ↔ crew cross-link (task 165): a
                  shift alone doesn't say which boat, if any, this person is
                  actually on — this is where that becomes visible. */}
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs font-bold tracking-wide text-muted uppercase">
                    {t("staffing.working.crewingHeading")}
                  </p>
                  {member.crewingTrips.length === 0 ? (
                    <EmptyState title={t("staffing.working.crewingEmpty")} className="mt-1" />
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {member.crewingTrips.map((trip) => (
                        <li key={trip.tripId}>
                          <Link
                            href={`/shop/${shopSlug}/trips/${trip.tripId}#crew`}
                            className="font-medium text-primary hover:underline"
                          >
                            {trip.title}
                          </Link>{" "}
                          <span className="text-muted">
                            {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </SectionCard>
            ))}
          </div>
        )}
      </section>

      {/* A shift needs somebody to give it to. With nobody on the roster the
          person select has no options, so the form is a dead control — and its
          "Add shift" primary would sit a screen below the empty state's own
          primary ("Invite your crew"), two first-choice buttons for one
          decision. The empty state is the whole answer until there is a team. */}
      {canManage && staff.length > 0 ? (
        <SectionCard className="mt-8" padding="lg" title={t("staffing.addShift.heading")}>
          <FieldGrid as="form" action={createShiftAction} columns={2}>
            <Field label={t("staffing.addShift.person")}>
              <select name="personId" required className={controlClass}>
                <option value="">{t("staffing.addShift.choosePerson")}</option>
                {staff.map((member) => (
                  <option key={member.person.id} value={member.person.id}>
                    {member.person.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("staffing.addShift.date")}>
              <input
                name="date"
                type="date"
                required
                defaultValue={defaultDate}
                className={controlClass}
              />
            </Field>
            <Field label={t("staffing.addShift.starts")}>
              <input
                name="startTime"
                type="time"
                required
                defaultValue="07:00"
                className={controlClass}
              />
            </Field>
            <Field label={t("staffing.addShift.ends")}>
              <input
                name="endTime"
                type="time"
                required
                defaultValue="15:00"
                className={controlClass}
              />
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
              <SubmitButton pendingLabel={t("staffing.addShift.saving")} className={buttonClass()}>
                {t("staffing.addShift.submit")}
              </SubmitButton>
              <FormStatus tone={shiftStatus?.tone}>
                {shiftStatus ? t(shiftStatus.key) : undefined}
              </FormStatus>
            </FieldActions>
          </FieldGrid>
        </SectionCard>
      ) : null}
    </main>
  );
}
