import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoiceRow } from "@/components/ui/form";
import { listDayBlowoutDepartures } from "@/db/blowouts";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  type DayBlowoutBlock,
  type DayBlowoutPick,
  dayBlowoutBlock,
  dayBlowoutPicked,
  isDayBlowoutPick,
} from "@/lib/day-blowout";
import { formatTimeRangeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { addCalendarDays, wallTimeToUtc } from "@/lib/zoned";
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
  departed: "blowout.day.departed",
};

/** A notice count off the URL; anything else reads as zero. */
function countParam(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * **One weather call for a whole morning or day** (ADR
 * 20261009-day-weather-call). Every departure of the shop's day, each with how
 * many people are booked on it; a preset ticks all of them or the mornings, and
 * a staffer can tick any selection. Submitting is the one deliberate step, as
 * on the single-trip page: each ticked departure then goes through exactly that
 * page's blow-out, and its cascade record is a link away.
 */
export default async function DayBlowoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; date: string }>;
  searchParams: Promise<{
    pick?: string;
    notice?: string;
    count?: string;
    called?: string;
    skipped?: string;
  }>;
}) {
  const [{ shopSlug, date }, query] = await Promise.all([params, searchParams]);
  if (!isValidCalendarDate(date)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const now = nowDate();

  const [year, month, day] = date.split("-").map(Number);
  const midnight = { year, month, day, hour: 0, minute: 0 };
  const departures = await listDayBlowoutDepartures(db, shop.id, {
    from: wallTimeToUtc(midnight, shop.timezone),
    to: wallTimeToUtc(addCalendarDays(midnight, 1), shop.timezone),
  });

  const pick: DayBlowoutPick = isDayBlowoutPick(query.pick) ? query.pick : "all";
  const ticked = new Set(dayBlowoutPicked(departures, pick, { now, timeZone: shop.timezone }));
  const callable = departures.filter((row) => dayBlowoutBlock(row, now) === null);
  const banner = noticeFromParam(query.notice, NOTICES);
  const dayPath = shopPath(shopSlug, "schedule", "blowout", "day", date);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "count", "called", "skipped"]} />
      <ShopPageHeader
        eyebrow={t("shared.shopNavLinks.board")}
        eyebrowHref={shopPath(shopSlug, "schedule", "board")}
        title={t("blowout.day.title")}
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

        {departures.length === 0 ? (
          <EmptyState title={t("blowout.day.empty")} icon={false} nested className="mt-5" />
        ) : (
          <form action={callDayBlowoutAction.bind(null, shopSlug, date)} className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("blowout.day.departuresHeading")}</h2>
              {callable.length > 0 ? (
                <nav aria-label={t("blowout.day.pickLabel")} className="flex flex-wrap gap-2">
                  {(["all", "morning"] as const).map((preset) => (
                    <Link
                      key={preset}
                      href={`${dayPath}?pick=${preset}`}
                      aria-current={pick === preset ? "true" : undefined}
                      className={buttonClass({
                        variant: pick === preset ? "secondary" : "ghost",
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
                const when = formatTimeRangeTz(row.startsAt, row.endsAt, locale, shop.timezone);
                const booked = t("blowout.day.booked", { count: row.booked });
                return (
                  <li key={row.id} className="py-1">
                    {block === null ? (
                      // `key` carries the preset, so switching it re-renders the
                      // box rather than keeping the browser's remembered tick.
                      <ChoiceRow
                        key={`${row.id}-${pick}`}
                        type="checkbox"
                        name="tripId"
                        value={row.id}
                        defaultChecked={ticked.has(row.id)}
                        className="text-sm"
                      >
                        <span className="font-medium">{row.title}</span>
                        <span className="block text-muted">
                          <span className="whitespace-nowrap">{when}</span> · {booked}
                        </span>
                      </ChoiceRow>
                    ) : (
                      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium">{row.title}</span>
                          <span className="block text-muted">
                            <span className="whitespace-nowrap">{when}</span> · {booked}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone="neutral" size="sm">
                            {t(BLOCK_KEY[block])}
                          </Badge>
                          {block === "called" ? (
                            <Link
                              href={shopPath(shopSlug, "schedule", "blowout", row.id)}
                              className={buttonClass({ variant: "link", size: "sm" })}
                            >
                              {t("blowout.day.openRecord")}
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
              <SubmitButton
                pendingLabel={t("blowout.confirm.calling")}
                className={`mt-6 ${buttonClass({ variant: "danger" })}`}
              >
                {t("blowout.day.button")}
              </SubmitButton>
            )}
          </form>
        )}
      </SectionCard>
    </main>
  );
}
