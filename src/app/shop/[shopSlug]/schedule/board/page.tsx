import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { bindFormDraft, draftForForm } from "@/app/actions/form-draft-props";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { getScheduleBoardPage } from "@/db/schedule-board-page";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { toShopCurrency } from "@/lib/money";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
import { resolveWeekStart } from "@/lib/week-board";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { resolveRescheduleNoticeSnapshot } from "../../_components/RescheduleNotice";
import { ScheduleViews } from "../_components/ScheduleViews";
import { BoardPageShell } from "./_components/BoardPageShell";
import type { BoardSearchParams } from "./_components/board-search-params";
import { boardWeekView } from "./_components/board-week-view";
import {
  builderPriceInput,
  scheduleBuilderCopy,
  scheduleBuilderMore,
} from "./_components/builder-copy";
import { builderCoursePriceLabel } from "./_components/builder-course-options";
import { builderRequestPlan } from "./_components/builder-request-plan";
import { ScheduleBoardNoticeView } from "./_components/ScheduleBoardNoticeView";
import {
  type BuilderInitialCourse,
  type BuilderInitialSite,
  ScheduleBuilder,
} from "./_components/ScheduleBuilder";
import {
  addDepartureAction,
  duplicateDepartureAction,
  loadBuilderOptionsAction,
  loadMovePreflightAction,
  loadTideWindowAction,
  loadWeekdayPatternAction,
  moveDepartureAction,
  removeDepartureAction,
} from "./actions";
import { builderNoticeFor, verifiedGearMoveNotice } from "./builder-notices";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Schedule — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * The staff operations board — KPI tiles and the add/move/copy/remove
 * departure builder. Split out of the old `/schedule` (Lens 17,
 * docs/product/features/story-backlog.md): that route rendered this staff content
 * *or* the public schedule depending on session, which meant a signed-out
 * diver and a signed-in owner could never both point at the same URL and
 * mean the same thing. `/schedule` is now the public, canonical page this
 * board's own "View public page" link previews.
 */
