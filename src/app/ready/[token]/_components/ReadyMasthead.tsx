import { TripActions } from "@/app/s/[shopSlug]/trips/[id]/_components/TripActions";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import type { ReadyPageData } from "@/db/ready";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { formatRelativeDay, formatShortDate, formatTime, formatTimeRangeTz } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { publicTripCalendarPath, publicTripPath } from "@/lib/public-routes";

/**
 * The readiness thread's masthead lines, under the trip title: when, the dive
 * day, the dock call (or the hotel pickup), the calendar and share row, and
 * what this page is. Everything here needs only the verified booking, so it
 * paints with the confirmation, ahead of the streamed thread.
 */
export function ReadyMasthead({
  data,
  locale,
  t,
  diveDay,
}: {
  data: ReadyPageData;
  locale: DiverLocale;
  t: DiverTranslator;
  /** The departure is today, in the shop's own zone (`isDiveDay`). */
  diveDay: boolean;
}) {
  const { detail, shop } = data;
  // Every date, time, and relative phrase on this page formats for `locale` —
  // the *negotiated* one. These four used to pass `shop.defaultLocale`
  // straight into the formatter, so a diver reading Spanish prose got the
  // shop's own language for the one thing they most need to read at a glance:
  // when to show up (AGENTS.md — never hard-code a locale in the UI).
  const when = formatShortDate(detail.trip.startsAt, locale, detail.shop.timezone);
  const timeRange = formatTimeRangeTz(
    detail.trip.startsAt,
    detail.trip.endsAt,
    locale,
    detail.shop.timezone,
  );
  // Task 46: the day-before email already tells a diver when to be at the
  // dock (`dockCallPhrase` in src/lib/notifications/email.ts) — this page
  // never did, so a diver re-checking it after reading the email couldn't
  // find the one number that actually matters that morning.
  const dockCallAt = new Date(detail.trip.startsAt.getTime() - shop.dockCallMinutes * 60_000);
  const dockCallLine = t("ready.dockCallLine", {
    time: formatTime(dockCallAt, locale, detail.shop.timezone),
    dock: t("notifications.common.dockCallMinutes", { minutes: shop.dockCallMinutes }),
  });
  // Task 47: "in 2 days" / "tomorrow" / "today" — the page a diver opens the
  // night before should read at least as rich as the email that sent them
  // here, and a bare date is easy to misjudge at a glance the way a full
  // relative phrase isn't.
  const relativeWhen = formatRelativeDay(
    detail.trip.startsAt,
    nowDate(),
    locale,
    detail.shop.timezone,
  );
  // Absolute where a canonical origin is configured — this one exists to be
  // pasted into a group chat — with the relative fallback the claim links above
  // use, so a missing APP_HOST shares a working same-origin link rather than a
  // broken one. Never `window.location.href`: see `TripActions`' `shareUrl`.
  const shareOrigin = publicAppUrl();
  const tripPath = publicTripPath(shop.slug, data.trip.id);
  const shareTripUrl = shareOrigin ? new URL(tripPath, `${shareOrigin}/`).toString() : tripPath;
  return (
    <>
      <p className="mt-1 text-base text-muted">
        {when} · {timeRange} · {relativeWhen}
      </p>
      {/* Today. Said once, above the only number that matters this
                morning — plain ink, no motion: the thread's three coral
                moments are booked, paperwork done, and welcome home, and
                "your boat is today" is none of them. */}
      {diveDay ? <p className={`mt-2 ${ITEM_TITLE_CLASS}`}>{t("thread.diveDayLine")}</p> : null}
      {/* The one number that matters on the morning of the trip — a
                shade stronger than the meta line above it, never shouting.
                When a hotel pickup is scheduled, that time leads ahead of dock
                call. */}
      {data.pickupTime ? (
        <p className="mt-1 text-base font-medium">
          {t("ready.hotelPickupHeaderLine", {
            time: data.pickupTime,
            location: data.hotelPickupLocation ?? t("ready.hotelPickupLocationNotSet"),
          })}
        </p>
      ) : (
        <p className="mt-1 text-base font-medium">{dockCallLine}</p>
      )}
      {/* Put the day in a calendar, and send the trip to whoever is
                coming — the same ghost-weight row, in the same place under the
                masthead, as the public trip page carries.

                `shareUrl` is the **public trip page**, never this one: this URL
                *is* a bearer capability that can cancel the booking and move
                its refund, and "share with a buddy" must not hand that to a
                group chat (docs/engineering/capability-telemetry-runbook.md). */}
      <TripActions
        calendarUrl={publicTripCalendarPath(shop.slug, data.trip.id)}
        shareUrl={shareTripUrl}
      />
      {/* What this page *is*, said once, at the top. Divers arrive here
                from a booking submit or an emailed link, and both of those
                read as a confirmation — a thing you look at once and close.
                This one is not: it is the same URL all week, it is where the
                cards and the gear answers go, and it restates itself every
                time the shop moves. */}
      <p className="mt-3 text-sm text-muted">{t("ready.keepThisPage")}</p>
    </>
  );
}
