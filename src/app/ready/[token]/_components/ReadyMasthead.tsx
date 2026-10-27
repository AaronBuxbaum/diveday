import type { ReactNode } from "react";
import { TripActions } from "@/app/s/[shopSlug]/trips/[id]/_components/TripActions";
import { EarnedMoment } from "@/components/EarnedMoment";
import { ThreadShell } from "@/components/thread/ThreadShell";
import type { ReadyPageData } from "@/db/ready";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import {
  bindTitleDash,
  formatOrdinal,
  formatRelativeDay,
  formatShortDate,
  formatTime,
  formatTimeRangeTz,
} from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { firstNameOf } from "@/lib/person-name";
import { publicTripCalendarPath, publicTripPath } from "@/lib/public-routes";
import type { DiveDayMilestone } from "@/lib/visit-milestones";

/**
 * **The facts the top of `/ready` states**, and the only ones: whose shop,
 * which departure, when, and when to be there. Both of the page's openings
 * read them, the ordinary masthead and the "You've got a seat" card a booking
 * lands on, and both can be built from one narrow row (`getBookedCard`,
 * src/db/ready.ts) as well as from the full loader, which is what lets the
 * booked card paint before the thread's reads have finished (UX review
 * 2026-10-10, item 7).
 */
export type MastheadFacts = {
  shop: { name: string; slug: string; timezone: string; dockCallMinutes: number };
  trip: { id: string; title: string; startsAt: Date; endsAt: Date };
  /** A scheduled hotel pickup replaces the dock call: the diver is told where they are collected. */
  pickup: { time: string | null; location: string | null };
};

/** The when line's two halves: the day and date, and the time range. */
export function mastheadWhenParts(
  facts: MastheadFacts,
  locale: string,
  now: Date,
): { day: string; hours: string } {
  const { trip, shop } = facts;
  const relative = formatRelativeDay(trip.startsAt, now, locale, shop.timezone);
  const lead = relative.charAt(0).toLocaleUpperCase(locale) + relative.slice(1);
  const date = formatShortDate(trip.startsAt, locale, shop.timezone);
  return {
    day: `${lead} · ${date}`,
    hours: formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone),
  };
}

/**
 * When to be there: the hotel pickup where one is scheduled, otherwise the
 * dock call (Task 46: the day-before email already says it, and this page is
 * where a diver re-checks it the morning of).
 */
export function mastheadArrivalLine(
  facts: MastheadFacts,
  locale: string,
  t: DiverTranslator,
): string {
  if (facts.pickup.time) {
    return t("ready.hotelPickupHeaderLine", {
      time: facts.pickup.time,
      location: facts.pickup.location ?? t("ready.hotelPickupLocationNotSet"),
    });
  }
  const dockCallAt = new Date(facts.trip.startsAt.getTime() - facts.shop.dockCallMinutes * 60_000);
  return t("ready.dockCallLine", {
    time: formatTime(dockCallAt, locale, facts.shop.timezone),
    dock: t("notifications.common.dockCallMinutes", { minutes: facts.shop.dockCallMinutes }),
  });
}

/**
 * The calendar and share row, and the line that says what this page is.
 *
 * `shareUrl` is the **public trip page**, never this one: this URL *is* a
 * bearer capability that can cancel the booking and move its refund, and
 * "share with a buddy" must not hand that to a group chat
 * (docs/engineering/capability-telemetry-runbook.md). Absolute where a
 * canonical origin is configured, since it exists to be pasted somewhere.
 */
function MastheadDoors({ facts, t }: { facts: MastheadFacts; t: DiverTranslator }) {
  const tripPath = publicTripPath(facts.shop.slug, facts.trip.id);
  const origin = publicAppUrl();
  const shareUrl = origin ? new URL(tripPath, `${origin}/`).toString() : tripPath;
  return (
    <>
      <TripActions
        calendarUrl={publicTripCalendarPath(facts.shop.slug, facts.trip.id)}
        shareUrl={shareUrl}
      />
      {/* What this page *is*, said once, at the top. Divers arrive here from a
          booking submit or an emailed link, and both read as a confirmation, a
          thing you look at once and close. This one is the same URL all week. */}
      <p className="mt-3 text-sm text-muted print:hidden">{t("ready.keepThisPage")}</p>
    </>
  );
}

