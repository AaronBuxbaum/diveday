import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { DayHeader } from "@/app/shop/[shopSlug]/_components/day/DayHeader";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ArrivalLookup } from "@/app/shop/[shopSlug]/_components/today/ArrivalLookup";
import {
  DaySpine,
  type EveningReading,
  type SpineDraft,
} from "@/app/shop/[shopSlug]/_components/today/DaySpine";
import { FirstRunChecklist } from "@/app/shop/[shopSlug]/_components/today/FirstRunChecklist";
import { firstRunChecklistCopy } from "@/app/shop/[shopSlug]/_components/today/first-run-copy";
import { QuietDay } from "@/app/shop/[shopSlug]/_components/today/QuietDay";
import { ReleaseStillSample } from "@/app/shop/[shopSlug]/_components/today/ReleaseStillSample";
import { recapEditorsFor } from "@/app/shop/[shopSlug]/_components/today/recap-editors";
import { TodayFirstBookable } from "@/app/shop/[shopSlug]/_components/today/TodayFirstBookable";
import { TodayHeaderNotes } from "@/app/shop/[shopSlug]/_components/today/TodayHeaderNotes";
import { TodayNoticeStack } from "@/app/shop/[shopSlug]/_components/today/TodayNoticeStack";
import { TodayOrientation } from "@/app/shop/[shopSlug]/_components/today/TodayOrientation";
import { TodayPrintDoor } from "@/app/shop/[shopSlug]/_components/today/TodayPrintDoor";
import { TodayUpdated } from "@/app/shop/[shopSlug]/_components/today/TodayUpdated";
import {
  readTodayFirstWave,
  readTodaySecondWave,
} from "@/app/shop/[shopSlug]/_components/today/today-reads";
import { YourSessions } from "@/app/shop/[shopSlug]/_components/today/YourSessions";
import { YourWeek } from "@/app/shop/[shopSlug]/_components/today/YourWeek";
import { FlashParams } from "@/components/FlashParams";
import { daySummaryBlocked } from "@/db/blockers";
import { getDb } from "@/db/client";
import { loadFirstRunFacts } from "@/db/first-run";
import type { ConfirmRentalFitOutcome } from "@/db/rental-fit";
import { shopByIdCached } from "@/db/shops";
import { canAcceptPayments } from "@/db/stripe-accounts";
import { orientationRoleFor } from "@/i18n/orientation-labels";
import { requestLocale } from "@/i18n/request";
import { sendLimitWords } from "@/i18n/shared-sentences";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { daySpineSummaryText } from "@/i18n/today-labels";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { assembleEveningClose } from "@/lib/closeout";
import { FORM_DRAFT_RESUME_SUFFIX } from "@/lib/form-drafts";
import { formatMonthDay, formatTime, formatWeekday } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { reportRenderQueries } from "@/lib/observability/query-timing";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { type NoticeCodeOf, type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import {
  assembleDaySpine,
  factOfScaleFor,
  readNeedsYou,
  roleLensFor,
  spineIsQuiet,
  spineJobCount,
} from "@/lib/today";
import { shopDayBounds, utcToWallTime } from "@/lib/zoned";
import { AUTH_NOTICES } from "./_components/auth-notices";

// `instant = true` asserts that navigating *into* this page paints immediately — this segment's
// `loading.tsx`, with no request read above it. Since the staff shell became synchronous (issue
// 1446) that holds for a cold, direct visit too: the shell's session, shop row and nav stream in
// beside the page from `ShopChrome` rather than above it, so the route gets a static shell and its
// own reads are the only ones the reader waits on. See ADR 20260804-instant-navigation.
export const instant = true;

// A notice param maps to a message key, never a sentence (ADR 20260730-staff-copy-localization).
type EveningNotice = { key: StaffMessageKey; values?: Record<string, string>; tone: NoticeTone };

/**
 * The fit-keep's refusals, in the spelling `noticeUrl` gives them. The tap
 * hands `confirmRentalFitSize`'s answer straight to the query string, so the
 * map below owes words to every member of that union; typing it this way makes
 * a union that grows without copy a compile error rather than a blank page.
 */
type FitKeepRefusalCode = NoticeCodeOf<Exclude<ConfirmRentalFitOutcome, "saved">>;

/** Loose in the keys it accepts, exact in the ones it demands. */
type EveningNoticeMap = Record<string, EveningNotice> & Record<FitKeepRefusalCode, EveningNotice>;

/**
 * The evening's own `?notice=` codes, re-homed here when `/close-out` folded into this page
 * (H-62). Every code is unchanged — a bookmark carrying one still lands on the right words,
 * because the 308 keeps the query and this page answers it. The refusals are why this is a tone
 * table rather than a bare key map: `invalid` is a recap send that failed, a crew photo this
 * departure cannot take, or a fit-keep whose reservation the desk could not re-prove, and
 * `unknown-person` is a fit-keep aimed at a person id that is not this shop's — each has an entry,
 * so no refusal renders as silence.
 */
const EVENING_NOTICES: EveningNoticeMap = {
  "recap-sent": { key: "closeout.notice.recapSent", tone: "success" },
  "recap-send-attention": { key: "closeout.notice.recapAttention", tone: "warning" },
  "recap-not-ready": { key: "closeout.notice.recapNotReady", tone: "neutral" },
  "recap-held": { key: "closeout.notice.recapHeld", tone: "warning" },
  "recap-send-limit": { ...sendLimitWords("recaps"), tone: "warning" },
  "recap-locked": { key: "closeout.notice.recapLocked", tone: "neutral" },
  "recap-photo-removed": { key: "trips.notices.recapPhotoRemoved", tone: "success" },
  "crew-photo-added": { key: "closeout.notice.crewPhotoAdded", tone: "success" },
  "crew-photo-removed": { key: "closeout.notice.crewPhotoRemoved", tone: "success" },
  "crew-photo-limit": { key: "closeout.notice.crewPhotoLimit", tone: "danger" },
  "crew-photo-unconfigured": { key: "closeout.notice.crewPhotoUnsupported", tone: "danger" },
  "crew-photo-failed": { key: "closeout.notice.crewPhotoFailed", tone: "danger" },
  // Where the owner-only departure log lands everyone else. The door is absent
  // from their stations, so this is for a bookmark or a role that changed.
  "log-not-authorized": { key: "incidentExport.ownerOnlyNotice", tone: "neutral" },
  invalid: { key: "closeout.notice.invalid", tone: "danger" },
  // Telling this reader that the person id they reached is not in their own
  // shop is not a cross-tenant oracle: it confirms membership nowhere else.
  "unknown-person": { key: "closeout.notice.unknownPerson", tone: "danger" },
};

export const metadata: Metadata = {
  title: "Today — DiveDay",
};

/**
 * **The shop home is the day's spine** (ADR
 * 20260827-clearwater-surface-language, decision 4).
 *
 * Two questions, in order, exactly as before: can the boats leaving today
 * sail, and who needs me before they do? What changed is where the answer
 * renders. There used to be two views over one set of evidence — ranked by
 * urgency, or grouped by the departure each job held up — selected by `?view=`
 * and switched by a control on the queue. Both are gone. Today's departures
 * are stations in clock order, each carrying its own work, and anything bound
 * to no boat pools under one desk group; tomorrow and the rest of the week
 * collapse to one row each.
 *
 * The ADR rejected a view (or phase) control outright: the clock already
 * knows. A `?view=` therefore no longer selects anything and is not read here
 * — a request carrying one is redirected to the bare home by `src/proxy.ts`,
 * so the canonical URL for this page is `/shop/<slug>` and nothing else.
 */
export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    created?: string;
    series?: string;
    reset?: string;
    email?: string;
    notice?: string;
    noted?: string;
    /** Today's arrival lookup (`ArrivalLookup`). */
    q?: string;
  }>;
}) {
  // The session and the two route-param promises don't depend on one
  // another — resolve them together instead of serially.
  const [session, { shopSlug }, { created, series, reset, email, notice, noted, q }] =
    await Promise.all([requireStaffSession(), params, searchParams]);
  const seriesCount = series ? Number.parseInt(series, 10) : 0;

  return (
    <StaffPage width="full">
      <FlashParams params={["created", "series", "reset", "email", "notice", "noted"]} />
      {/* The queue join is the one real wait on this page; a content-shaped
          fallback keeps a cold nav from reading as a blank hang (principle 1). */}
      <Suspense fallback={<TodaySkeleton />}>
        <TodayBody
          session={session}
          shopSlug={shopSlug}
          created={created}
          seriesCount={seriesCount}
          reset={reset}
          email={email}
          notice={notice}
          noted={noted}
          arrivalQuery={q?.trim() ?? ""}
        />
      </Suspense>
    </StaffPage>
  );
}

