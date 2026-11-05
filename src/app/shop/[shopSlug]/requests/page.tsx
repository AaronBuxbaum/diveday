import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import { getRequestsPage } from "@/db/requests-page";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { canQuoteCharter } from "@/lib/authz";
import { formatCalendarDate } from "@/lib/calendar-date";
import { addDepartureHref } from "@/lib/date-requests";
import { displayStoredPhone } from "@/lib/forgiving-fields";
import { formatShortDate } from "@/lib/format";
import { INTEREST_REPLY_DAILY_CAP, interestReplyRoute } from "@/lib/interest-reply";
import { adviseRequests, departureShapeFor } from "@/lib/request-advisor";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { StaffSectionTabs } from "../_components/StaffSectionTabs";
import { RequestDayGroup, requestAdviceLines } from "./_components/RequestDayGroup";
import { RequestDoneRow } from "./_components/RequestDoneRow";
import { RequestLedgerRow } from "./_components/RequestLedgerRow";
import { RequestReferenceRow } from "./_components/RequestReferenceRow";
import { type RequestReplyNotice, replyToRequestAction, setRequestOutcomeAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately — it is this segment's `loading.tsx` that stands in while the
// request-scoped reads stream, exactly as on every other staff list. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Requests — DiveDay",
};

/**
 * **Every date a diver asked for that the board has nothing on** (ADR
 * 20260827-people-not-lists, decision 5; the language is
 * 20260827-clearwater-surface-language).
 *
 * The grouping rules are `groupDateRequests` (src/lib/date-requests.ts) and
 * this page adds none of its own: one group per named date, a request in every
 * group it could make, flexible requests travelling to nearby days, and the
 * ones that named no date at all at the foot.
 *
 * What the redesign moved is where a day's facts live. **The group header owns
 * the count, the advice and the act** — "Mar 6, 2027 — 2 groups · 5 divers",
 * the hull and the crew the planner would put on it, and the one link into the
 * schedule builder, pre-dated and carrying these interests forward — drawn only
 * for a reader who may create a departure (issue #1831). The rows
 * beneath are hairline ledger rows saying only who asked and what for; the
 * tinted "Planning suggestion" card and the per-row match badges went with it
 * (`RequestLedgerRow`).
 *
 * **Three things that repeated down the page, and no longer do:**
 *
 * - A request reached by two groups was printed whole under both. It renders in
 *   full under `homeDate` and as a one-line reference everywhere else
 *   (`RequestReferenceRow`).
 * - The planner's advice was restated under every group heading, word for word,
 *   because most days advise the same hull and the same crew. It renders when
 *   it changes — and always when it carries the warning, which is a state
 *   rather than a shared fact.
 * - Every group carried a `secondary` "Add a departure". The first one keeps
 *   it; the rest are `link` weight, because a column of filled buttons down a
 *   page is the reader doing triage the design should have done (principle 8).
 *
 * These are **course inquiries** (ADR
 * 20260814-a-date-request-is-a-course-inquiry): a request for a departure to
 * exist. Never the wait list, which answers "tell me when a seat frees", and
 * never the last-minute deal list.
 */