/**
 * The ordinary masthead's lines under the trip's title: when, the dive-day
 * line on the day itself, when to be there, and the doors.
 */
export function ReadyMastheadMeta({
  facts,
  locale,
  now,
  t,
  dateActions,
}: {
  facts: MastheadFacts;
  locale: string;
  now: Date;
  t: DiverTranslator;
  dateActions?: ReactNode;
}) {
  return (
    <>
      <MastheadWhen facts={facts} locale={locale} now={now} />
      {dateActions}
      {/* The one number that matters on the morning of the trip, a shade
          stronger than the date line, never shouting. "Today" is said once,
          on the date line (visual review 2026-10-24, B24); "Today’s the
          day." under it said it twice. */}
      <p className="mt-1 text-base font-medium">{mastheadArrivalLine(facts, locale, t)}</p>
      <MastheadDoors facts={facts} t={t} />
    </>
  );
}

/**
 * **The booked card** (UX review 2026-10-10, items 7 and 34).
 *
 * After a booking POST this card *is* the top of the page, in place of the
 * masthead, the way the recap opens on "Welcome back, Priya": the shop's name
 * over "You've got a seat, Priya", then the departure, when, and when to be
 * at the dock. Every fact on it comes from the booking's own row, so it paints
 * in the first response while the thread streams in under it, and the thread
 * opens with the one next step directly below.
 *
 * The Logbook register: no final period or exclamation mark, no confetti,
 * no emoji, and the thread's one coral moment (ADR 20260827-the-divers-thread,
 * decision 6) spent here rather than on a separate panel under a masthead that
 * already said the same date twice. It is the page's `<h1>`, because it is the
 * page's opening.
 */
export function ReadyBookedHeader({
  facts,
  greetingName,
  milestone = null,
  locale,
  now,
  t,
  dateActions,
  children,
}: {
  facts: MastheadFacts;
  /** The name the booking greets, already resolved (a held identity greets the name it booked as). */
  greetingName: string;
  /**
   * This seat is the diver's 10th, 25th, 50th or 100th boat with the shop
   * (H-128): said once, as a count, under the arrival line. Null otherwise.
   */
  milestone?: DiveDayMilestone | null;
  locale: string;
  now: Date;
  t: DiverTranslator;
  dateActions?: ReactNode;
  /** Anything that belongs under the card and above the thread. */
  children?: ReactNode;
}) {
  const firstName = firstNameOf(greetingName, t("ready.namelessFallback"));
  return (
    <header>
      <EarnedMoment
        as="h1"
        eyebrow={facts.shop.name}
        title={t("booking.confirmedHeading", { name: firstName })}
      >
        <p className="font-semibold text-foreground">{bindTitleDash(facts.trip.title)}</p>
        <BookedWhen facts={facts} locale={locale} now={now} />
        {dateActions}
        <p className="mt-1 font-medium text-foreground">{mastheadArrivalLine(facts, locale, t)}</p>
        {milestone ? (
          <p className="mt-1">
            {t("booking.milestoneDay", {
              ordinal: formatOrdinal(milestone, locale),
              shopName: facts.shop.name,
            })}
          </p>
        ) : null}
      </EarnedMoment>
      <MastheadDoors facts={facts} t={t} />
      {children}
    </header>
  );
}

