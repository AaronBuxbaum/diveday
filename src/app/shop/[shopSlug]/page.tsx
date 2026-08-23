import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { DepartureBoard } from "@/app/shop/[shopSlug]/_components/today/DepartureBoard";
import { FirstBookableCard } from "@/app/shop/[shopSlug]/_components/today/FirstBookableCard";
import { FirstRunChecklist } from "@/app/shop/[shopSlug]/_components/today/FirstRunChecklist";
import {
  RoleOrientationCard,
  RoleOrientationLine,
} from "@/app/shop/[shopSlug]/_components/today/RoleOrientationCard";
import { TodayQueue } from "@/app/shop/[shopSlug]/_components/today/TodayQueue";
import { YourSessions } from "@/app/shop/[shopSlug]/_components/today/YourSessions";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getBlockerQueue, inHorizonReadiness } from "@/db/blockers";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
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
import { GREETING_KEYS, summarizeDayText } from "@/i18n/today-labels";
import { trackEvent } from "@/lib/analytics";
import { canViewShopReports } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTime } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { FIRST_RUN_STEP_COUNT } from "@/lib/onboarding";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  anyBoatIsIn,
  getTimeOfDayGreeting,
  lastBoatIsIn,
  leadWithCrewed,
  roleLensFor,
  summarizeDay,
} from "@/lib/today";
import { BlockerGroups } from "./_components/BlockerGroups";
import { isQueueView, type QueueView, QueueViewSwitch } from "./_components/QueueViewSwitch";
import { inviteWaitlistAction, updateTripCrewAction } from "./trips/[id]/actions";

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
  "backup-not-authorized": "shopHome.notice.backupNotAuthorized",
  "whatsapp-not-authorized": "shopHome.notice.whatsappNotAuthorized",
  "promos-not-authorized": "shopHome.notice.promosNotAuthorized",
};

export const metadata: Metadata = {
  title: "Today — DiveDay",
};

