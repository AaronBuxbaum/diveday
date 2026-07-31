import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getStaffingView, type StaffingGapCode } from "@/db/staffing";
import { listStaff } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import {
  calendarDateInTimezone,
  formatCalendarDate,
  isValidCalendarDate,
} from "@/lib/calendar-date";
import { formatTimeRangeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { parseWallTime, toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { createShiftAction, deleteShiftAction } from "./actions";

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
  staff_not_found: { tone: "danger", key: "staffing.notice.staffNotFound" },
  invalid: { tone: "danger", key: "staffing.notice.invalid" },
  "not-authorized": { tone: "danger", key: "staffing.notice.notAuthorized" },
};

const GAP_KEYS: Record<StaffingGapCode, StaffMessageKey> = {
  no_crew: "staffing.gap.no_crew",
  course_needs_instructor: "staffing.gap.course_needs_instructor",
  no_shift_coverage: "staffing.gap.no_shift_coverage",
};

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function StaffingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ from?: string; to?: string; notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const query = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(`/shop/${shopSlug}`);
  // Negotiated from the request, falling back to the shop's default — a staff
  // member reads dates and copy in their own language, not the shop row's.
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const today = calendarDateInTimezone(new Date(), shop.timezone);
  const fromValue = query.from && isValidCalendarDate(query.from) ? query.from : today;
  const toValue = query.to && isValidCalendarDate(query.to) ? query.to : addDays(fromValue, 6);
  const fromWall = parseWallTime(fromValue, "00:00");
  const toWall = parseWallTime(addDays(toValue, 1), "00:00");
  if (!fromWall || !toWall) redirect(`/shop/${shopSlug}/staffing`);
  const view = await getStaffingView(
    db,
    shop.id,
    wallTimeToUtc(fromWall, shop.timezone),
    wallTimeToUtc(toWall, shop.timezone),
  );
  const staff = await listStaff(db, shop.id);
  const canManage = await canPersonManageStaffAccounts(db, shop.id, session.user.personId);
  const notice = query.notice ? notices[query.notice] : undefined;
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

      {notice ? (
        <div className="mt-6">
          <ShopNotice tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>
            {t(notice.key)}
          </ShopNotice>
        </div>
      ) : null}

      <section className="mt-8 rounded-2xl border border-border bg-surface p-5">
        <FieldGrid as="form" columns={3} method="get">
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
      </section>

      <section className="mt-8" aria-labelledby="working-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="working-heading" className="text-xl font-semibold">
              {t("staffing.working.heading")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {formatCalendarDate(fromValue, locale)} – {formatCalendarDate(toValue, locale)}
            </p>
          </div>
          {canManage ? <Badge tone="neutral">{t("staffing.working.managerOnly")}</Badge> : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {view.staff.map((member) => (
            <article
              key={member.person.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
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
                        {shift.note ? <span className="ml-2 text-muted">{shift.note}</span> : null}
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
                  <p className="mt-1 text-sm text-muted">{t("staffing.working.crewingEmpty")}</p>
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
            </article>
          ))}
        </div>
      </section>

      {canManage ? (
        <section
          className="mt-8 rounded-2xl border border-border bg-surface p-5"
          aria-labelledby="add-shift-heading"
        >
          <h2 id="add-shift-heading" className="text-lg font-semibold">
            {t("staffing.addShift.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("staffing.addShift.detail")}</p>
          <FieldGrid as="form" action={createShiftAction} columns={2} className="mt-4">
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
            </FieldActions>
          </FieldGrid>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="coverage-heading">
        <h2 id="coverage-heading" className="text-xl font-semibold">
          {t("staffing.coverage.heading")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("staffing.coverage.detail")}</p>
        <div className="mt-4 grid gap-3">
          {view.trips.length === 0 ? (
            <p className="text-sm text-muted">{t("staffing.coverage.noTrips")}</p>
          ) : null}
          {view.trips.map((entry) => (
            <article key={entry.trip.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {/* The trip's own crew editor — every gap below is fixed
                        here, so the coverage list is never a dead end
                        (Lens 17 task 139). */}
                    <Link
                      href={`/shop/${shopSlug}/trips/${entry.trip.id}#crew`}
                      className="text-primary hover:underline"
                    >
                      {entry.trip.title}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {formatTimeRangeTz(
                      entry.trip.startsAt,
                      entry.trip.endsAt,
                      locale,
                      shop.timezone,
                    )}
                    {entry.courseTitle ? ` · ${entry.courseTitle}` : ""}
                  </p>
                </div>
                <Badge tone={entry.gaps.length === 0 ? "success" : "warning"}>
                  {entry.gaps.length === 0
                    ? t("staffing.coverage.covered")
                    : t("staffing.coverage.gapCount", { count: entry.gaps.length })}
                </Badge>
              </div>
              {entry.gaps.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warning">
                  {entry.gaps.map((gap) => (
                    <li key={gap}>
                      <Link
                        href={`/shop/${shopSlug}/trips/${entry.trip.id}#crew`}
                        className="hover:underline"
                      >
                        {t(GAP_KEYS[gap])}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-success">{t("staffing.coverage.allGood")}</p>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