/**
 * **"Tomorrow · Sun, Oct 11 · 7:00 AM – 10:30 AM EDT"** — the relative day
 * first (UX review 2026-10-10, item 8).
 *
 * It used to trail ("… EDT · tomorrow"), and on a phone the line wrapped so
 * that "· tomorrow" stood alone on a line of its own: a dangling bullet that
 * looked broken, on the one word a diver scans the top of this page for. First,
 * it is the line's lead and can never orphan. `Intl.RelativeTimeFormat` writes
 * it in lower case for a phrase's middle, so its first letter is raised in the
 * reader's own locale. *
 * The time range is unbreakable: at 390 the line broke inside it ("7:00 AM" /
 * "– 10:30 AM EDT", fourth review, item 48). The line may still wrap, but only
 * at the separator before the range.
 */
export function MastheadWhen({
  facts,
  locale,
  now,
}: {
  facts: MastheadFacts;
  locale: string;
  now: Date;
}) {
  const { day, hours } = mastheadWhenParts(facts, locale, now);
  return (
    <p className="mt-1 text-base text-muted">
      {day} · <span className="whitespace-nowrap">{hours}</span>
    </p>
  );
}

/**
 * **The booked card's when, on two lines** (#2504). The page a diver
 * screenshots for the dock wrapped its one line inside the time range at 390
 * ("7:00" / "AM to 11:30 AM"); the day and date take a line, and the whole
 * range the next, unbreakable.
 */
function BookedWhen({ facts, locale, now }: { facts: MastheadFacts; locale: string; now: Date }) {
  const { day, hours } = mastheadWhenParts(facts, locale, now);
  return (
    <p className="mt-1">
      <span className="block">{day}</span>
      <span className="block whitespace-nowrap">{hours}</span>
    </p>
  );
}

/**
 * The whole booked opening: the provider, the thread's shell with the card as
 * its header, and the thread itself (`children`, streamed) under it. The page
 * renders this only while the card is true (`getBookedCard` found a live booking on a departure still to sail).
 */
export function ReadyBookedPage({
  card,
  locale,
  dateActions,
  children,
}: {
  card: MastheadFacts & { greetingName: string; milestone?: DiveDayMilestone | null };
  locale: DiverLocale;
  dateActions?: ReactNode;
  children: ReactNode;
}) {
  const t = diverTranslator(locale);
  return (
    <DiverIntlProvider
      locale={locale}
      timeZone={card.shop.timezone}
      namespaces={["rental", "common", "trip"]}
    >
      <ThreadShell
        header={
          <ReadyBookedHeader
            facts={card}
            greetingName={card.greetingName}
            milestone={card.milestone ?? null}
            locale={locale}
            now={nowDate()}
            t={t}
            dateActions={dateActions}
          />
        }
      >
        {children}
      </ThreadShell>
    </DiverIntlProvider>
  );
}

/** The full thread and narrow booked card use the same masthead facts. */
export function ReadyThreadMasthead({
  data,
  locale,
  t,
  dateActions,
}: {
  data: ReadyPageData;
  locale: string;
  t: DiverTranslator;
  dateActions?: ReactNode;
}) {
  return (
    <ReadyMastheadMeta
      facts={{
        shop: {
          name: data.detail.shop.name,
          slug: data.shop.slug,
          timezone: data.detail.shop.timezone,
          dockCallMinutes: data.shop.dockCallMinutes,
        },
        trip: data.detail.trip,
        pickup: { time: data.pickupTime, location: data.hotelPickupLocation },
      }}
      locale={locale}
      now={nowDate()}
      t={t}
      dateActions={dateActions}
    />
  );
}

/** Keep every client thread child under the same provider as the booked opening. */
export function ReadyThreadPage({
  data,
  locale,
  t,
  dateActions,
  children,
}: {
  data: ReadyPageData;
  locale: DiverLocale;
  t: DiverTranslator;
  dateActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DiverIntlProvider
      locale={locale}
      timeZone={data.detail.shop.timezone}
      namespaces={["rental", "common", "trip"]}
    >
      <ThreadShell
        shopName={data.detail.shop.name}
        title={data.detail.trip.title}
        meta={<ReadyThreadMasthead data={data} locale={locale} t={t} dateActions={dateActions} />}
      >
        {children}
      </ThreadShell>
    </DiverIntlProvider>
  );
}
