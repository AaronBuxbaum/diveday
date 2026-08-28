import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { DaySpine } from "@/app/shop/[shopSlug]/_components/today/DaySpine";
import { FirstBookableCard } from "@/app/shop/[shopSlug]/_components/today/FirstBookableCard";
import { FirstRunChecklist } from "@/app/shop/[shopSlug]/_components/today/FirstRunChecklist";
import {
  RoleOrientationCard,
  RoleOrientationLine,
} from "@/app/shop/[shopSlug]/_components/today/RoleOrientationCard";
import { YourSessions } from "@/app/shop/[shopSlug]/_components/today/YourSessions";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { inHorizonReadiness } from "@/db/blockers";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { shopHasEverTakenAnOrder } from "@/db/orders";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getTodayWork } from "@/db/today";
import { countShopTrips } from "@/db/trips";
import { dismissOrientation, isOrientationDismissed } from "@/db/user-accounts";
import {
  orientationRoleFor,
  orientationTourHref,
  orientationTourText,
} from "@/i18n/orientation-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { daySpineSummaryText, GREETING_KEYS } from "@/i18n/today-labels";
import { trackEvent } from "@/lib/analytics";
import { canViewShopReports } from "@/lib/authz";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { formatShortDate, formatTime } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { FIRST_RUN_STEP_COUNT } from "@/lib/onboarding";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  ACTION_KIND_META,
  anyBoatIsIn,
  assembleDaySpine,
  type DayStation,
  getTimeOfDayGreeting,
  lastBoatIsIn,
  roleLensFor,
  spineIsQuiet,
  spineJobCount,
  type TodayAction,
} from "@/lib/today";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { inviteWaitlistAction } from "./trips/[id]/actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
// These are the explanatory landings for authorization refusals elsewhere in
// the app that redirect a non-owner/manager back to Today (task 82, UX
// persona 11 "Kai") rather than teleporting silently.
const AUTH_NOTICES: Record<string, StaffMessageKey> = {
  "waivers-not-authorized": "shopHome.notice.waiversNotAuthorized",
  "export-not-authorized": "shopHome.notice.exportNotAuthorized",
  "reports-not-authorized": "shopHome.notice.reportsNotAuthorized",
  "requests-not-authorized": "shopHome.notice.requestsNotAuthorized",
  "settings-not-authorized": "shopHome.notice.settingsNotAuthorized",
  // These four used to land on Settings, which was the nearest parent that
  // could explain them. Settings is owner/manager work now, and every one of
  // these gates is the *same* owner/manager gate — so a staffer refused there
  // is refused from Settings too, and landing them on it meant a second bounce
  // that dropped their reason on the floor. They land here instead, where the
  // reason survives.
  "team-not-authorized": "shopHome.notice.teamNotAuthorized",
  "import-not-authorized": "shopHome.notice.importNotAuthorized",
  "gear-import-not-authorized": "shopHome.notice.gearImportNotAuthorized",
  "backup-not-authorized": "shopHome.notice.backupNotAuthorized",
  "whatsapp-not-authorized": "shopHome.notice.whatsappNotAuthorized",
  "promos-not-authorized": "shopHome.notice.promosNotAuthorized",
  "integrations-not-authorized": "shopHome.notice.integrationsNotAuthorized",
};

export const metadata: Metadata = {
  title: "Today — DiveDay",
};

/**
 * How long after its scheduled departure a boat still counts as "not away
 * yet" — the standing late-arrival buffer every "has it sailed" question in
 * this app carries, because trips run late.
 */
const DEPARTURE_BUFFER_MS = HOUR_MS;

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
  }>;
}) {
  // The session and the two route-param promises don't depend on one
  // another — resolve them together instead of serially.
  const [session, { shopSlug }, { created, series, reset, email, notice }] = await Promise.all([
    requireStaffSession(),
    params,
    searchParams,
  ]);
  const seriesCount = series ? Number.parseInt(series, 10) : 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["created", "series", "reset", "email", "notice"]} />
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
        />
      </Suspense>
    </main>
  );
}

/** Rows a staffer could still act on before a boat leaves. */
function pressingRows(rows: readonly TodayAction[]): number {
  return rows.filter((row) => ACTION_KIND_META[row.kind].tone !== "neutral").length;
}

