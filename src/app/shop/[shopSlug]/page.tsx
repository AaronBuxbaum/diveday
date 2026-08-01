import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { DepartureBoard } from "@/components/today/DepartureBoard";
import { FirstRunChecklist } from "@/components/today/FirstRunChecklist";
import { RoleOrientationCard } from "@/components/today/RoleOrientationCard";
import { TodayQueue } from "@/components/today/TodayQueue";
import { YourSessions } from "@/components/today/YourSessions";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getTodayWork } from "@/db/today";
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
import { requireStaffSession } from "@/lib/session";
import { getTimeOfDayGreeting, leadWithCrewed, roleLensFor, summarizeDay } from "@/lib/today";
import { inviteWaitlistAction, updateTripCrewAction } from "./trips/[id]/actions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
// These are the explanatory landings for authorization refusals elsewhere in
// the app that redirect a non-owner/manager back to Today (task 82, UX
// persona 11 "Kai") rather than teleporting silently.
const AUTH_NOTICES: Record<string, StaffMessageKey> = {
  waivers_not_authorized: "shopHome.notice.waiversNotAuthorized",
  export_not_authorized: "shopHome.notice.exportNotAuthorized",
};

export const metadata: Metadata = {
  title: "Today — DiveDay",
};

/**
 * Today is a work queue, not a dashboard. Two questions, in order: can the
 * boats leaving today sail, and who needs me before they do? Anything a nav
 * click already answers — the schedule, the diver list — is
 * deliberately not repeated here.
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
  if (!shop) return null;
  const t = staffTranslator(locale);

  const now = nowDate();
  // The lens (20260721-role-aware-landing): a captain or divemaster's Today
  // leads with the boat they crew; an instructor's with their sessions.
  const lens = roleLensFor(session.user.roles);
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
  // The first-run checklist only matters for a real shop with nothing on the
  // books yet — for any other visit these two extra queries never run.
  const showFirstRunChecklist = !shop.isDemo && !nextDeparture;
  const [firstRunDiveSites, firstRunStripeAccount] = showFirstRunChecklist
    ? await Promise.all([listDiveSites(db, shop.id), getShopStripeAccount(db, shop.id)])
    : [null, null];
  const firstRunOrigin = showFirstRunChecklist ? publicAppUrl() : null;
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

  return (
    <>
      <ShopPageHeader
        eyebrow={formatShortDate(now, locale, shop.timezone)}
        title={t(GREETING_KEYS[getTimeOfDayGreeting(now, shop.timezone)], { name: firstName })}
        meta={
          <>
            <p className="max-w-2xl text-lg text-muted">
              {summarizeDayText(
                t,
                summarizeDay(
                  actions,
                  departures.length,
                  departures.reduce((total, departure) => total + departure.blocked, 0),
                ),
              )}
              {yourBoat
                ? ` ${t("shopHome.crewingBoat", {
                    time: formatTime(yourBoat.startsAt, locale, shop.timezone),
                    title: yourBoat.title,
                  })}`
                : ""}
            </p>
            {/* Today, Blockers, and Check-in each slice the same readiness
                data on a different, undocumented horizon (task 141, UX
                persona lens 17) — a diver "cleared" here can still show on
                one of the other two. Name the window so that is never a
                surprise. */}
            <p className="mt-1 max-w-2xl text-sm text-muted">{t("shopHome.windowNote")}</p>
          </>
        }
      />

      {created ? (
        <div className="mb-6">
          <ShopNotice>
            {seriesCount > 1
              ? t("shopHome.createdNotice.series", { title: created, count: seriesCount })
              : t("shopHome.createdNotice.single", { title: created })}
          </ShopNotice>
        </div>
      ) : null}
      {reset ? (
        <div className="mb-6">
          <ShopNotice tone="neutral">{t("shopHome.demoReset")}</ShopNotice>
        </div>
      ) : null}
      {email ? (
        <div className="mb-6">
          <ShopNotice tone={email === "sent" ? "success" : "danger"}>
            {email === "sent" ? t("shopHome.emailResent") : t("shopHome.emailFailed")}
          </ShopNotice>
        </div>
      ) : null}
      {notice && AUTH_NOTICES[notice] ? (
        <div className="mb-6">
          <ShopNotice tone="warning" role="status">
            {t(AUTH_NOTICES[notice])}
          </ShopNotice>
        </div>
      ) : null}

      {showOrientation && orientationRole ? (
        <RoleOrientationCard
          tourHref={orientationTourHref(
            shopSlug,
            orientationRole,
            nextDeparture ? `/shop/${shopSlug}/trips/${nextDeparture.tripId}/manifest` : undefined,
          )}
          dismissAction={dismissOrientationAction}
          copy={{
            heading: t("shopHome.orientation.heading"),
            subtitle: t("shopHome.orientation.subtitle"),
            tryLabel: t("shopHome.orientation.tryLabel"),
            dismiss: t("shopHome.orientation.dismiss"),
            ...orientationTourText(t, orientationRole),
          }}
        />
      ) : null}

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
          courseSession: t("shared.today.departureBoard.courseSession"),
          bookedOfCapacity: t("shared.today.departureBoard.bookedOfCapacity"),
          boarding: t("shared.today.departureBoard.boarding"),
          openGuests: t("shared.today.departureBoard.openGuests"),
          crewDropZoneAria: t("shared.today.departureBoard.crewDropZoneAria"),
          assignCrewMemberAria: t("shared.today.departureBoard.assignCrewMemberAria"),
          assignedCrewHeading: t("shared.today.departureBoard.assignedCrewHeading"),
          assignCrewOption: t("shared.today.departureBoard.assignCrewOption"),
          unassignAria: t("shared.today.departureBoard.unassignAria"),
          noCrewAssigned: t("shared.today.departureBoard.noCrewAssigned"),
          assignCrewLabel: t("shared.today.departureBoard.assignCrewLabel"),
          assignFailed: t("shared.today.departureBoard.assignFailed"),
          countReady: t("shared.today.departureBoard.countReady"),
          countBlocked: t("shared.today.departureBoard.countBlocked"),
          countBoarded: t("shared.today.departureBoard.countBoarded"),
          blockedWarningOne: t("shared.today.departureBoard.blockedWarningOne"),
          blockedWarningOther: t("shared.today.departureBoard.blockedWarningOther"),
          noneBooked: t("shared.today.departureBoard.noneBooked"),
          everyoneAboard: t("shared.today.departureBoard.everyoneAboard"),
          clearToBoard: t("shared.today.departureBoard.clearToBoard"),
          sailingToday: t("shared.today.departureBoard.sailingToday"),
          sailingTodaySubtitle: t("shared.today.departureBoard.sailingTodaySubtitle"),
          dragStaffLabel: t("shared.today.departureBoard.dragStaffLabel"),
        }}
      />

      {departures.length === 0 ? (
        <section
          aria-labelledby="no-departures-heading"
          className="mb-10 rounded-2xl border border-border bg-surface p-5 sm:p-6"
        >
          <h2 id="no-departures-heading" className="font-semibold">
            {t("shopHome.noDeparturesHeading")}
          </h2>
          {nextDeparture ? (
            <p className="mt-1 text-muted">
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
          ) : !showFirstRunChecklist ? (
            <>
              <p className="mt-1 text-muted">{t("shopHome.noDeparturesEmpty")}</p>
              <Link
                href={`/shop/${shopSlug}/trips/new`}
                className={buttonClass({ className: "mt-4" })}
              >
                {t("shopHome.scheduleTrip")}
              </Link>
            </>
          ) : null}
        </section>
      ) : null}

      {showFirstRunChecklist ? (
        <FirstRunChecklist
          shopSlug={shopSlug}
          scheduleUrl={
            // No configured APP_HOST (local dev, some test environments) means
            // no origin to build an absolute URL from — fall back to the path
            // alone rather than crash the whole page on a malformed base URL.
            firstRunOrigin
              ? new URL(`/shop/${shopSlug}/schedule`, `${firstRunOrigin}/`).toString()
              : `/shop/${shopSlug}/schedule`
          }
          contactDone={Boolean(shop.contactEmail || shop.contactPhone)}
          diveSiteCount={firstRunDiveSites?.length ?? 0}
          stripeDone={canAcceptPayments(firstRunStripeAccount)}
          copy={{
            heading: t("shopHome.firstRun.heading"),
            subtitle: t("shopHome.firstRun.subtitle"),
            contactTitle: t("shopHome.firstRun.contactTitle"),
            contactBody: t("shopHome.firstRun.contactBody"),
            contactAction: t("shopHome.firstRun.contactAction"),
            contactDone: t("shopHome.firstRun.contactDone"),
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

      <TodayQueue
        actions={actions}
        shopSlug={shopSlug}
        shopName={shop.name}
        inviteAction={inviteWaitlistAction.bind(null, shopSlug)}
        locale={locale}
      />
    </>
  );
}

/** Shaped like `TodayBody`'s header + departure board + queue rows (principle 1). */
function TodaySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-32 rounded bg-surface-sunken" />
      <div className="mt-3 h-9 w-72 rounded bg-surface-sunken" />
      <div className="mt-2 h-5 w-96 max-w-full rounded bg-surface-sunken" />

      <div className="mt-8 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <div className="h-5 w-40 rounded bg-surface-sunken" />
          <div className="h-5 w-24 rounded bg-surface-sunken" />
        </div>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => (
            <div key={`active-${id}`} className="h-8 w-8 rounded-full bg-surface-sunken" />
          ))}
          {["e1", "e2", "e3", "e4", "e5", "e6"].map((id) => (
            <div
              key={`empty-${id}`}
              className="h-8 w-8 rounded-full border-2 border-dashed border-border-strong bg-transparent"
            />
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}