async function TodayBody({
  session,
  shopSlug,
  created,
  seriesCount,
  reset,
  email,
  notice,
  noted,
  arrivalQuery,
}: {
  session: Awaited<ReturnType<typeof requireStaffSession>>;
  shopSlug: string;
  created?: string;
  seriesCount: number;
  reset?: string;
  email?: string;
  notice?: string;
  /** A departure whose recap note was just saved; re-opens that station's editor. */
  noted?: string;
  /** What the desk typed into the arrival lookup; `""` for none. */
  arrivalQuery: string;
}) {
  const db = await getDb();
  const shop = await shopByIdCached(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  // A session pointing at a shop row that is gone is a page that does not
  // exist, not a blank 200. Settled on `notFound()` app-wide alongside
  // `requireShopSurface` (src/lib/session.ts); this body cannot use that helper
  // itself because it runs inside the page's `<Suspense>` boundary, with the
  // session already resolved above it.
  if (!shop) notFound();
  // **And the slug has to be this shop's own.** Every other staff page asks
  // `requireShopSurface` for both halves — the session's shop exists, and the
  // URL names it — and this one only ever asked the first, because the staff
  // shell above it asked the second. That shell is now an App Shell (issue
  // 1446): its refusal streams beside this body rather than resolving above
  // it, so a page that relies on it is relying on a race. The consequence is
  // not a cross-tenant read — `getShopById` reads the *session's* shop, so the
  // rows are the reader's own — it is this console rendering under another
  // shop's slug, with all fifteen of its links built from that slug. Refusing
  // is the same answer `requireShopSurface` gives, spelled out here because
  // the helper cannot run inside this boundary.
  if (shop.slug !== shopSlug) notFound();
  reportRenderQueries("/shop/[shopSlug]", after);
  const t = staffTranslator(locale);
  // `Object.hasOwn`, not `AUTH_NOTICES[notice]`: `notice` is an attacker-supplied
  // query param, and a bare lookup resolves `?notice=constructor` off the
  // prototype (src/lib/staff-notices.ts).
  const authNoticeKey = noticeFromParam(notice, AUTH_NOTICES);

  const now = nowDate();
  // Real shops only — the demo shop already teaches its own tour via the role switcher banner, and
  // a dismissal there would be meaningless (every demo visit signs in as a fresh, credential-shared
  // session).
  const orientationRole = shop.isDemo ? null : orientationRoleFor(session.user.roles);
  const season = { month: shop.seasonStartMonth, day: shop.seasonStartDay };
  // **Two waves, not thirteen phases** (code review 2026-10-10, item 2): this wave needs only the
  // shop, the reader and the clock; the next needs its answers. A read a later branch may discard
  // is still started here — each is bounded, and that branch is mostly a first run with no rows.
  const {
    freshDrafts,
    canReadShopMoney,
    evidence,
    arrivalRows,
    counterOpen,
    arrivalElsewhereRows,
    closeout,
    shopTripCount,
    stripeAccount,
    everTakenAnOrder,
    firstBookingRead,
    scale,
    orientationDismissed,
  } = await readTodayFirstWave({
    db,
    shop,
    personId: session.user.personId,
    now,
    arrivalQuery,
    orientationRole,
    season,
  });
  const spineDrafts: SpineDraft[] = freshDrafts.map((draft) => ({
    form: draft.form,
    // Exhaustive by type rather than a ternary: a fourth draft kind added without a door here used
    // to resolve, silently, to the diver form — a "resume" link that opened the wrong page with
    // somebody else's answers in it.
    href: `/shop/${shopSlug}${FORM_DRAFT_RESUME_SUFFIX[draft.form]}`,
  }));
  // The lens (20260721-role-aware-landing): a captain or divemaster's Today filters to boat work
  // and badges the boat they crew; an instructor's leads with their sessions. It never re-orders
  // the spine — clock order wins.
  const lens = roleLensFor(session.user.roles);
  const eveningClose = assembleEveningClose(closeout.departures, now, closeout.tomorrow);
  // **The shop's own calendar day**, as the two UTC instants that bracket it. Four readers below
  // want it — the first-boat-ever question, the day strip's window and ticks, and the day's takings
  // — and it is the host's day for none of them, so it is computed once here rather than per
  // caller.
  const dayBounds = shopDayBounds(now, shop.timezone);
  // The second wave: the queue (needs the readiness pass and money gate) beside the closing reads.
  //
  // Tomorrow is read beside today rather than after it, and only as its departure cards
  // (`getShopDayDepartures`): the jobs behind the disclosure are today's own ranked queue,
  // re-filed, so a job is counted exactly once wherever its boat happens to sail - and a second
  // whole queue, read only to keep its departures, was about forty statements thrown away.
  //
  // Two bounded reads, and only when there is a day to close over: who made the last roll-call mark
  // on each settled boat, and whether this staffer may generate a departure's log at all. The log
  // gate is checked against the database rather than the session's roles so a demotion takes effect
  // at once, and resolved once here rather than per station.
  //
  // **The day's money** (`readDayMoney`): what today made, gated on `canReadShopMoney` (the live
  // role read of the first wave) and the day closing; and the tips on the reader's own boats.
  const { work, tomorrowDepartures, headCountCloses, canOpenLog, sailedBefore, dayMoney } =
    await readTodaySecondWave({
      db,
      shop,
      shopSlug,
      personId: session.user.personId,
      roles: session.user.roles,
      now,
      lens,
      t,
      locale,
      canReadShopMoney,
      evidence,
      eveningClose,
      dayBounds,
    });
  const { actions, nextDeparture, crewedTripIds, crewedSessions } = work;
  const spine = assembleDaySpine(work, { departures: tomorrowDepartures, actions: [] });
  // The day's whole board, clock order — the strip's marks and the count under the date both read
  // it.
  const dayDepartures = [...closeout.departures].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const firstBoatEver = eveningClose.allHome && !sailedBefore;
  // **First run is "never had a departure", not "none coming up"**: `nextDeparture` is null on
  // any day nothing sails (`src/db/today.ts`), so it is only the cheap prefilter and the count
  // decides. A demo shop is excluded (issue #806): it arrives with every step done, and its count
  // is never read. The release step outlives first run (`ReleaseStillSample`, item 21).
  const showFirstRunChecklist = !nextDeparture && shopTripCount === 0;
  // The reads only a first-run shop makes, so the one third wave.
  const firstRun = showFirstRunChecklist ? await loadFirstRunFacts(db, shop, stripeAccount) : null;
  // The desk group's one presence-derived row (ADR 20260827-first-light,
  // decision 6): the shop has departures, cannot take money online, and has
  // never taken an order at all. Two bounded reads, and only for a shop past
  // its first run — a shop still setting up is being asked about Stripe by the
  // ledger above, and saying it twice on one screen buys nothing.
  const paymentsRowCandidate = !shop.isDemo && !showFirstRunChecklist;
  const [paymentsAccount, hasEverTakenAnOrder] = paymentsRowCandidate
    ? [stripeAccount, everTakenAnOrder]
    : [null, true];
  const showPaymentsRow =
    paymentsRowCandidate && !canAcceptPayments(paymentsAccount) && !hasEverTakenAnOrder;
  // **The shop's first booking, while it is still the only one** (ADR 20260827-first-light,
  // decision 6). Skipped in first run (no departures, no bookings) and on a seeded demo board.
  const firstBooking = showFirstRunChecklist ? null : firstBookingRead;
  // **One fact of scale, on the day it is true** (ADR
  // 20260904-reef-all-the-way-down, decision 2, Budget rule 3). A read, never
  // a cache: nothing is stored and nothing is acknowledged, so the sentence
  // ends when the day does. Skipped on a shop still in first run for the same
  // reason as the line above — it has no departures to count. The demo shop
  // keeps it: its board is seeded but its divers are real rows, and a count is
  // not a claim about a first.
  const factOfScale = showFirstRunChecklist
    ? null
    : factOfScaleFor({ seasonStart: season, ...scale });
  // The first departure ever landing on the board is the moment this shop
  // became bookable — and the moment the setup ledger above leaves the page.
  // Exactly then, the created notice grows into a share card so the link worth
  // sending is on screen when it first means something. "First" is exact:
  // right after a first creation the shop's total equals what was just created
  // (1, or the series size). Demo shops sit out — their board is seeded, so no
  // trip there is ever a first.
  const firstBookableMoment =
    Boolean(created) && !shop.isDemo && shopTripCount === Math.max(seriesCount, 1);
  // **One orientation moment at a time.** The shop's first-bookable card and
  // the role orientation are both "you are new here, look at this", and they
  // used to render one directly beneath the other — a tinted panel with a URL
  // box and a copy button, and then a tip line under it. The bookable card
  // happens once in a shop's life and is the better moment, so it wins and the
  // orientation waits for the next visit (it is dismissed per account, not per
  // render, so nothing is lost).
  const showOrientation =
    orientationRole !== null &&
    !showFirstRunChecklist &&
    !(Boolean(created) && firstBookableMoment) &&
    !orientationDismissed;
  const shareOrigin = showFirstRunChecklist || firstBookableMoment ? publicAppUrl() : null;
  const publicScheduleUrl = shareOrigin
    ? new URL(publicSchedulePath(shopSlug), `${shareOrigin}/`).toString()
    : publicSchedulePath(shopSlug);
  // Blocker frequency, after the response so it never delays the queue: how many
  // divers still can't board today, and how many jobs are urgent right now.
  const blockedToday = work.departures.reduce((sum, departure) => sum + departure.blocked, 0);
  const urgentJobs = actions.filter((action) => action.urgency === "now").length;
  after(() => trackEvent({ name: "blockers_surfaced", count: blockedToday, urgent: urgentJobs }));
  // **One reading of Needs you for every role** (UX review 2026-10-10, item 2):
  // the sentence under the date counts the rows of the reader's own list about
  // the boat it names, and the spine is handed the same reading for its count
  // and its all-clear line.
  const blockedFigures = daySummaryBlocked(evidence, shop.timezone, now, work.blockedAboard);
  const needsYou = readNeedsYou(spine, {
    crewedTripIds: lens === "boat" ? crewedTripIds : [],
    readerPersonId: session.user.personId,
    drafts: spineDrafts.length,
    paymentsRow: showPaymentsRow,
    blocked: blockedFigures.blocked,
    now,
  });
  const daySummaryText = showFirstRunChecklist
    ? null
    : daySpineSummaryText(t, {
        // The day's boats, not the queue's: a day whose work is all done still
        // has three boats on it, and the line under the date says what the day
        // *is* before it says what is left of it.
        boats: dayDepartures.length,
        ...blockedFigures,
        jobs: needsYou.dueBeforeNext,
        nextDepartureTime: needsYou.next
          ? formatTime(needsYou.next.startsAt, locale, shop.timezone)
          : null,
      });
  // What today made: the second wave's last read, gated there.
  const dayTakingsReading = dayMoney.takings;
  // The whole page is empty at once, and collapses to a heading, one sentence
  // and the one act available — never a spine of empty groups. Every clause of
  // that rule lives with the spine (`spineIsQuiet`), first-run included: the
  // setup ledger and the quiet-day collapse are exclusive compositions, and
  // saying so there rather than in an `&&` here is what keeps a later caller
  // from composing them by forgetting.
  const quietDay = spineIsQuiet(
    spine,
    showPaymentsRow,
    eveningClose.stations.length,
    showFirstRunChecklist,
  );

  const recapEditors = await recapEditorsFor({ db, shop, closeout, noted, now, locale, t });
  const evening: EveningReading = {
    close: eveningClose,
    takings: dayTakingsReading,
    headCountCloses,
    recapEditors,
    canOpenLog,
    firstEver: firstBoatEver,
  };
  const eveningNotice = noticeFromParam(notice, EVENING_NOTICES);
  // The page's one idea is the work (ADR 20260720-today-work-queue), so
  // instructional content sizes itself against whether any exists: a station,
  // a queue row, or — under the instructor lens — a session block means
  // orientation shrinks to a line rather than pushing that work below the fold.
  const hasWorkToShow =
    spineJobCount(spine) > 0 ||
    spine.stations.length > 0 ||
    (lens === "sessions" && crewedSessions.length > 0);

  return (
    <>
      <DayHeader
        weekday={formatWeekday(now, locale, shop.timezone)}
        date={formatMonthDay(
          utcToWallTime(now, shop.timezone).month,
          utcToWallTime(now, shop.timezone).day,
          locale,
        )}
        // The day in one line, said once. It used to be said twice — the
        // summary under the old greeting and again in the body — and under a
        // sky that is already the day, the second one was a caption on a
        // picture of itself.
        summary={
          showFirstRunChecklist
            ? t("shopHome.firstRun.pageTitle")
            : quietDay
              ? t("shopHome.spine.quietSentence")
              : (daySummaryText ?? "")
        }
        // **The paper day** (N-54). One document holding every departure of
        // today — manifest, emergency card, waiver state, packing list — so a
        // dead tablet costs a printer rather than the day. It is the header's
        // one action rather than a lone link floating right above the first
        // station with nothing beside it, which is where it read as a stray
        // (principle 10: chrome defers, and a control belongs with the page it
        // is about). Only on a day that has boats on it, and never on paper.
        //
        // A link rather than `PrintTripBundleButton`'s form: that one records
        // the click server-side and so has to `window.open`, which a popup
        // blocker can refuse silently — the reason it carries a "your browser
        // blocked it" line. A tap on a real link is a navigation no blocker
        // touches, so there is no refusal here to explain.
        action={
          spine.stations.length > 0 || eveningClose.stations.length > 0 ? (
            <TodayPrintDoor shopSlug={shopSlug} t={t} />
          ) : null
        }
      >
        <TodayHeaderNotes
          shopSlug={shopSlug}
          quietDay={quietDay}
          hasStations={spine.stations.length > 0}
          nextDeparture={nextDeparture}
          showFirstRunChecklist={showFirstRunChecklist}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />
        <TodayUpdated t={t} time={formatTime(now, locale, shop.timezone)} />
      </DayHeader>

      {created && firstBookableMoment ? (
        <TodayFirstBookable
          shopSlug={shopSlug}
          created={created}
          seriesCount={seriesCount}
          publicScheduleUrl={publicScheduleUrl}
          t={t}
        />
      ) : null}

      <TodayNoticeStack
        created={created}
        seriesCount={seriesCount}
        firstBookableMoment={firstBookableMoment}
        reset={reset}
        email={email}
        authNoticeKey={authNoticeKey}
        eveningNotice={eveningNotice}
        t={t}
      />

      {showOrientation && orientationRole ? (
        <TodayOrientation
          shopSlug={shopSlug}
          orientationRole={orientationRole}
          nextDepartureTripId={nextDeparture?.tripId}
          hasWorkToShow={hasWorkToShow}
          t={t}
        />
      ) : null}

      {/* The desk's first question when a diver walks up — which boat? —
          over every departure the counter is open for. Only while some boat
          has someone to check in, or while a lookup is open. */}
      {counterOpen ? (
        <ArrivalLookup
          query={arrivalQuery}
          rows={arrivalRows}
          elsewhere={arrivalElsewhereRows}
          shopSlug={shopSlug}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
        />
      ) : null}

      <ReleaseStillSample
        db={db}
        shop={shop}
        roles={session.user.roles}
        firstRun={showFirstRunChecklist}
        t={t}
      />
      {quietDay ? (
        <QuietDay
          shop={shop}
          nextDeparture={nextDeparture}
          loadOut={eveningClose.tomorrow}
          locale={locale}
          t={t}
        />
      ) : (
        <DaySpine
          context={{
            spine,
            highWind: work.highWind,
            shopSlug,
            mailShopName: shop.name,
            locale,
            timeZone: shop.timezone,
            currency: shop.currency,
            crewedTripIds: lens === "boat" ? crewedTripIds : undefined,
            readerPersonId: session.user.personId,
            drafts: spineDrafts,
            showPaymentsRow,
            firstBooking,
            factOfScale,
            crew: dayMoney.crew,
            evening,
            needsYou,
            now,
            sessions:
              lens === "sessions" ? (
                <YourSessions
                  locale={locale}
                  sessions={crewedSessions}
                  shopSlug={shopSlug}
                  timeZone={shop.timezone}
                />
              ) : null,
            // **The spine's leading group, on the one morning it exists** (ADR
            // 20260827-first-light, decision 6). Composed here rather than inside
            // the spine because the five persisted facts behind it are this
            // page's reads; the spine only decides where the group sits.
            firstRun: firstRun ? (
              <FirstRunChecklist
                shopSlug={shopSlug}
                // No APP_HOST (local dev, some tests) means no origin for an absolute
                // URL: `publicScheduleUrl` falls back to the path rather than crash.
                scheduleUrl={publicScheduleUrl}
                {...firstRun.steps}
                copy={firstRunChecklistCopy(t, shop, {
                  diveSiteCount: firstRun.steps.diveSiteCount,
                  doneCount: firstRun.doneCount,
                })}
              />
            ) : null,
          }}
        />
      )}

      {/* **"Your week"**: the reader's next three departures, on any day, quiet or not, at a
          shop that plans its crew in DiveDay. Any role with an assignment (fourth review, item
          14), minus the sessions "Your sessions" already lists; nothing for nobody rostered. */}
      {shop.crewScheduleEnabled ? (
        <Suspense fallback={null}>
          <YourWeek
            listedTripIds={lens === "sessions" ? crewedSessions.map((row) => row.tripId) : []}
            db={db}
            shopId={shop.id}
            shopSlug={shopSlug}
            personId={session.user.personId}
            timeZone={shop.timezone}
            locale={locale}
            now={now}
            diversPerDivemaster={shop.diversPerDivemaster}
          />
        </Suspense>
      ) : null}
    </>
  );
}

/** Shaped like the header, a station or two, and their rows (principle 1). */
function TodaySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-32 rounded bg-surface-sunken" />
      <div className="mt-2 h-10 w-72 rounded bg-surface-sunken" />
      <div className="mt-3 h-6 w-full max-w-2xl rounded bg-surface-sunken" />

      <div className="mt-11 flex flex-col gap-10">
        {[0, 1].map((station) => (
          <div
            key={`station-${station}`}
            // The station's own three tracks, so the skeleton hands over
            // without the spine shifting under the reader. It had drifted on
            // both counts: 40px in the middle where the mark needs 112, and
            // 96px in the time column that a 12-hour time no longer fits
            // (issue #1112).
            className="grid grid-cols-1 gap-y-2 sm:grid-cols-[112px_112px_1fr] sm:gap-y-0"
          >
            <div className="sm:flex sm:justify-end">
              <div className="h-6 w-20 rounded bg-surface-sunken" />
            </div>
            <div className="hidden sm:block" />
            <div>
              <div className="h-6 w-2/3 max-w-sm rounded bg-surface-sunken" />
              <div className="mt-2 h-4 w-1/2 max-w-xs rounded bg-surface-sunken" />
              <div className="mt-3 h-1 w-full rounded-full bg-surface-sunken" />
              <div className="mt-4 flex flex-col gap-px">
                {[0, 1].map((row) => (
                  <div key={`row-${station}-${row}`} className="h-12 rounded bg-surface-sunken" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
