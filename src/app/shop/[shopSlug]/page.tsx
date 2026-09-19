import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { DayHeader } from "@/app/shop/[shopSlug]/_components/day/DayHeader";
import {
  DaySpine,
  type EveningReading,
  type SpineDraft,
} from "@/app/shop/[shopSlug]/_components/today/DaySpine";
import { FirstBookableCard } from "@/app/shop/[shopSlug]/_components/today/FirstBookableCard";
import { FirstRunChecklist } from "@/app/shop/[shopSlug]/_components/today/FirstRunChecklist";
import { RecapNoteEditor } from "@/app/shop/[shopSlug]/_components/today/RecapNoteEditor";
import {
  RoleOrientationCard,
  RoleOrientationLine,
} from "@/app/shop/[shopSlug]/_components/today/RoleOrientationCard";
import { YourSessions } from "@/app/shop/[shopSlug]/_components/today/YourSessions";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import { canPersonExportIncidentRecord } from "@/db/authz";
import { inHorizonReadiness } from "@/db/blockers";
import { getDb } from "@/db/client";
import { getDayCloseout, listHeadCountCloses, shopHasSailedBefore } from "@/db/closeout";
import { listDiveSites } from "@/db/dive-sites";
import { shopFirstBooking } from "@/db/first-booking";
import { listFreshFormDrafts } from "@/db/form-drafts";
import { shopHasEverTakenAnOrder } from "@/db/orders";
import type { ConfirmRentalFitOutcome } from "@/db/rental-fit";
import { seasonScale } from "@/db/season-scale";
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
import { daySpineSummaryText } from "@/i18n/today-labels";
import { trackEvent } from "@/lib/analytics";
import { canViewShopReports } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { assembleEveningClose } from "@/lib/closeout";
import { dayStripGeometry, dayStripTicks, dayStripWindow } from "@/lib/day-strip";
import { FORM_DRAFT_RESUME_SUFFIX } from "@/lib/form-drafts";
import {
  formatDateTimeTz,
  formatHourShort,
  formatMonthDay,
  formatShortDate,
  formatTime,
  formatWeekday,
} from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { FIRST_RUN_STEP_COUNT } from "@/lib/onboarding";
import { publicSchedulePath } from "@/lib/public-routes";
import { recapAutoSendAt } from "@/lib/recap-schedule";
import { seasonStartInstant } from "@/lib/season";
import { requireStaffSession } from "@/lib/session";
import { skyReadingFor } from "@/lib/sky-scheme";
import {
  type NoticeCodeOf,
  type NoticeTone,
  noticeFromParam,
  noticeRole,
  shopPath,
} from "@/lib/staff-notices";
import {
  ACTION_KIND_META,
  assembleDaySpine,
  type DayStation,
  factOfScaleFor,
  roleLensFor,
  spineIsQuiet,
  spineJobCount,
  type TodayAction,
} from "@/lib/today";
import { hasSailed } from "@/lib/trips";
import { shopDayBounds, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import {
  deleteCrewRecapPhotoAction,
  deleteRecapPhotoAction,
  saveRecapNoteAction,
  sendRecapAction,
  setLeftoverDecisionAction,
  toggleRecapAutoSendPauseAction,
  updateHelpRequestAction,
  uploadCrewRecapPhotoAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
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
  "dive-site-import-not-authorized": "shopHome.notice.diveSiteImportNotAuthorized",
  "backup-not-authorized": "shopHome.notice.backupNotAuthorized",
  "whatsapp-not-authorized": "shopHome.notice.whatsappNotAuthorized",
  "promos-not-authorized": "shopHome.notice.promosNotAuthorized",
  "integrations-not-authorized": "shopHome.notice.integrationsNotAuthorized",
};

type EveningNotice = { key: StaffMessageKey; tone: NoticeTone };

/**
 * The fit-keep's refusals, in the spelling `noticeUrl` gives them. The tap
 * hands `confirmRentalFitSize`'s answer straight to the query string, so the
 * map below owes words to every member of that union; typing it this way makes
 * a union that grows without copy a compile error rather than a blank page.
 */
type FitKeepRefusalCode = NoticeCodeOf<Exclude<ConfirmRentalFitOutcome, "saved">>;

type BorrowedEveningNotices = Record<string, EveningNotice>;
/** Loose in the keys it accepts, exact in the ones it demands. */
type EveningNoticeMap = BorrowedEveningNotices & Record<FitKeepRefusalCode, EveningNotice>;

/**
 * The evening's own `?notice=` codes, re-homed here when `/close-out` folded
 * into this page (H-62). Every code is unchanged — a bookmark carrying one
 * still lands on the right words, because the 308 keeps the query and this
 * page answers it. The refusals are why this is a tone table rather than a
 * bare key map: `invalid` is a recap send that failed, a crew photo this
 * departure cannot take, or a fit-keep whose reservation the desk could not
 * re-prove, and `unknown-person` is a fit-keep aimed at a person id that is
 * not this shop's. Both reached this page with no entry here at all, so the
 * refusal rendered nothing while this comment claimed otherwise.
 */
const EVENING_NOTICES: EveningNoticeMap = {
  "recap-sent": { key: "closeout.notice.recapSent", tone: "success" },
  "recap-send-attention": { key: "closeout.notice.recapAttention", tone: "warning" },
  "recap-not-ready": { key: "closeout.notice.recapNotReady", tone: "neutral" },
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
    closed?: string;
    noted?: string;
    decision?: string;
    decisionState?: string;
  }>;
}) {
  // The session and the two route-param promises don't depend on one
  // another — resolve them together instead of serially.
  const [
    session,
    { shopSlug },
    { created, series, reset, email, notice, closed, noted, decision, decisionState },
  ] = await Promise.all([requireStaffSession(), params, searchParams]);
  const seriesCount = series ? Number.parseInt(series, 10) : 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams
        params={[
          "created",
          "series",
          "reset",
          "email",
          "notice",
          "closed",
          "noted",
          "decision",
          "decisionState",
        ]}
      />
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
          closed={closed}
          noted={noted}
          decision={decision}
          decisionState={decisionState}
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
  closed,
  noted,
  decision,
  decisionState,
}: {
  session: Awaited<ReturnType<typeof requireStaffSession>>;
  shopSlug: string;
  created?: string;
  seriesCount: number;
  reset?: string;
  email?: string;
  notice?: string;
  /** The day was just closed — the one arrival banner the evening carries. */
  closed?: string;
  /** A departure whose recap note was just saved; re-opens that station's editor. */
  noted?: string;
  /** A leftover just decided, and which way — the Undo toast's whole input. */
  decision?: string;
  decisionState?: string;
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
  const t = staffTranslator(locale);
  // `Object.hasOwn`, not `AUTH_NOTICES[notice]`: `notice` is an attacker-supplied
  // query param, and a bare lookup resolves `?notice=constructor` off the
  // prototype (src/lib/staff-notices.ts).
  const authNoticeKey = noticeFromParam(notice, AUTH_NOTICES);

  const now = nowDate();
  // The reader's own unfinished forms (ADR 20260906-before-you-ask, decision 3).
  const spineDrafts: SpineDraft[] = (
    await listFreshFormDrafts(db, shop.id, session.user.personId, now)
  ).map((draft) => ({
    form: draft.form,
    // Exhaustive by type rather than a ternary: a fourth draft kind added
    // without a door here used to resolve, silently, to the diver form — a
    // "resume" link that opened the wrong page with somebody else's answers in
    // it.
    href: `/shop/${shopSlug}${FORM_DRAFT_RESUME_SUFFIX[draft.form]}`,
  }));
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
  // **The day's closing state** (H-62; ADR 20260827-clearwater-surface-language,
  // decision 4). `/close-out` is a 308 to this page now, and its reader came
  // here with it — unchanged, including the trail it appends to.
  //
  // It is handed the queue this render already built rather than reading its
  // own: without that, one page would run `getTodayWork` twice and hold two
  // answers about one boat. That also means the leftovers are filtered by the
  // reader's own lens and role, which is exactly what the list has always
  // claimed to be — "what the Today queue would still show *you*".
  const closeout = await getDayCloseout(
    db,
    shop.id,
    shopSlug,
    shop.timezone,
    now,
    t,
    locale,
    canViewShopReports(session.user.roles),
    actions,
  );
  const eveningClose = assembleEveningClose(closeout.state.departures, now);
  // The day's whole board, clock order — the strip's marks and the count under
  // the date both read it.
  const dayDepartures = [...closeout.state.departures].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  // Two bounded reads, and only when there is a day to close over: who made
  // the last roll-call mark on each settled boat, and whether this staffer may
  // generate a departure's log at all. The log gate is checked against the
  // database rather than the session's roles so a demotion takes effect at
  // once, and resolved once here rather than per station.
  const [headCountCloses, canOpenLog]: [
    Map<string, { closedAt: Date; closedBy: string }>,
    boolean,
  ] =
    eveningClose.stations.length > 0
      ? await Promise.all([
          listHeadCountCloses(
            db,
            shop.id,
            eveningClose.stations
              .filter((station) => station.status === "all_home")
              .map((station) => station.tripId),
          ),
          canPersonExportIncidentRecord(db, shop.id, session.user.personId),
        ])
      : [new Map(), false];
  // The once-ever wording, asked for only in the moment it could apply.
  const firstBoatEver =
    eveningClose.allHome &&
    !(await shopHasSailedBefore(db, shop.id, shopDayBounds(now, shop.timezone).from));
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
  // **The shop's first booking, while it is still the only one** — the staff
  // side's once-in-a-shop's-life coral moment (ADR 20260827-first-light,
  // decision 6). One bounded read (`limit 2`), skipped where it could never
  // fire: a shop still in first run has no departures and so no bookings, and a
  // demo shop's board arrives seeded, so no booking on it is ever a first —
  // the same reasoning `firstBookableMoment` below makes about departures.
  const firstBooking =
    shop.isDemo || showFirstRunChecklist ? null : await shopFirstBooking(db, shop.id, now);
  // **One fact of scale, on the day it is true** (ADR
  // 20260904-reef-all-the-way-down, decision 2, Budget rule 3). A read, never
  // a cache: nothing is stored and nothing is acknowledged, so the sentence
  // ends when the day does. Skipped on a shop still in first run for the same
  // reason as the line above — it has no departures to count. The demo shop
  // keeps it: its board is seeded but its divers are real rows, and a count is
  // not a claim about a first.
  const season = { month: shop.seasonStartMonth, day: shop.seasonStartDay };
  const factOfScale = showFirstRunChecklist
    ? null
    : factOfScaleFor({
        seasonStart: season,
        ...(await seasonScale(
          db,
          shop.id,
          shop.timezone,
          seasonStartInstant(now, shop.timezone, season),
          now,
        )),
      });
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
  // **One orientation moment at a time.** The shop's first-bookable card and
  // the role orientation are both "you are new here, look at this", and they
  // used to render one directly beneath the other — a tinted panel with a URL
  // box and a copy button, and then a tip line under it. The bookable card
  // happens once in a shop's life and is the better moment, so it wins and the
  // orientation waits for the next visit (it is dismissed per account, not per
  // render, so nothing is lost). Placed after `firstBookableMoment` so the
  // dismissal read is skipped outright on the morning the card is up.
  const showOrientation =
    orientationRole !== null &&
    !showFirstRunChecklist &&
    !(Boolean(created) && firstBookableMoment) &&
    !(await isOrientationDismissed(db, session.user.personId));
  const shareOrigin = showFirstRunChecklist || firstBookableMoment ? publicAppUrl() : null;
  const publicScheduleUrl = shareOrigin
    ? new URL(publicSchedulePath(shopSlug), `${shareOrigin}/`).toString()
    : publicSchedulePath(shopSlug);
  // Blocker frequency, after the response so it never delays the queue: how many
  // divers still can't board today, and how many jobs are urgent right now.
  const blockedToday = work.departures.reduce((sum, departure) => sum + departure.blocked, 0);
  const urgentJobs = actions.filter((action) => action.urgency === "now").length;
  after(() => trackEvent({ name: "blockers_surfaced", count: blockedToday, urgent: urgentJobs }));
  // The next boat that has not gone yet, carrying the standing one-hour
  // late-arrival buffer every "has it sailed" question in this app carries.
  const nextStation: DayStation | undefined = spine.stations.find(
    (station) => !hasSailed(station.startsAt, now),
  );
  // "3 boats today. 2 things need you before the 7:00 AM leaves the dock." The
  // count is what is still open on the boat the sentence names, because that
  // is what "before it leaves" means; once every boat is away it counts what
  // is open across the day instead.
  const daySummaryText = showFirstRunChecklist
    ? null
    : daySpineSummaryText(t, {
        // The day's boats, not the queue's: a day whose work is all done still
        // has three boats on it, and the line under the date says what the day
        // *is* before it says what is left of it.
        boats: dayDepartures.length,
        jobs: nextStation
          ? pressingRows(nextStation.rows)
          : spine.stations.reduce((total, station) => total + pressingRows(station.rows), 0) +
            pressingRows(spine.desk),
        nextDepartureTime: nextStation
          ? formatTime(nextStation.startsAt, locale, shop.timezone)
          : null,
      });
  // **The day's own sky and picture** (ADR 20260919-one-idea, decision I ·
  // Tide, slice 23a). The scheme comes from the sun over this shop where it has
  // coordinates and from its own clock where it does not, and neither reading
  // gates anything: the sky says what hour it is and no rule consults it.
  const sky = skyReadingFor({
    at: now,
    timeZone: shop.timezone,
    latitude: shop.latitude,
    longitude: shop.longitude,
  });
  // Every departure on the board today, sailed or not. `work.departures` is
  // scoped to the operational window, which begins at `now` — so at noon it
  // holds the afternoon and the morning's two boats have left it, and a strip
  // drawn from it would show an empty morning to a shop that ran one. The
  // close-out's list is the day's own, whole, from midnight.
  const dayBounds = shopDayBounds(now, shop.timezone);
  const stripMarks = dayDepartures.map((departure) => departure.startsAt);
  // Not midnight to midnight: a whole calendar day spends half its width on
  // night, which flattens the arc to a wire and crowds every boat into the
  // same third. The window is the day's own content, clamped inside it.
  const stripWindow = dayStripWindow({
    dayFrom: dayBounds.from,
    dayTo: dayBounds.to,
    now,
    sunriseAt: sky.sunriseAt,
    sunsetAt: sky.sunsetAt,
    marks: stripMarks,
  });
  // The day's own hour boundaries in the shop's zone, for the strip to pick
  // its ticks from — the top of an hour is a wall-clock fact, and `day-strip`
  // reads no zone.
  const dayWall = utcToWallTime(now, shop.timezone);
  const dayHours = Array.from({ length: 24 }, (_, hour) =>
    wallTimeToUtc({ ...dayWall, hour, minute: 0 }, shop.timezone),
  );
  // Four ticks, however wide the window turned out. More than four and the
  // labels touch at 390.
  const stripTicks = dayStripTicks({ ...stripWindow, hours: dayHours, count: 4 });
  const stripGeometry = dayStripGeometry({
    from: stripWindow.from,
    to: stripWindow.to,
    now,
    sunriseAt: sky.sunriseAt,
    sunsetAt: sky.sunsetAt,
    daylightProgress: sky.daylightProgress,
    marks: dayDepartures.map((departure) => ({
      id: departure.tripId,
      at: departure.startsAt,
    })),
    ticks: stripTicks,
  });
  const markLabels = Object.fromEntries(
    dayDepartures.map((departure) => [
      departure.tripId,
      formatTime(departure.startsAt, locale, shop.timezone),
    ]),
  );
  // The hour alone under a tick — "6 AM", never "6:00 AM". Four full times side
  // by side touch at 390, and the minute on a tick is a digit nobody reads.
  const tickLabels = stripTicks.map((at) =>
    formatHourShort(utcToWallTime(at, shop.timezone).hour, locale),
  );
  // Sunrise and sunset, or the one line that tells a shop how to get them.
  // Nothing at all while the setup ledger is still on screen: a shop that has
  // not had a first booking is not the reader to send to the address form.
  const almanacLine = showFirstRunChecklist
    ? null
    : sky.sunriseAt && sky.sunsetAt
      ? t("shopHome.day.sunriseAndSunset", {
          sunrise: formatTime(sky.sunriseAt, locale, shop.timezone),
          sunset: formatTime(sky.sunsetAt, locale, shop.timezone),
        })
      : sky.basis === "clock"
        ? t("shopHome.day.noPlace")
        : null;

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

  // Each returned departure's recap, written where the crew is standing when
  // they still remember the day. It rides its own station rather than a
  // page-level section, because the note is about one boat and the hourly scan
  // mails it four hours after that boat came in.
  const recapDurationText = (durationMs: number) => {
    const minutes = Math.max(1, Math.round(Math.abs(durationMs) / 60_000));
    return minutes < 60
      ? t("closeout.recap.aboutMinutes", { count: minutes })
      : t("closeout.recap.aboutHours", { count: Math.max(1, Math.round(minutes / 60)) });
  };
  const recapEditors = new Map<string, React.ReactNode>();
  for (const departure of closeout.state.departures) {
    // Only a returned boat: a trip still out has no day to write about yet,
    // and one that never left has no recap coming.
    if (!departure.ended) continue;
    const autoSendAt = recapAutoSendAt(departure.endsAt, departure.recapAutoSendAt);
    const recapStatusSummary = departure.recapSentAt
      ? t("closeout.recap.summarySent", {
          duration: recapDurationText(now.getTime() - departure.recapSentAt.getTime()),
        })
      : departure.recapFailed
        ? t("closeout.recap.summaryFailed")
        : departure.recapAutoSendPaused
          ? t("closeout.recap.summaryPaused")
          : autoSendAt && autoSendAt.getTime() <= now.getTime()
            ? t("closeout.recap.summaryDue")
            : autoSendAt
              ? t("closeout.recap.summaryWaiting", {
                  duration: recapDurationText(autoSendAt.getTime() - now.getTime()),
                })
              : t("closeout.recap.summaryNoScheduled");
    recapEditors.set(
      departure.tripId,
      <RecapNoteEditor
        action={saveRecapNoteAction.bind(null, departure.tripId)}
        shoutout={departure.recapShoutout}
        saved={noted === departure.tripId}
        t={t}
        photos={departure.photos}
        deletePhotoAction={deleteRecapPhotoAction.bind(null, departure.tripId)}
        crewPhotos={departure.crewPhotos}
        crewPhotoInputId={`crew-recap-photo-${departure.tripId}`}
        uploadCrewPhotoAction={uploadCrewRecapPhotoAction.bind(null, departure.tripId)}
        deleteCrewPhotoAction={deleteCrewRecapPhotoAction.bind(null, departure.tripId)}
        tripId={departure.tripId}
        recapSendAction={sendRecapAction.bind(null, departure.tripId)}
        toggleRecapAutoSendPauseAction={toggleRecapAutoSendPauseAction}
        recapAutoSendAt={autoSendAt}
        recapAutoSendAtLabel={
          autoSendAt ? formatDateTimeTz(autoSendAt, locale, shop.timezone) : undefined
        }
        recapAutoSendPaused={departure.recapAutoSendPaused}
        recapFailed={departure.recapFailed}
        recapNowMs={now.getTime()}
        recapSentAt={departure.recapSentAt}
        recapStatusSummary={recapStatusSummary}
      />,
    );
  }
  // Dismissing is immediate and per row (H-57), so a dismissed leftover leaves
  // the group rather than sitting under a caption explaining that it was
  // dismissed. Undo is the way back, and it is a toast, not a second state.
  const openLeftovers = closeout.state.leftovers.filter(
    (action) => closeout.state.leftoverDecisions[action.id] !== "dismiss",
  );
  const evening: EveningReading = {
    close: eveningClose,
    headCountCloses,
    recapEditors,
    canOpenLog,
    leftovers: openLeftovers,
    latest: closeout.latest,
    closeCount: closeout.closeCount,
    firstEver: firstBoatEver,
  };
  const decidedLeftover =
    decisionState === "carry" || decisionState === "dismiss"
      ? closeout.state.leftovers.find((action) => action.id === decision)
      : undefined;
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
        // **The home is the day** (ADR 20260919-one-idea, decision I · Tide,
        // slice 23a). The eyebrow and the greeting are both gone: Tide's floor
        // deletes them, and what stands where they were is the day itself —
        // the sky at the shop's own hour, the date as the page's one name, and
        // every departure on the hour it leaves.
        scheme={sky.scheme}
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
        almanac={almanacLine}
        // Nothing to draw on a day with no boats and no sun: an empty arc over
        // an empty horizon is a picture of nothing, and the band still says the
        // date.
        strip={
          stripGeometry.sunArc || stripGeometry.marks.length > 0
            ? {
                geometry: stripGeometry,
                label:
                  stripGeometry.marks.length > 0
                    ? t("shopHome.day.stripLabel")
                    : t("shopHome.day.stripLabelNoBoats"),
                markLabels,
                tickLabels,
                nowLabel: formatTime(now, locale, shop.timezone),
              }
            : null
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
            <Link
              // `shopPath`, not a template literal: it escapes each segment, so
              // nobody reading this line has to re-derive that `shopSlug` was
              // already narrowed by `requireShopSurface` upstream.
              href={shopPath(shopSlug, "print")}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-full bg-white/18 px-3 text-sm font-semibold text-(--sky-ink) backdrop-blur-sm print:hidden hover:bg-white/28"
            >
              {t("shared.printPacket.dayDoor")}
            </Link>
          ) : null
        }
      >
        <>
          {/* The day's own line is in the sky above this, so the only sentence
              left here is first-run's, which carries the address a diver would
              use and the count of what is left to do — neither of which the
              band says (issue #711). */}
          {showFirstRunChecklist ? (
            <p className="max-w-2xl text-lg text-muted">
              {t.rich("shopHome.firstRun.pageIntro", {
                address: (chunks) => <address className="inline not-italic">{chunks}</address>,
                url: publicScheduleUrl,
              })}
            </p>
          ) : null}
          {/* A day with no boats answers its follow-up question right here. */}
          {!quietDay && spine.stations.length === 0 && nextDeparture ? (
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
          {!quietDay && spine.stations.length === 0 && !nextDeparture && !showFirstRunChecklist ? (
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
      </DayHeader>

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

      {/* The land-then-undo toast for a leftover just decided (H-57): the
          choice is already saved, and this is the few seconds to take it
          back — never a confirm in front of a reversible act. */}
      {decidedLeftover && decisionState ? (
        <UndoToast
          message={t(
            decisionState === "dismiss"
              ? "closeout.leftovers.savedDismissed"
              : "closeout.leftovers.savedCarried",
            { subject: decidedLeftover.subject },
          )}
          action={setLeftoverDecisionAction.bind(
            null,
            decidedLeftover.id,
            decisionState === "dismiss" ? "carry" : "dismiss",
          )}
          fields={{}}
          pendingLabel={t("closeout.leftovers.undoing")}
          undoLabel={t("closeout.leftovers.undo")}
        />
      ) : null}

      {/* One notice surface. A visit rarely carries more than one of these;
          when it does, they read as one stack of arrivals rather than four
          competing banners. */}
      {(created && !firstBookableMoment) ||
      reset ||
      email ||
      authNoticeKey ||
      closed ||
      eveningNotice ? (
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
          {closed ? (
            <ShopNotice tone="success" role="status">
              {t("closeout.notice.closed")}
            </ShopNotice>
          ) : null}
          {eveningNotice ? (
            <ShopNotice tone={eveningNotice.tone} role={noticeRole(eveningNotice.tone)}>
              {t(eveningNotice.key)}
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

      {quietDay ? (
        <div className="mt-8 flex flex-col gap-4">
          <Link
            href={`/shop/${shopSlug}/schedule/board?add=1`}
            className={buttonClass({ className: "w-full justify-center sm:w-auto" })}
          >
            {t("shopHome.quietAddDeparture")}
          </Link>
          {nextDeparture ? (
            <ul>
              <LedgerRow
                href={`/shop/${shopSlug}/trips/${nextDeparture.tripId}`}
                linkLabel={nextDeparture.title}
              >
                <div className="min-w-0 py-2">
                  <p className="font-medium break-words">{nextDeparture.title}</p>
                  <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted tabular-nums">
                    <span>{t("shopHome.quietNextDepartureLabel")}</span>
                    <span>
                      {formatShortDate(nextDeparture.startsAt, locale, shop.timezone)} ·{" "}
                      {formatTime(nextDeparture.startsAt, locale, shop.timezone)}
                    </span>
                    <span>
                      {nextDeparture.booked}/{nextDeparture.capacity}
                    </span>
                  </p>
                </div>
              </LedgerRow>
            </ul>
          ) : null}
        </div>
      ) : (
        <DaySpine
          spine={spine}
          shopSlug={shopSlug}
          shopName={shop.name}
          locale={locale}
          timeZone={shop.timezone}
          currency={shop.currency}
          crewedTripIds={lens === "boat" ? crewedTripIds : undefined}
          withheldCount={withheldCount}
          drafts={spineDrafts}
          helpRequestAction={updateHelpRequestAction}
          showPaymentsRow={showPaymentsRow}
          firstBooking={firstBooking}
          factOfScale={factOfScale}
          evening={evening}
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
          // **The spine's leading group, on the one morning it exists** (ADR
          // 20260827-first-light, decision 6). Composed here rather than inside
          // the spine because the five persisted facts behind it are this
          // page's reads; the spine only decides where the group sits.
          firstRun={
            showFirstRunChecklist ? (
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
                  groupLabel: t("shopHome.firstRun.groupLabel"),
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
                  siteDone: t("shopHome.firstRun.siteDone", {
                    count: firstRunDiveSites?.length ?? 0,
                  }),
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
            ) : null
          }
        />
      )}
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