/**
 * Today is a work queue, not a dashboard. Two questions, in order: can the
 * boats leaving today sail, and who needs me before they do? Anything a nav
 * click already answers — the schedule, the diver list — is
 * deliberately not repeated here.
 *
 * The queue itself has **two views over one set of evidence**: ranked by
 * urgency (the default), or grouped by the departure each job holds up — what
 * used to be the separate `/blockers` route. That route ran byte-for-byte the
 * same two queries and re-ranked them, which is the "separate attention route"
 * the Today ADR had already rejected; folding it in makes it a sort rather than
 * a rival. Exactly one view renders at a time, chosen server-side from `?view=`
 * so the block count on this page does not grow and the data never forks in the
 * browser.
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
    /** Which queue view; anything unrecognised reads as the urgency default. */
    view?: string;
    /** Page of the by-departure view. Ignored by the urgency view. */
    page?: string;
  }>;
}) {
  // The session and the two route-param promises don't depend on one
  // another — resolve them together instead of serially.
  const [session, { shopSlug }, { created, series, reset, email, notice, view, page }] =
    await Promise.all([requireStaffSession(), params, searchParams]);
  const seriesCount = series ? Number.parseInt(series, 10) : 0;
  const queueView: QueueView = isQueueView(view) ? view : "urgency";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["created", "series", "reset", "email", "notice"]} />
      {/* The queue join is the one real wait on this page; a content-shaped
          fallback keeps a cold nav from reading as a blank hang (principle 1).

          **No `key`.** It used to be keyed on `${view}:${page}`, which made
          every flip of the view switch a *remount*: React threw the whole body
          away — greeting, departure board, queue and all — painted the
          skeleton, and then painted the new view. That flash is what "By
          urgency / By departure causes a full page refresh" was describing, for
          what is one sort of the same evidence. A keyed boundary that suspends
          shows its fallback even inside a transition; an unkeyed one does not,
          so the current view now stays on screen until the next one is ready
          and the document never loses its height. Measured after the change:
          flipping the view from a scroll of 900px leaves the viewport at 900px,
          and `document.scrollHeight` holds steady until the new content lands.
          The boundary still does its real job on a cold arrival. */}
      <Suspense fallback={<TodaySkeleton />}>
        <TodayBody
          session={session}
          shopSlug={shopSlug}
          created={created}
          seriesCount={seriesCount}
          reset={reset}
          email={email}
          notice={notice}
          queueView={queueView}
          queuePage={Number.parseInt(page ?? "", 10)}
        />
      </Suspense>
    </main>
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
  queueView,
  queuePage,
}: {
  session: Awaited<ReturnType<typeof requireStaffSession>>;
  shopSlug: string;
  created?: string;
  seriesCount: number;
  reset?: string;
  email?: string;
  notice?: string;
  queueView: QueueView;
  /** `NaN` for an absent or nonsensical `?page=`; `pageOf` clamps it. */
  queuePage: number;
}) {
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  // A session pointing at a shop row that is gone is a page that does not
  // exist, not a blank 200: `return null` here rendered an empty document with
  // no 404 and nothing to read. Settled on `notFound()` app-wide alongside
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
  // leads with the boat they crew; an instructor's with their sessions.
  const lens = roleLensFor(session.user.roles);
  // When the by-departure view is on screen, both it and the urgency queue
  // need the same in-horizon readiness evidence — run the pipeline (~ten
  // queries) once here and hand it to both, instead of letting each consumer
  // recompute it. On the default view `getTodayWork` runs its own pass.
  const readinessEvidence =
    queueView === "departures" ? await inHorizonReadiness(db, shop.id, now) : undefined;
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
    readinessEvidence,
  );
  const { actions, nextDeparture, crewedTripIds, crewedSessions, availableStaff } = work;
  // Real shops only — the demo shop already teaches its own tour via the
  // role switcher banner, and a dismissal there would be meaningless (every
  // demo visit signs in as a fresh, credential-shared session).
  const orientationRole = shop.isDemo ? null : orientationRoleFor(session.user.roles);
  const showOrientation =
    orientationRole !== null && !(await isOrientationDismissed(db, session.user.personId));
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
  // identical to a shop that had never opened. That shop was shown "Schedule
  // your first trip" — above a board listing the trip it had just scheduled —
  // and, because the checklist suppresses the queue's all-clear panel
  // (`TodayQueue`'s `firstRun`, added in #740), it also lost the one panel
  // saying its roster was in order, on the exact morning that mattered.
  //
  // So `!nextDeparture` stays only as the cheap prefilter it can honestly be —
  // a shop with no trips has none upcoming, so a first-run shop always has a
  // null one — and the count is what decides.
  // **A demo shop is excluded, and that is the right call rather than an
  // oversight** (the second question in issue #806). This checklist is about
  // *setting a shop up* — schedule your first departure, add a dive site,
  // connect Stripe — and a minted demo arrives with all three already done, so
  // it would open on three ticked boxes and a call to action nobody needs. A
  // demo visitor's orientation is the banner above: the role they are viewing
  // as, and a "try this" line per role behind its switcher.
  const totalTrips = !shop.isDemo && !nextDeparture ? await countShopTrips(db, shop.id) : null;
  const showFirstRunChecklist = totalTrips === 0;
  const [firstRunDiveSites, firstRunStripeAccount] = showFirstRunChecklist
    ? await Promise.all([listDiveSites(db, shop.id), getShopStripeAccount(db, shop.id)])
    : [null, null];
  // The first departure ever landing on the board is the moment this shop
  // became bookable — and the moment the checklist above (which carried the
  // public-schedule link) leaves the page. Exactly then, the created notice
  // grows into a share card so the link worth sending is on screen when it
  // first means something. "First" is exact: right after a first creation the
  // shop's total equals what was just created (1, or the series size); any
  // earlier trip means this moment already happened. Demo shops sit out —
  // their board is seeded, so no trip there is ever a first.
  const firstBookableMoment =
    Boolean(created) &&
    !shop.isDemo &&
    (totalTrips ?? (await countShopTrips(db, shop.id))) === Math.max(seriesCount, 1);
  const shareOrigin = showFirstRunChecklist || firstBookableMoment ? publicAppUrl() : null;
  const publicScheduleUrl = shareOrigin
    ? new URL(publicSchedulePath(shopSlug), `${shareOrigin}/`).toString()
    : publicSchedulePath(shopSlug);
  const crewedSet = new Set(crewedTripIds);
  const departures = lens === "boat" ? leadWithCrewed(work.departures, crewedSet) : work.departures;
  // Blocker frequency, after the response so it never delays the queue: how many
  // divers still can't board today, and how many jobs are urgent right now.
  const blockedToday = work.departures.reduce((sum, departure) => sum + departure.blocked, 0);
  const urgentJobs = actions.filter((action) => action.urgency === "now").length;
  after(() => trackEvent({ name: "blockers_surfaced", count: blockedToday, urgent: urgentJobs }));
  const yourBoat =
    lens === "boat"
      ? (departures.find((departure) => crewedSet.has(departure.tripId)) ?? null)
      : null;
  const firstName = session.user.name?.split(" ")[0] ?? "there";
  const daySummaryText = summarizeDayText(
    t,
    summarizeDay(
      actions,
      departures.length,
      departures.reduce((total, departure) => total + departure.blocked, 0),
      showFirstRunChecklist,
    ),
  );
  // The page's one idea is the work (ADR 20260720-today-work-queue), so
  // instructional content sizes itself against whether any exists: a queue
  // row, a boat on today's board, or — under the instructor lens — a session
  // block means orientation shrinks to a line rather than pushing that work
  // below the fold.
  const hasWorkToShow =
    actions.length > 0 ||
    departures.length > 0 ||
    (lens === "sessions" && crewedSessions.length > 0);

  // The by-departure view's own grouping pass, run only when it is the view on
  // screen — the default urgency view must not pay for a query it never
  // renders. It is handed the very `readinessEvidence` `getTodayWork` just
  // consumed, and resolves each fix through the same `BLOCKER_ACTIONS` map,
  // so the two views cannot disagree about who is blocked or about what
  // clears them.
  const blockerQueue =
    queueView === "departures"
      ? await getBlockerQueue(db, shop.id, shopSlug, now, t, readinessEvidence)
      : null;
  // The view is a query param on this page, so every link that changes it —
  // the switch, the by-departure pager — is built here from one rule. Page 1
  // and the default view are both omitted, so a plain `/shop/<slug>` stays the
  // canonical URL for Today.
  function queueViewHref(view: QueueView, page?: number): string {
    const query = new URLSearchParams();
    if (view !== "urgency") query.set("view", view);
    if (page !== undefined && page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/shop/${shopSlug}?${search}` : `/shop/${shopSlug}`;
  }
  // The view switch exists only while the queue has something to sort — a
  // toggle between two empty states is a control with nothing to govern. The
  // by-departure view always keeps it, so there is always a way back.
  const queueSwitch =
    actions.length > 0 || queueView === "departures" ? (
      <QueueViewSwitch
        current={queueView}
        hrefFor={queueViewHref}
        copy={{
          label: t("shopHome.queueView.label"),
          urgency: t("shopHome.queueView.byUrgency"),
          departures: t("shopHome.queueView.byDeparture"),
        }}
      />
    ) : null;

  return (
    <>
      <ShopPageHeader
        // The destination first, then the day. The date alone was the one
        // thing on this page that could confirm you had arrived, and it named
        // a *when* rather than a *where* — so a staffer who tapped "Today"
        // read "Tue, Jul 21" and a greeting, and nothing said Today (issue
        // #824). Same shape Close-out already used.
        eyebrow={`${t(STAFF_DESTINATION_LABEL_KEYS.today)} · ${formatShortDate(now, locale, shop.timezone)}`}
        title={t(GREETING_KEYS[getTimeOfDayGreeting(now, shop.timezone)], { name: firstName })}
        meta={
          <>
            {/* No sentence at all for a shop still in first-run. "No boats out
                today" is right for a quiet Tuesday and wrong for a shop that
                has never had a board, and anything else here would restate the
                setup checklist directly beneath it (issue #711). */}
            {daySummaryText ? (
              <p className="max-w-2xl text-lg text-muted">
                {daySummaryText}
                {yourBoat
                  ? ` ${t("shopHome.crewingBoat", {
                      time: formatTime(yourBoat.startsAt, locale, shop.timezone),
                      title: yourBoat.title,
                    })}`
                  : ""}
              </p>
            ) : null}
            {/* A day with no boats answers its follow-up question right here.
                The summary sentence above already says "No boats out today";
                the bordered "No boats out today" card that used to restate it
                lower down said a shared fact twice (principle 9) and cost a
                whole section to carry one sentence — so the sentence lives
                where the question arises, and the card is gone. */}
            {departures.length === 0 && nextDeparture ? (
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
            {/* Nothing on the books at all (and past first-run, whose
                checklist owns "schedule your first trip"): one teaching
                sentence and the door, not a boxed section. */}
            {departures.length === 0 && !nextDeparture && !showFirstRunChecklist ? (
              <p className="mt-1 max-w-2xl text-muted">
                {t("shopHome.noDeparturesEmpty")}{" "}
                <Link
                  href={`/shop/${shopSlug}/schedule/board?add=1`}
                  className="font-medium text-primary hover:underline"
                >
                  {t("shopHome.scheduleTrip")}
                </Link>
              </p>
            ) : null}
            {/* No window sentence, and no pivot to Check-in. Today and
                Check-in do still read one shared window
                (src/lib/operational-window.ts), but saying so out loud —
                "The next 7 days of departures — Today and Check-in read one
                list." — explained the data model to someone who came here to
                clear blockers, and the link under it offered a destination the
                nav tabs and the phone dock already carry one tap away. A
                cross-link earns its place by saving a reader something; one
                that duplicates permanent chrome only adds a thing to read. */}
            {/* **Live-only, and it should say so.** Today's board is read
                straight from the server every render — the boat has an
                encrypted device copy, this does not — so a dropped signal
                means the counts, the crew line and the blocked names are
                whatever they were when the signal went. A staffer who can see
                that does not act on a stale board (issue #819). */}
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

      {/* One notice surface. What used to be four independent slots — each
          hand-wrapped in its own spaced div, each able to stack on the others
          above the day's work — is one block with one rhythm. A visit rarely
          carries more than one of these; when it does, they read as one
          stack of arrivals rather than four competing banners. */}
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
          the board, it compresses to one quiet line — the pointer and the
          dismissal survive, the tinted box that pushed the queue off a phone
          screen does not. */}
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

      {lens === "sessions" ? (
        <YourSessions
          locale={locale}
          sessions={crewedSessions}
          shopSlug={shopSlug}
          timeZone={shop.timezone}
        />
      ) : null}

      <DepartureBoard
        locale={locale}
        departures={departures}
        shopSlug={shopSlug}
        timeZone={shop.timezone}
        crewedTripIds={crewedTripIds}
        availableStaff={availableStaff}
        updateCrewAction={updateTripCrewAction.bind(null, shopSlug)}
        copy={{
          crewingBadge: t("shared.today.departureBoard.crewingBadge"),
          courseSession: t.raw("shared.today.departureBoard.courseSession"),
          bookedOfCapacityOne: t.raw("shared.today.departureBoard.bookedOfCapacityOne"),
          bookedOfCapacityOther: t.raw("shared.today.departureBoard.bookedOfCapacityOther"),
          boarding: t("shared.today.departureBoard.boarding"),
          openGuests: t("shared.today.departureBoard.openGuests"),
          assignCrewMemberAria: t.raw("shared.today.departureBoard.assignCrewMemberAria"),
          assignCrewOption: t("shared.today.departureBoard.assignCrewOption"),
          unassignAria: t.raw("shared.today.departureBoard.unassignAria"),
          noCrewAssigned: t("shared.today.departureBoard.noCrewAssigned"),
          crewLine: t.raw("shared.today.departureBoard.crewLine"),
          editCrew: t("shared.today.departureBoard.editCrew"),
          assignCrewLabel: t("shared.today.departureBoard.assignCrewLabel"),
          assignFailed: t("shared.today.departureBoard.assignFailed"),
          boardingSummary: t.raw("shared.today.departureBoard.boardingSummary"),
          boardingAboardOne: t.raw("shared.today.departureBoard.boardingAboardOne"),
          boardingAboardOther: t.raw("shared.today.departureBoard.boardingAboardOther"),
          boardingReadyOne: t.raw("shared.today.departureBoard.boardingReadyOne"),
          boardingReadyOther: t.raw("shared.today.departureBoard.boardingReadyOther"),
          boardingBlockedOne: t.raw("shared.today.departureBoard.boardingBlockedOne"),
          boardingBlockedOther: t.raw("shared.today.departureBoard.boardingBlockedOther"),
          boardingOpenOne: t.raw("shared.today.departureBoard.boardingOpenOne"),
          boardingOpenOther: t.raw("shared.today.departureBoard.boardingOpenOther"),
          blockedWarningOne: t.raw("shared.today.departureBoard.blockedWarningOne"),
          blockedWarningOther: t.raw("shared.today.departureBoard.blockedWarningOther"),
          noneBooked: t("shared.today.departureBoard.noneBooked"),
          everyoneAboard: t("shared.today.departureBoard.everyoneAboard"),
          crewRollCallOpen: t("shared.today.departureBoard.crewRollCallOpen"),
          clearToBoard: t("shared.today.departureBoard.clearToBoard"),
          blockedWarningNamed: t.raw("shared.today.departureBoard.blockedWarningNamed"),
          blockedAboardNamed: t.raw("shared.today.departureBoard.blockedAboardNamed"),
          blockedAboardOne: t.raw("shared.today.departureBoard.blockedAboardOne"),
          blockedAboardOther: t.raw("shared.today.departureBoard.blockedAboardOther"),
          aboardReasonMedical: t("shared.today.departureBoard.aboardReasonMedical"),
          aboardReasonUnknown: t("shared.today.departureBoard.aboardReasonUnknown"),
          aboardReasonCertification: t("shared.today.departureBoard.aboardReasonCertification"),
          aboardReasonPayment: t("shared.today.departureBoard.aboardReasonPayment"),
          sailingToday: t("shared.today.departureBoard.sailingToday"),
        }}
      />

      {showFirstRunChecklist ? (
        <FirstRunChecklist
          shopSlug={shopSlug}
          // No configured APP_HOST (local dev, some test environments) means no
          // origin to build an absolute URL from — `publicScheduleUrl` falls
          // back to the path alone rather than crash the page on a bad base URL.
          scheduleUrl={publicScheduleUrl}
          contactDone={Boolean(shop.contactEmail || shop.contactPhone)}
          diveSiteCount={firstRunDiveSites?.length ?? 0}
          unitsDone={Boolean(shop.unitsConfirmedAt)}
          stripeDone={canAcceptPayments(firstRunStripeAccount)}
          copy={{
            heading: t("shopHome.firstRun.heading"),
            subtitle: t("shopHome.firstRun.subtitle", { count: FIRST_RUN_STEP_COUNT }),
            contactTitle: t("shopHome.firstRun.contactTitle"),
            contactBody: t("shopHome.firstRun.contactBody"),
            contactAction: t("shopHome.firstRun.contactAction"),
            contactDone: t("shopHome.firstRun.contactDone"),
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
      ) : null}

      {/* One block, two views. The switch rides the queue's own heading row —
          it governs exactly that block, and it renders at all only while the
          queue has something to sort (a switch between two empty views is a
          control with nothing to govern). */}
      {queueView === "departures" && blockerQueue ? (
        <BlockerGroups
          queue={blockerQueue}
          requestedPage={queuePage}
          shopSlug={shopSlug}
          timeZone={shop.timezone}
          locale={locale}
          pageHref={(target) => queueViewHref("departures", target)}
          headingId="queue-heading"
          viewSwitch={queueSwitch}
          t={t}
        />
      ) : (
        <TodayQueue
          actions={actions}
          shopSlug={shopSlug}
          shopName={shop.name}
          timezone={shop.timezone}
          inviteAction={inviteWaitlistAction.bind(null, shopSlug)}
          locale={locale}
          nowMs={now.getTime()}
          viewSwitch={queueSwitch}
          firstRun={showFirstRunChecklist}
        />
      )}

      {/* The evening handoff, after the queue — writing the day up is what
          comes *after* the work, and on the evenings it matters the queue
          above it has thinned to nothing. The registry calls the close-out
          "Today's evening mirror" (src/lib/staff-destinations.ts); this is
          its one door on the page.

          It keys on **any** boat being back (`anyBoatIsIn`), not all of them.
          Waiting for the last one meant no card on precisely the days a shop
          wants one: an evening with a night dive still on the board, or a boat
          running late, is when someone starts writing the day up
          (FU-20260811-close-out-has-one-conditional-door). `lastBoatIsIn` then
          picks the words, because "the last boat is in" is a sentence that must
          not be said over a boat still at sea.

          One calm card, never a banner (design/principles.md #8): the queue is
          still the page's work, so the link is `secondary` weight and the card
          carries no second control. Closing is a ritual, never a gate (ADR
          20260804-day-closeout) — nothing here nags, and the card is simply
          absent on a day where nothing has come home yet. */}
      {anyBoatIsIn(departures, now) ? (
        <section
          aria-labelledby="close-out-handoff-heading"
          className="mt-10 rounded-2xl border border-border bg-surface p-5 sm:p-6"
        >
          <h2 id="close-out-handoff-heading" className="font-semibold">
            {lastBoatIsIn(departures, now)
              ? t("shopHome.closeOut.heading")
              : t("shopHome.closeOut.headingBoatStillOut")}
          </h2>
          <p className="mt-1 text-muted">
            {lastBoatIsIn(departures, now)
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

/** Shaped like `TodayBody`'s header + departure board + queue rows (principle 1). */
function TodaySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-32 rounded bg-surface-sunken" />
      <div className="mt-2 h-10 w-72 rounded bg-surface-sunken" />
      <div className="mt-3 h-6 w-full max-w-2xl rounded bg-surface-sunken" />
      <div className="mt-2 h-6 w-4/5 max-w-xl rounded bg-surface-sunken" />

      <div className="mt-8 flex flex-col gap-3">
        {[0, 1].map((i) => (
          <div
            key={`departure-${i}`}
            className="h-32 rounded-2xl border border-border bg-surface"
          />
        ))}
      </div>

      <div className="mt-10 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={`queue-${i}`} className="h-20 rounded-xl border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}