export default async function ScheduleBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<BoardSearchParams>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const query = await searchParams;
  const { builder, count, created, held, tell, series, add, date, course, requests, site, week } =
    query;
  const actionResultKey =
    query.result ??
    (builder ? [builder, count, created, series].filter(Boolean).join(":") : undefined);
  const requestIds = [
    ...new Set(
      (requests ?? "")
        .split(",")
        .map((value) => uuidParam(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const draftBinding = bindFormDraft(session.user);

  const tz = shop.timezone;
  // Some of this staff page's copy (the header eyebrow/title/description,
  // the empty-board line) has always lived in the diver bundle rather than
  // the staff one — pre-existing, unrelated to this split, left as-is.
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const st = staffTranslator(locale);
  const now = nowDate();
  const todayIso = toDateInputValue(utcToWallTime(now, tz));
  // Which week the desktop grid draws. Total by construction: a malformed or missing `?week=`
  // lands on the one the shop is in rather than refusing the page (`src/lib/week-board.ts`).
  const weekStartIso = resolveWeekStart(week, todayIso);
  const returnWeek = week ? weekStartIso : undefined;

  // The upcoming stream, the week grid and what it is read beside, the fleet, the week's date
  // requests, and the add panel's draft and requested course, site and requests, in one wave
  // (`getScheduleBoardPage`). Builder catalog options load lazily when the add panel opens.
  const {
    draft,
    range,
    canConfigure,
    openRollCalls,
    shopBoats,
    weekRows,
    weekAsks,
    boatsEverOwned,
    weekAround,
    requestedCourse,
    requestedSite,
    requestRows,
  } = await getScheduleBoardPage(db, shop, session.user.personId, {
    weekStartIso,
    now,
    course,
    site,
    requestIds,
  });
  const addDraft = draftForForm(draft, locale, shop.timezone);
  const boatMap = new Map(boatsEverOwned.map((boat) => [boat.id, boat.name]));
  const hasUpcoming = range.first !== null;
  const requestPlan = builderRequestPlan({ requestRows, shop, shopBoats, st });

  const builderNotice = builderNoticeFor({ builder, count, created, series, st });
  const rescheduleNotice =
    builder === "moved" || (held !== undefined && tell !== undefined)
      ? await resolveRescheduleNoticeSnapshot({
          shopId: shop.id,
          heldId: held,
          tell,
          t: st,
          locale,
        })
      : null;
  const gearNotice = builder === "moved" ? verifiedGearMoveNotice(query.result, shop.id, st) : null;
  const builderCopy = scheduleBuilderCopy(st, shop.timezone);

  const builderMore = scheduleBuilderMore(st, locale);

  // `?course=` always implies an open panel: it would otherwise land on a board
  // that silently swallowed the course the link named.
  const addPanelState =
    add === "full" ? "expanded" : add || requestedCourse || requestedSite ? "quick" : "closed";

  const initialCourse: BuilderInitialCourse | null = requestedCourse
    ? {
        id: requestedCourse.id,
        title: requestedCourse.title,
        requirement: requestedCourse.minimumCertificationLevel
          ? st("schedule.builder.courseCertRequired", {
              level: st(CERTIFICATION_LEVEL_KEYS[requestedCourse.minimumCertificationLevel]),
            })
          : st("schedule.builder.courseNoCardRequired"),
        priceLabel: builderCoursePriceLabel(requestedCourse, shop, locale),
      }
    : null;

  const initialSite: BuilderInitialSite | null = requestedSite
    ? {
        id: requestedSite.id,
        name: requestedSite.name,
      }
    : null;

  // The price box follows the shop's currency, same as the full trip form:
  // whole-number entry and a symbol-only placeholder for a zero-decimal
  // currency, where "$0.00" would be wrong twice over.
  const currency = toShopCurrency(shop.currency);
  const priceInput = builderPriceInput(currency, locale);

  // The date an add panel opens on when the URL names none. Read off
  // `upcomingScheduleRange` since the stream that used to supply the first row
  // of a cursor page went (#1923): it is the same fact — the shop's next
  // departure — from the query that was already being made for it.
  const firstUpcomingDateIso = range.first
    ? toDateInputValue(utcToWallTime(range.first, tz))
    : null;
  const builderWeek = boardWeekView({
    shopSlug,
    weekStartIso,
    todayIso,
    range,
    weekRows,
    weekAsks,
    openRollCalls,
    ...weekAround,
    boatMap,
    shop,
    boatCount: shopBoats.length,
    hasUpcoming,
    currency,
    locale,
    tz,
    st,
  });

  return (
    <BoardPageShell
      hasUpcoming={hasUpcoming}
      canConfigure={canConfigure}
      shopSlug={shopSlug}
      returnWeek={returnWeek}
      st={st}
    >
      <ScheduleViews
        shopSlug={shopSlug}
        crewSchedule={shop.crewScheduleEnabled}
        current="week"
        week={weekStartIso}
        copy={{
          label: st("schedule.views.label"),
          week: st("schedule.views.week"),
          crew: st("schedule.views.crew"),
        }}
      />

      {/* The four-tile overview row is gone on purpose: "Departures 46 /
          Booked 196" aggregated a horizon nobody acts on as a number, and on
          a phone it pushed the first departure two screens down. The board
          rows carry the operational facts (design/principles.md #10:
          remove until it breaks). */}
      <ScheduleBoardNoticeView
        notice={builderNotice}
        initialNotice={rescheduleNotice}
        gearMessage={gearNotice?.message}
        resultId={gearNotice?.id}
        resultKey={actionResultKey}
      />

      {!hasUpcoming ? (
        <EmptyState
          title={t("schedule.noUpcomingStaff")}
          body={t("schedule.noTripsStaff")}
          // Gated on the same live check the header's add link uses. It was
          // ungated while the header carried a gated twin, which was survivable
          // — a captain who tapped it got the builder's view-only notice. Now
          // that the header stands down here it is the page's only control, and
          // a lone primary that leads to a refusal is a worse empty state than
          // no button at all. A staffer who cannot schedule sees the sentence
          // and nothing to press, which is the truth.
          action={
            canConfigure ? (
              <Link
                href={`/shop/${shopSlug}/schedule/board?add=1${returnWeek ? `&week=${returnWeek}` : ""}`}
                scroll={false}
                className={buttonClass()}
              >
                {st("schedule.scheduleTrip")}
              </Link>
            ) : undefined
          }
        />
      ) : null}

      <ScheduleBuilder
        key={draftBinding.scope}
        context={{
          shopSlug,
          locale,
          addDraft,
          loadPattern: loadWeekdayPatternAction,
          loadTideWindow: loadTideWindowAction,
          loadOptions: loadBuilderOptionsAction,
          initialOptions:
            addPanelState !== "closed" && canConfigure ? await loadBuilderOptionsAction() : null,
          loadMovePreflight: loadMovePreflightAction,
          price: priceInput,
          // Only a real `YYYY-MM-DD` from `?date=` is honoured; anything else
          // falls back to the soonest day already on the board.
          defaultDateIso:
            date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (firstUpcomingDateIso ?? todayIso),
          canConfigure,
          copy: builderCopy,
          more: builderMore,
          initialCourse,
          initialSite,
          requestPlan,
          openAdd: addPanelState,
          returnWeek,
          week: builderWeek,
          actions: {
            add: addDepartureAction.bind(null, shopSlug),
            move: moveDepartureAction.bind(null, shopSlug),
            duplicate: duplicateDepartureAction.bind(null, shopSlug),
            remove: removeDepartureAction.bind(null, shopSlug),
            draft: draftBinding.actions,
          },
        }}
      />
    </BoardPageShell>
  );
}