export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string; notice?: string; request?: string }>;
}) {
  const { shopSlug } = await params;
  const { page, notice, request: noticeRequest } = await searchParams;
  // **No role gate, since 2026-09-16** (issue #1679, an H-20260724-staff-role-reach amendment). This
  // read `allow: canPersonViewShopReports` with a refusal notice, on the
  // written ground that the rows carry contact details for people who have not
  // booked. The shop inbox renders the same thing — a stranger's address or
  // number, their subject, their message — to every live staff role and lets
  // them answer as the shop, and has since 2026-09-10. The gate was deleted
  // rather than relaxed, the way the inbox's was, so there is nothing left here
  // to drift out of step with it.
  const { session, db, shop } = await requireShopSurface(shopSlug);
  // Date requests switched off (the Features page): the tab is gone, and so
  // is the page once no course inquiry is left waiting on it — those still
  // arrive, because a course page's inquiry is not part of that switch.
  //
  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range, so a bookmarked page past the end lands on the last real one. The
  // closed interests (third UX review, item 13) sit off the days, under "Done".
  //
  // **Reading a day is every role's; putting a boat on it is not** (issue
  // #1831). The day's act lands on the schedule builder, whose add panel is
  // `canConfigureTrips` — owner, manager, instructor (H-20260724-staff-role-reach). Asked with
  // the same live check the board asks, so the link and the panel cannot
  // disagree; a captain sees the day and its interests, and no act they would
  // be refused (ADR 20260724-role-gated-surfaces-hide-not-explain).
  //
  // **Departures already on the board for these days** (ADR
  // 20261017-one-interest-with-a-scope): a day whose interests were listed as if nothing
  // existed for them now says what does.
  const requests = await getRequestsPage(
    db,
    shop,
    session.user.personId,
    Number.parseInt(page ?? "", 10),
  );
  if (requests.gone) redirect(shopPath(shopSlug, "inbox"));
  const { requestPage, handled, boats: shopBoats, groups, undated, boardByDate } = requests;
  const canAddDeparture = requests.can.addDeparture;
  const locale = await requestLocale(shop.defaultLocale);
  const timezone = shop.timezone;
  const t = staffTranslator(locale);
  // A boat shop plans a day against its hulls and is the only kind of shop
  // shown one; every shop, hull or not, crews it against its own target ratio.
  const departureShape = departureShapeFor(
    shop,
    shopBoats.map((b) => ({ id: b.id, name: b.name, capacity: b.capacity })),
  );
  const base = shopPath(shopSlug, "requests");
  // The one notice this page answers, and it is genuinely about the page rather
  // than about a form on it: the staffer wrote a caller down on "Took a call"
  // and arrived here, where the interest now lives (`?notice=` via `noticeFromParam`,
  // never a bare index — the param is attacker-supplied).
  const logged = noticeFromParam(notice, { "call-logged": true as const });
  // A reply's outcome (issue #2555). One that went, or found the request closed,
  // is the page's: the row is under Done. One that did not go belongs to its
  // row, which `?request=` names and which opens with the reason under its box.
  const replyNotice = noticeFromParam<{ tone: "success" | "danger"; row: boolean }>(notice, {
    "reply-sent": { tone: "success", row: false },
    "reply-closed": { tone: "danger", row: false },
    "reply-failed": { tone: "danger", row: true },
    "reply-refused": { tone: "danger", row: true },
    "reply-capped": { tone: "danger", row: true },
    "reply-bad-quote": { tone: "danger", row: true },
    "reply-quote-not-allowed": { tone: "danger", row: true },
    "reply-send-limit": { tone: "danger", row: true },
  } satisfies Record<RequestReplyNotice, { tone: "success" | "danger"; row: boolean }>);
  const replyWords: Record<RequestReplyNotice, string> = {
    "reply-sent": t("requests.replyNotice.sent"),
    "reply-closed": t("requests.replyNotice.closed"),
    "reply-failed": t("requests.replyNotice.failed"),
    "reply-refused": t("requests.replyNotice.refused"),
    "reply-capped": t("requests.replyNotice.capped", { count: INTEREST_REPLY_DAILY_CAP }),
    "reply-bad-quote": t("requests.replyNotice.badQuote"),
    "reply-quote-not-allowed": t("requests.replyNotice.quoteNotAllowed"),
    "reply-send-limit": t("shared.limits.sendLimit", { thing: "replies" }),
  };
  const replyAction = replyToRequestAction.bind(null, shopSlug);
  // The form, for a request a reply can reach (`interestReplyRoute`); the
  // address it names is the request's own.
  const replyFor = (request: (typeof undated)[number]) => {
    const route = interestReplyRoute(request, shop.addressCountry);
    if (!route) return undefined;
    return {
      action: replyAction,
      copy: {
        open: t("requests.replyForm.open"),
        label: t("requests.replyForm.label"),
        destination:
          route.channel === "email"
            ? t("requests.replyForm.toEmail", { to: route.to })
            : t("requests.replyForm.toText", { to: displayStoredPhone(route.to) }),
        send: t("requests.replyForm.send"),
        sending: t("words.busy.sending"),
      },
      // A private charter is answered with a price for the whole boat (loop 5, row 11).
      // A price is owner and manager work (`canQuoteCharter`); the writer checks again.
      quote:
        request.charter && canQuoteCharter(session.user.roles)
          ? {
              label: t("requests.replyForm.quoteLabel"),
              hint: t("requests.replyForm.quoteHint"),
              currency: shop.currency,
              locale,
              copy: forgivingCopy(t),
            }
          : undefined,
      error:
        replyNotice?.row && noticeRequest === request.id && notice
          ? replyWords[notice as RequestReplyNotice]
          : undefined,
    };
  };
  // The advice the group above printed, so a day that would say the same thing
  // says nothing. Reassigned while mapping the groups, in their render order.
  let previousAdvice = "";
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);
  const outcomeAction = setRequestOutcomeAction.bind(null, shopSlug);
  const done = handled.flatMap((request) =>
    request.closedAt && request.closedAs
      ? [{ ...request, closedAt: request.closedAt, closedAs: request.closedAs }]
      : [],
  );

  // Nothing open: the empty state only when nothing was ever asked, or it
  // would sit above the Done list saying there were no requests.
  const emptyState =
    done.length === 0 ? (
      <EmptyState title={t("requests.emptyHeading")} body={t("requests.emptyDetail")} />
    ) : null;

  return (
    <StaffPage width="reading">
      <ShopPageHeader title={t("shared.shopSections.inbox")} />
      <StaffSectionTabs
        section="inbox"
        current="requests"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />

      {logged ? (
        <StaffNoticeBanner tone="success" className="mt-6">
          {t("calls.notice.logged")}
        </StaffNoticeBanner>
      ) : null}
      {replyNotice && !replyNotice.row && notice ? (
        <StaffNoticeBanner tone={replyNotice.tone} className="mt-6">
          {replyWords[notice as RequestReplyNotice]}
        </StaffNoticeBanner>
      ) : null}

      {requestPage.total === 0 ? (
        emptyState
      ) : (
        // One rhythm between groups, the page-section spacing every staff
        // surface uses — never a per-section `mt-*` that drifts.
        <div className="space-y-10">
          {groups.map((group) => {
            const advice = adviseRequests(
              group.entries.map(({ request }) => ({
                id: request.id,
                divers: request.partySize,
                experienceLevel: request.experienceLevel,
                courseId: request.courseId,
              })),
              departureShape,
            );
            const lines = requestAdviceLines(
              // No divemaster count for a shop that keeps no crew schedule.
              shop.crewScheduleEnabled ? advice : { ...advice, suggestedDivemasters: 0 },
              shop.diversPerDivemaster,
              t,
            );
            // **The advice is a shared fact between days, not only within one.**
            // A shop with one hull and one ratio advises the same hull and the
            // same crew on every day that fits it, so the sentence stood
            // verbatim under every group heading. It renders when it says
            // something the group above did not — and always when it carries
            // the warning, because "more divers than any hull you own" is a
            // state rather than a repeated fact (principle 9, and the colour
            // rule in ADR 20260827-clearwater-surface-language).
            const joined = lines.map((line) => line.text).join("§");
            const repeats = joined === previousAdvice && !lines.some((l) => l.tone === "warning");
            previousAdvice = joined;
            // Offered on every day, "On the board" or not: a busy day can
            // still want a second boat for the people who asked. On each
            // request it answers, never in the day's header (visual review A23),
            // reference rows included, so a day of second choices keeps it.
            const openDeparture = canAddDeparture
              ? {
                  href: addDepartureHref(
                    shopSlug,
                    group.date,
                    group.entries.map(({ request }) => request.id),
                  ),
                  label: t("requests.openDeparture"),
                }
              : undefined;
            return (
              <RequestDayGroup
                key={group.date}
                id={`date-${group.date}`}
                label={t("requests.group.day", {
                  date: formatCalendarDate(group.date, locale),
                  groups: group.groupCount,
                  divers: advice.estimatedDivers,
                })}
                advice={repeats ? [] : lines}
                onBoard={(boardByDate.get(group.date) ?? []).map((departure) => ({
                  href: `${shopPath(shopSlug, "trips", departure.tripId)}#who-wants-in`,
                  label: t("requests.onTheBoard", {
                    when: formatShortDate(departure.startsAt, locale, timezone),
                    title: departure.title,
                    seats: departure.seatsLeft,
                  }),
                }))}
              >
                {group.entries.map((entry) =>
                  // The full record belongs to one group — the first date this
                  // request named. Everywhere else it reaches, it is a line
                  // pointing there (`src/lib/date-requests.ts`).
                  // The two halves of one fact: a first choice is always its
                  // request's home, and naming it that way is also what lets
                  // the reference row's prop exclude `preferred`.
                  entry.match === "preferred" || entry.homeDate === group.date ? (
                    <RequestLedgerRow
                      key={`${group.date}-${entry.request.id}`}
                      request={entry.request}
                      locale={locale}
                      timezone={timezone}
                      shopSlug={shopSlug}
                      shopName={shop.name}
                      markDoneAction={outcomeAction}
                      openDeparture={openDeparture}
                      reply={replyFor(entry.request)}
                      t={t}
                    />
                  ) : (
                    <RequestReferenceRow
                      key={`${group.date}-${entry.request.id}`}
                      request={entry.request}
                      match={entry.match}
                      homeDate={entry.homeDate}
                      locale={locale}
                      openDeparture={openDeparture}
                      t={t}
                    />
                  ),
                )}
              </RequestDayGroup>
            );
          })}

          {/* Last, always: prose a date field could not hold is still an interest,
              but it is not a day anyone can put a boat on — so this group has a
              count and no act. */}
          {undated.length > 0 ? (
            <RequestDayGroup
              id="no-date"
              label={t("requests.group.noDate", { count: undated.length })}
            >
              {undated.map((request) => (
                <RequestLedgerRow
                  key={request.id}
                  request={request}
                  locale={locale}
                  timezone={timezone}
                  shopSlug={shopSlug}
                  shopName={shop.name}
                  markDoneAction={outcomeAction}
                  reply={replyFor(request)}
                  t={t}
                />
              ))}
            </RequestDayGroup>
          ) : null}
        </div>
      )}

      {/* The closed interests, after every open one and outside the pager: they
          are here to reopen a mistaken tick, not to plan from. */}
      {done.length > 0 ? (
        <div className="mt-10">
          <RequestDayGroup id="done" label={t("requests.done.heading", { count: done.length })}>
            {done.map((request) => (
              <RequestDoneRow
                key={request.id}
                request={request}
                locale={locale}
                timezone={timezone}
                reopenAction={outcomeAction}
                t={t}
              />
            ))}
          </RequestDayGroup>
        </div>
      ) : null}

      <Pager
        page={requestPage.page}
        pageCount={requestPage.pageCount}
        href={pageHref}
        total={t("requests.pagination.total", { count: requestPage.total })}
        words={staffPagerWords(t)}
      />
    </StaffPage>
  );
}