/**
 * Noon on the shop's *next* calendar day, in its own zone — the instant the
 * second bounded `getTodayWork` call reads tomorrow's shop-day from.
 *
 * Noon rather than midnight so a daylight-saving jump cannot land it on the
 * wrong side of the boundary it is naming, and the shop's zone rather than the
 * server's because "tomorrow" is a fact about where the boat sails from.
 */
function tomorrowNoon(now: Date, timeZone: string): Date {
  const wall = utcToWallTime(now, timeZone);
  const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1));
  return wallTimeToUtc(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: 12,
      minute: 0,
    },
    timeZone,
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
}: {
  session: Awaited<ReturnType<typeof requireStaffSession>>;
  shopSlug: string;
  created?: string;
  seriesCount: number;
  reset?: string;
  email?: string;
  notice?: string;
}) {
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  // A session pointing at a shop row that is gone is a page that does not
  // exist, not a blank 200. Settled on `notFound()` app-wide alongside
  // `requireShopSurface` (src/lib/session.ts); this body cannot use that helper
  // itself because it runs inside the page's `<Suspense>` boundary, with the
  // session already resolved above it.
  if (!shop) notFound();
  const t = staffTranslator(locale);
  // `Object.hasOwn`, not `AUTH_NOTICES[notice]`: `notice` is an attacker-supplied
  // query param, and a bare lookup resolves `?notice=constructor` off the
  // prototype (src/lib/staff-notices.ts).
  const authNoticeKey = noticeFromParam(notice, AUTH_NOTICES);

  const now = nowDate();
  // The lens (20260721-role-aware-landing): a captain or divemaster's Today
  // filters to boat work and badges the boat they crew; an instructor's leads
  // with their sessions. It never re-orders the spine — clock order wins.
  const lens = roleLensFor(session.user.roles);
  // One readiness pass for the whole horizon, shared by both shop-day reads
  // below. It costs about ten queries; running it twice would double the
  // page's entire database bill for one collapsed disclosure.
  const evidence = await inHorizonReadiness(db, shop.id, now);
  const work = await getTodayWork(
    db,
    shop.id,
    shopSlug,
    shop.timezone,
    now,
    lens ? session.user.personId : undefined,
    t,
    locale,
    // Stuck Stripe operations and failed photo deletions are owner/manager
    // chores — same gate as Reports (task 157).
    canViewShopReports(session.user.roles),
    evidence,
    shop.diversPerDivemaster,
    session.user.roles,
  );
  // Tomorrow, read the same bounded way rather than by widening today's
  // window: same reader, same evidence, one shop-day later. Only its
  // *departures* are used — the jobs behind the disclosure are today's own
  // ranked queue, re-filed, so a job is counted exactly once wherever its boat
  // happens to sail.
  const tomorrowWork = await getTodayWork(
    db,
    shop.id,
    shopSlug,
    shop.timezone,
    tomorrowNoon(now, shop.timezone),
    undefined,
    t,
    locale,
    false,
    evidence,
    shop.diversPerDivemaster,
    session.user.roles,
  );
  const { actions, withheldCount, nextDeparture, crewedTripIds, crewedSessions } = work;
  const spine = assembleDaySpine(work, tomorrowWork);
  // Real shops only — the demo shop already teaches its own tour via the
  // role switcher banner, and a dismissal there would be meaningless (every
  // demo visit signs in as a fresh, credential-shared session).
  const orientationRole = shop.isDemo ? null : orientationRoleFor(session.user.roles);
  async function dismissOrientationAction() {
    "use server";
    const staff = await requireStaffSession();
    await dismissOrientation(await getDb(), staff.user.personId);
    revalidateAndRedirect(`/shop/${staff.user.shopSlug}`);
  }
  // **First run is "never had a departure", not "none coming up".**
  //
  // `nextDeparture` is null in three different situations, and only one of them
  // is a new shop: `getTodayWork` hands it back *only when nothing sails today*
  // (`src/db/today.ts`), so a shop whose boat left this morning read as
  // identical to a shop that had never opened. So `!nextDeparture` stays only
  // as the cheap prefilter it can honestly be — a shop with no trips has none
  // upcoming — and the count is what decides.
  //
  // **A demo shop is excluded, and that is the right call rather than an
  // oversight** (the second question in issue #806): a minted demo arrives with
  // every setup step already done, so the ledger would open on ticked boxes and
  // a call to action nobody needs.
  const totalTrips = !shop.isDemo && !nextDeparture ? await countShopTrips(db, shop.id) : null;
  const showFirstRunChecklist = totalTrips === 0;
  const [firstRunDiveSites, firstRunStripeAccount] = showFirstRunChecklist
    ? await Promise.all([listDiveSites(db, shop.id), getShopStripeAccount(db, shop.id)])
    : [null, null];
  // A first-run shop gets one quiet progress fact, derived from persisted
  // records. The trip and public-link rows are guided actions, not completion
  // states, so they are intentionally excluded from the progress total.
  const firstRunDoneCount = [
    Boolean(shop.contactEmail || shop.contactPhone),
    Boolean(shop.tagline || shop.description || shop.logoUrl),
    Boolean(shop.unitsConfirmedAt),
    Boolean(firstRunDiveSites?.length),
    canAcceptPayments(firstRunStripeAccount),
  ].filter(Boolean).length;
  // The desk group's one presence-derived row (ADR 20260827-first-light,
  // decision 6): the shop has departures, cannot take money online, and has
  // never taken an order at all. Two bounded reads, and only for a shop past
  // its first run — a shop still setting up is being asked about Stripe by the
  // ledger above, and saying it twice on one screen buys nothing.
  const paymentsRowCandidate = !shop.isDemo && !showFirstRunChecklist;
  const [paymentsAccount, hasEverTakenAnOrder] = paymentsRowCandidate
    ? await Promise.all([getShopStripeAccount(db, shop.id), shopHasEverTakenAnOrder(db, shop.id)])
    : [null, true];
  const showPaymentsRow =
    paymentsRowCandidate && !canAcceptPayments(paymentsAccount) && !hasEverTakenAnOrder;
  const showOrientation =
    orientationRole !== null &&
    !showFirstRunChecklist &&
    !(await isOrientationDismissed(db, session.user.personId));
  // The first departure ever landing on the board is the moment this shop
  // became bookable — and the moment the setup ledger above leaves the page.
  // Exactly then, the created notice grows into a share card so the link worth
  // sending is on screen when it first means something. "First" is exact:
  // right after a first creation the shop's total equals what was just created
  // (1, or the series size). Demo shops sit out — their board is seeded, so no
  // trip there is ever a first.
  const firstBookableMoment =
    Boolean(created) &&
    !shop.isDemo &&
    (totalTrips ?? (await countShopTrips(db, shop.id))) === Math.max(seriesCount, 1);
  const shareOrigin = showFirstRunChecklist || firstBookableMoment ? publicAppUrl() : null;
  const publicScheduleUrl = shareOrigin
    ? new URL(publicSchedulePath(shopSlug), `${shareOrigin}/`).toString()
    : publicSchedulePath(shopSlug);
  // Blocker frequency, after the response so it never delays the queue: how many
  // divers still can't board today, and how many jobs are urgent right now.
  const blockedToday = work.departures.reduce((sum, departure) => sum + departure.blocked, 0);
  const urgentJobs = actions.filter((action) => action.urgency === "now").length;
  after(() => trackEvent({ name: "blockers_surfaced", count: blockedToday, urgent: urgentJobs }));
  const firstName = session.user.name?.split(" ")[0] ?? "there";
  // The next boat that has not gone yet, carrying the standing one-hour
  // late-arrival buffer every "has it sailed" question in this app carries.
  const nextStation: DayStation | undefined = spine.stations.find(
    (station) => station.startsAt.getTime() + DEPARTURE_BUFFER_MS > now.getTime(),
  );
  // "3 boats today. 2 things need you before the 7:00 AM leaves the dock." The
  // count is what is still open on the boat the sentence names, because that
  // is what "before it leaves" means; once every boat is away it counts what
  // is open across the day instead.
  const daySummaryText = showFirstRunChecklist
    ? null
    : daySpineSummaryText(t, {
        boats: spine.stations.length,
        jobs: nextStation
          ? pressingRows(nextStation.rows)
          : spine.stations.reduce((total, station) => total + pressingRows(station.rows), 0) +
            pressingRows(spine.desk),
        nextDepartureTime: nextStation
          ? formatTime(nextStation.startsAt, locale, shop.timezone)
          : null,
      });
  // The whole page is empty at once, and collapses to a heading, one sentence
  // and the one act available — never a spine of empty groups. The rule and
  // the reason a desk row cancels the collapse live with the spine
  // (`spineIsQuiet`); first-run is a different page and answers to its own
  // condition.
  const quietDay = !showFirstRunChecklist && spineIsQuiet(spine, showPaymentsRow);
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
      <ShopPageHeader
        // The destination first, then the day. The date alone was the one
        // thing on this page that could confirm you had arrived, and it named
        // a *when* rather than a *where* (issue #824).
        eyebrow={`${t(STAFF_DESTINATION_LABEL_KEYS.today)} · ${formatShortDate(now, locale, shop.timezone)}`}
        title={
          quietDay
            ? t("shopHome.spine.quietHeading")
            : t(GREETING_KEYS[getTimeOfDayGreeting(now, shop.timezone)], { name: firstName })
        }
        meta={
          <>
            {/* One sentence. No sentence at all for a shop still in first-run:
                "No boats out today" is right for a quiet Tuesday and wrong for
                a shop that has never had a board, and anything else here would
                restate the setup ledger directly beneath it (issue #711). */}
            {quietDay ? (
              <p className="max-w-2xl text-lg text-muted">{t("shopHome.spine.quietSentence")}</p>
            ) : daySummaryText ? (
              <p className="max-w-2xl text-lg text-muted">{daySummaryText}</p>
            ) : null}
            {/* A day with no boats answers its follow-up question right here. */}
            {spine.stations.length === 0 && nextDeparture ? (
              <p className="mt-1 max-w-2xl text-muted">
                {t.rich("shopHome.nextDeparture", {
                  link: (chunks) => (
                    <Link
                      href={`/shop/${shopSlug}/trips/${nextDeparture.tripId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                  title: nextDeparture.title,
                  date: formatShortDate(nextDeparture.startsAt, locale, shop.timezone),
                  time: formatTime(nextDeparture.startsAt, locale, shop.timezone),
                })}
              </p>
            ) : null}
            {/* Nothing on the books at all (and past first-run, whose ledger
                owns "schedule your first trip"): one teaching sentence and the
                door, not a boxed section. */}
            {spine.stations.length === 0 && !nextDeparture && !showFirstRunChecklist ? (
              <p className="mt-1 max-w-2xl text-muted">
                {quietDay ? null : <>{t("shopHome.noDeparturesEmpty")} </>}
                <Link
                  href={`/shop/${shopSlug}/schedule/board?add=1`}
                  className="font-medium text-primary hover:underline"
                >
                  {t("shopHome.scheduleTrip")}
                </Link>
              </p>
            ) : null}
            {/* **Live-only, and it should say so.** This board is read straight
                from the server every render — the boat has an encrypted device
                copy, this does not — so a dropped signal means the counts, the
                crew line and the blocked names are whatever they were when the
                signal went (issue #819). */}
            <ConnectivityStatus
              offlineLabel={t("shopHome.offlineLabel")}
              onlyWhenOffline
              className="mt-2"
              copy={{
                online: t("shared.connectivity.online"),
                onlineTitle: t("shared.connectivity.onlineTitle"),
                offlineTitle: t("shared.connectivity.offlineTitle"),
              }}
            />
          </>
        }
      />

      {created && firstBookableMoment ? (
        <FirstBookableCard
          scheduleUrl={publicScheduleUrl}
          scheduleHref={publicSchedulePath(shopSlug)}
          copy={{
            heading:
              seriesCount > 1
                ? t("shopHome.firstBookable.headingSeries", {
                    title: created,
                    count: seriesCount,
                  })
                : t("shopHome.firstBookable.heading", { title: created }),
            body: t("shopHome.firstBookable.body"),
            linkLabel: t("shopHome.firstBookable.linkLabel"),
            copy: t("shopHome.firstRun.scheduleCopy"),
            copied: t("shopHome.firstRun.scheduleCopied"),
            copyFailed: t("shopHome.firstRun.scheduleCopyFailed"),
            viewAsDiver: t("shopHome.firstBookable.viewAsDiver"),
          }}
        />
      ) : null}

      {/* One notice surface. A visit rarely carries more than one of these;
          when it does, they read as one stack of arrivals rather than four
          competing banners. */}
      {(created && !firstBookableMoment) || reset || email || authNoticeKey ? (
        <div className="mb-6 flex flex-col gap-2">
          {created && !firstBookableMoment ? (
            <ShopNotice>
              {seriesCount > 1
                ? t("shopHome.createdNotice.series", { title: created, count: seriesCount })
                : t("shopHome.createdNotice.single", { title: created })}
            </ShopNotice>
          ) : null}
          {reset ? <ShopNotice tone="neutral">{t("shopHome.demoReset")}</ShopNotice> : null}
          {email ? (
            // A failed send must announce itself (noticeRole: danger → alert);
            // without a role this read as ambient status to screen readers.
            <ShopNotice
              tone={email === "sent" ? "success" : "danger"}
              role={noticeRole(email === "sent" ? "success" : "danger")}
            >
              {email === "sent" ? t("shopHome.emailResent") : t("shopHome.emailFailed")}
            </ShopNotice>
          ) : null}
          {authNoticeKey ? (
            <ShopNotice tone="warning" role="status">
              {t(authNoticeKey)}
            </ShopNotice>
          ) : null}
        </div>
      ) : null}

      {/* Orientation earns its size from the day. On a Today with nothing to
          show it is the full card; the moment there is real work or a boat on
          the spine, it compresses to one quiet line. */}
      {showOrientation && orientationRole
        ? (() => {
            // One href rule and one dismissal for both forms — only the words
            // and the chrome differ between the card and the line.
            const tourHref = orientationTourHref(
              shopSlug,
              orientationRole,
              nextDeparture
                ? `/shop/${shopSlug}/trips/${nextDeparture.tripId}/manifest`
                : undefined,
            );
            const tourText = orientationTourText(t, orientationRole);
            return hasWorkToShow ? (
              <RoleOrientationLine
                tourHref={tourHref}
                dismissAction={dismissOrientationAction}
                copy={{
                  heading: t("shopHome.orientation.lineHeading"),
                  dismiss: t("shopHome.orientation.dismiss"),
                  tryThis: tourText.tryThis,
                }}
              />
            ) : (
              <RoleOrientationCard
                tourHref={tourHref}
                dismissAction={dismissOrientationAction}
                copy={{
                  heading: t("shopHome.orientation.heading"),
                  tryLabel: t("shopHome.orientation.tryLabel"),
                  dismiss: t("shopHome.orientation.dismiss"),
                  ...tourText,
                }}
              />
            );
          })()
        : null}

      {showFirstRunChecklist ? (
        <FirstRunChecklist
          shopSlug={shopSlug}
          // No configured APP_HOST (local dev, some test environments) means no
          // origin to build an absolute URL from — `publicScheduleUrl` falls
          // back to the path alone rather than crash the page on a bad base URL.
          scheduleUrl={publicScheduleUrl}
          contactDone={Boolean(shop.contactEmail || shop.contactPhone)}
          profileDone={Boolean(shop.tagline || shop.description || shop.logoUrl)}
          diveSiteCount={firstRunDiveSites?.length ?? 0}
          unitsDone={Boolean(shop.unitsConfirmedAt)}
          stripeDone={canAcceptPayments(firstRunStripeAccount)}
          copy={{
            heading: t("shopHome.firstRun.heading"),
            subtitle: t("shopHome.firstRun.subtitle", { count: FIRST_RUN_STEP_COUNT }),
            progress: t("shopHome.firstRun.progress", {
              done: firstRunDoneCount,
              total: FIRST_RUN_STEP_COUNT,
            }),
            contactTitle: t("shopHome.firstRun.contactTitle"),
            contactBody: t("shopHome.firstRun.contactBody"),
            contactAction: t("shopHome.firstRun.contactAction"),
            contactDone: t("shopHome.firstRun.contactDone"),
            profileTitle: t("shopHome.firstRun.profileTitle"),
            profileBody: t("shopHome.firstRun.profileBody"),
            profileAction: t("shopHome.firstRun.profileAction"),
            profileDone: t("shopHome.firstRun.profileDone"),
            unitsTitle: t("shopHome.firstRun.unitsTitle"),
            unitsBody: t("shopHome.firstRun.unitsBody", {
              currency: shop.currency.toUpperCase(),
              depth: t(
                shop.depthUnit === "feet"
                  ? "shopHome.firstRun.unitsFeet"
                  : "shopHome.firstRun.unitsMeters",
              ),
            }),
            unitsAction: t("shopHome.firstRun.unitsAction"),
            unitsDone: t("shopHome.firstRun.unitsDone"),
            siteTitle: t("shopHome.firstRun.siteTitle"),
            siteBody: t("shopHome.firstRun.siteBody"),
            siteAction: t("shopHome.firstRun.siteAction"),
            siteDone: t("shopHome.firstRun.siteDone", { count: firstRunDiveSites?.length ?? 0 }),
            tripTitle: t("shopHome.firstRun.tripTitle"),
            tripBody: t("shopHome.firstRun.tripBody"),
            tripAction: t("shopHome.firstRun.tripAction"),
            scheduleTitle: t("shopHome.firstRun.scheduleTitle"),
            scheduleBody: t("shopHome.firstRun.scheduleBody"),
            scheduleCopy: t("shopHome.firstRun.scheduleCopy"),
            scheduleCopied: t("shopHome.firstRun.scheduleCopied"),
            scheduleCopyFailed: t("shopHome.firstRun.scheduleCopyFailed"),
            stripeTitle: t("shopHome.firstRun.stripeTitle"),
            stripeBody: t("shopHome.firstRun.stripeBody"),
            stripeAction: t("shopHome.firstRun.stripeAction"),
            stripeDone: t("shopHome.firstRun.stripeDone"),
            doneBadge: t("shopHome.firstRun.doneBadge"),
          }}
        />
      ) : quietDay ? null : (
        <DaySpine
          spine={spine}
          shopSlug={shopSlug}
          shopName={shop.name}
          locale={locale}
          timeZone={shop.timezone}
          currency={shop.currency}
          crewedTripIds={lens === "boat" ? crewedTripIds : undefined}
          withheldCount={withheldCount}
          inviteAction={inviteWaitlistAction.bind(null, shopSlug)}
          showPaymentsRow={showPaymentsRow}
          now={now}
          sessions={
            lens === "sessions" ? (
              <YourSessions
                locale={locale}
                sessions={crewedSessions}
                shopSlug={shopSlug}
                timeZone={shop.timezone}
              />
            ) : null
          }
        />
      )}

      {/* The evening handoff, after the spine — writing the day up is what
          comes *after* the work, and on the evenings it matters the stations
          above it have thinned to nothing.

          It keys on **any** boat being back (`anyBoatIsIn`), not all of them:
          an evening with a night dive still on the board, or a boat running
          late, is when someone starts writing the day up
          (FU-20260811-close-out-has-one-conditional-door). `lastBoatIsIn` then
          picks the words, because "the last boat is in" is a sentence that must
          not be said over a boat still at sea. Closing is a ritual, never a
          gate (ADR 20260804-day-closeout) — nothing here nags. */}
      {anyBoatIsIn(work.departures, now) ? (
        <section
          aria-labelledby="close-out-handoff-heading"
          className="mt-10 rounded-2xl border border-border bg-surface p-5 sm:p-6"
        >
          <h2 id="close-out-handoff-heading" className="text-lg font-semibold">
            {lastBoatIsIn(work.departures, now)
              ? t("shopHome.closeOut.heading")
              : t("shopHome.closeOut.headingBoatStillOut")}
          </h2>
          <p className="mt-1 text-muted">
            {lastBoatIsIn(work.departures, now)
              ? t("shopHome.closeOut.body")
              : t("shopHome.closeOut.bodyBoatStillOut")}
          </p>
          <Link
            href={`/shop/${shopSlug}/close-out`}
            className={buttonClass({ variant: "secondary", className: "mt-4" })}
          >
            {t("shopHome.closeOut.action")}
          </Link>
        </section>
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
            className="grid grid-cols-1 gap-y-2 sm:grid-cols-[96px_40px_1fr] sm:gap-y-0"
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
