import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoiceRow } from "@/components/ui/form";
import { canPersonCallDayBlowout } from "@/db/authz";
import { type DayBlowoutDepartureRow, listDayBlowoutDepartures } from "@/db/blowouts";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  type DayBlowoutBlock,
  type DayBlowoutPick,
  dayBlowoutBlock,
  dayBlowoutBounds,
  dayBlowoutCallable,
  dayBlowoutPicked,
  isDayBlowoutPick,
} from "@/lib/day-blowout";
import { formatTimeRangeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { callDayBlowoutAction } from "./actions";

// The blow-out family's contract (ADR 20260804-instant-navigation): this
// segment's `loading.tsx` paints first, and nothing above it reads the request.
export const instant = true;

export const metadata: Metadata = {
  title: "Weather blow-out for the day — DiveDay",
};

const NOTICES: Record<string, { tone: "success" | "danger" | "warning"; key: StaffMessageKey }> = {
  "day-called": { tone: "success", key: "blowout.notices.dayCalled" },
  "day-partly": { tone: "warning", key: "blowout.notices.dayPartly" },
  "day-none": { tone: "danger", key: "blowout.notices.dayNone" },
  error: { tone: "danger", key: "blowout.notices.error" },
};

const BLOCK_KEY: Record<DayBlowoutBlock, StaffMessageKey> = {
  called: "blowout.day.called",
  cancelled: "blowout.day.canceled",
  underway: "blowout.day.underway",
};

/** A notice count off the URL; anything else reads as zero. */
function countParam(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** The `tripId` values a select step carried in the URL, uuids only. */
function tripIdsParam(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.filter((entry) => uuidParam(entry));
}

/**
 * **One weather call for a whole morning or day** (ADR
 * 20261009-day-weather-call). Every departure of the shop's day, each with how
 * many people are booked on it and who is crewing it. Nothing is selected until
 * the staffer chooses: a preset selects all of them or those before noon, and
 * any selection is theirs. **Two steps**, both deliberate: "Review the call"
 * shows exactly what will be cancelled — "Cancel 2 departures, 5 divers" — and
 * only that button calls it. Each called departure then goes through the
 * single-trip page's blow-out, and its cascade record is a link away.
 *
 * Owner, manager and captain only (`canCallDayBlowout`); the single-trip call
 * stays open to all staff.
 */
export default async function DayBlowoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; date: string }>;
  searchParams: Promise<{
    pick?: string;
    step?: string;
    tripId?: string | string[];
    notice?: string;
    count?: string;
    called?: string;
    skipped?: string;
  }>;
}) {
  const [{ shopSlug, date }, query] = await Promise.all([params, searchParams]);
  if (!isValidCalendarDate(date)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonCallDayBlowout,
    refusal: { notice: "day-blowout-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const now = nowDate();

  const departures = await listDayBlowoutDepartures(
    db,
    shop.id,
    dayBlowoutBounds(date, shop.timezone),
  );
  const callable = departures.filter((row) => dayBlowoutBlock(row, now) === null);
  const submitted = tripIdsParam(query.tripId);
  const review = query.step === "confirm" ? dayBlowoutCallable(departures, submitted, now) : null;
  const reviewed = review && review.callable.length > 0 ? review.callable : null;
  const pick: DayBlowoutPick | null = isDayBlowoutPick(query.pick) ? query.pick : null;
  // A selection carried back from the review wins over a preset; neither means
  // nothing is selected.
  const ticked = new Set(
    submitted.length > 0
      ? submitted
      : dayBlowoutPicked(departures, pick, { now, timeZone: shop.timezone }),
  );
  const banner = noticeFromParam(review && !reviewed ? "day-none" : query.notice, NOTICES);
  const dayPath = shopPath(shopSlug, "schedule", "blowout", "day", date);
  const selectionKey = [pick ?? "none", ...submitted].join("-");
  const presetActive = (preset: DayBlowoutPick) => pick === preset && submitted.length === 0;

  const describe = (row: DayBlowoutDepartureRow) => (
    <>
      <span className="font-medium">{row.title}</span>
      <span className="block text-muted">
        <span className="whitespace-nowrap">
          {formatTimeRangeTz(row.startsAt, row.endsAt, locale, shop.timezone)}
        </span>{" "}
        · {t("blowout.day.booked", { count: row.booked })}
      </span>
      <span className="block text-muted">
        {row.crew.length > 0
          ? t("blowout.day.crew", { names: row.crew.join(", ") })
          : t("blowout.day.noCrew")}
      </span>
    </>
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "count", "called", "skipped"]} />
      <ShopPageHeader
        eyebrow={t("shared.shopNavLinks.board")}
        eyebrowHref={shopPath(shopSlug, "schedule", "board")}
        title={reviewed ? t("blowout.day.confirmTitle") : t("blowout.day.title")}
        meta={<span className="text-sm text-muted">{formatCalendarDate(date, locale)}</span>}
      />
      <div className="mt-6">
        {banner ? (
          <StaffNoticeBanner tone={banner.tone}>
            {t(banner.key, {
              count: countParam(query.count),
              called: countParam(query.called),
              skipped: countParam(query.skipped),
            })}
          </StaffNoticeBanner>
        ) : null}
      </div>
      <SectionCard as="div" padding="lg" className="max-w-2xl">
        <p className="text-sm">{t("blowout.day.lead")}</p>
        <p className="mt-3 text-sm text-muted">{t("blowout.confirm.moneyNote")}</p>

        {reviewed ? (
          <ReviewStep
            rows={departures.filter((row) => reviewed.includes(row.id))}
            describe={describe}
            action={callDayBlowoutAction.bind(null, shopSlug, date)}
            back={`${dayPath}?${reviewed.map((id) => `tripId=${id}`).join("&")}`}
            t={t}
          />
        ) : departures.length === 0 ? (
          <EmptyState title={t("blowout.day.empty")} icon={false} nested className="mt-5" />
        ) : (
          // The select step submits to this page, not to the call: the next
          // screen is the review, and only its button cancels anything.
          <form method="get" action={dayPath} className="mt-5">
            <input type="hidden" name="step" value="confirm" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("blowout.day.departuresHeading")}</h2>
              {callable.length > 0 ? (
                <nav aria-label={t("blowout.day.pickLabel")} className="flex flex-wrap gap-2">
                  {(["all", "morning"] as const).map((preset) => (
                    <Link
                      key={preset}
                      href={`${dayPath}?pick=${preset}`}
                      aria-current={presetActive(preset) ? "true" : undefined}
                      className={buttonClass({
                        variant: presetActive(preset) ? "secondary" : "ghost",
                        size: "sm",
                      })}
                    >
                      {preset === "all" ? t("blowout.day.pickAll") : t("blowout.day.pickMorning")}
                    </Link>
                  ))}
                </nav>
              ) : null}
            </div>
            <ul className="mt-2 flex flex-col divide-y divide-border">
              {departures.map((row) => {
                const block = dayBlowoutBlock(row, now);
                return (
                  <li key={row.id} className="py-1">
                    {block === null ? (
                      // `key` carries the selection, so switching it re-renders
                      // the box rather than keeping the browser's remembered tick.
                      <ChoiceRow
                        key={`${row.id}-${selectionKey}`}
                        type="checkbox"
                        name="tripId"
                        value={row.id}
                        defaultChecked={ticked.has(row.id)}
                        className="text-sm"
                      >
                        {describe(row)}
                      </ChoiceRow>
                    ) : (
                      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                        <div className="min-w-0">{describe(row)}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="neutral" size="sm">
                            {t(BLOCK_KEY[block])}
                          </Badge>
                          {block === "called" && row.unsent > 0 ? (
                            <Badge tone="warning" size="sm">
                              {t("blowout.day.unsent")}
                            </Badge>
                          ) : null}
                          {block === "called" ? (
                            <Link
                              href={shopPath(shopSlug, "schedule", "blowout", row.id)}
                              className={buttonClass({ variant: "link", size: "sm" })}
                            >
                              {row.unsent > 0
                                ? t("blowout.day.resume")
                                : t("blowout.day.openRecord")}
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {callable.length === 0 ? (
              <p className="mt-6 text-sm font-medium text-muted">
                {t("blowout.day.nothingToCall")}
              </p>
            ) : (
              <button type="submit" className={`mt-6 ${buttonClass({ variant: "secondary" })}`}>
                {t("blowout.day.review")}
              </button>
            )}
          </form>
        )}
      </SectionCard>
    </main>
  );
}

/** The second step: exactly what will be cancelled, and the one button that does it. */
function ReviewStep({
  rows,
  describe,
  action,
  back,
  t,
}: {
  rows: DayBlowoutDepartureRow[];
  describe: (row: DayBlowoutDepartureRow) => ReactNode;
  action: (formData: FormData) => Promise<void>;
  back: string;
  t: ReturnType<typeof staffTranslator>;
}) {
  const divers = rows.reduce((sum, row) => sum + row.booked, 0);
  return (
    <form action={action} className="mt-5">
      <h2 className="text-sm font-semibold">{t("blowout.day.departuresHeading")}</h2>
      <ul className="mt-2 flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="py-2 text-sm">
            <input type="hidden" name="tripId" value={row.id} />
            {describe(row)}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel={t("blowout.confirm.calling")}
          className={buttonClass({ variant: "danger" })}
        >
          {t("blowout.day.confirmButton", { departures: rows.length, divers })}
        </SubmitButton>
        <Link href={back} className={buttonClass({ variant: "ghost" })}>
          {t("blowout.day.changeSelection")}
        </Link>
      </div>
    </form>
  );
}
