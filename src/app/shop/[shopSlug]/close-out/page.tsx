import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { KindChip } from "@/components/today/KindChip";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { closeDay, getDayCloseout } from "@/db/closeout";
import { getShopById } from "@/db/shops";
import {
  CLOSEOUT_DECISION_KEYS,
  CLOSEOUT_HEADLINE_KEYS,
  CLOSEOUT_STATUS_KEYS,
  CLOSEOUT_SUBTITLE_KEYS,
  closeoutDepartureDetailText,
} from "@/i18n/closeout-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { openRollCallActionText } from "@/i18n/today-labels";
import { canViewShopReports } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  CLOSEOUT_STATUS_TONES,
  type CloseoutDeparture,
  type LeftoverDecision,
} from "@/lib/closeout";
import { formatShortDate, formatTime } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Close-out — DiveDay" };

/** `CLOSEOUT_STATUS_TONES` → the shared Badge vocabulary. */
const STATUS_BADGE_TONES: Record<"danger" | "warning" | "neutral" | "positive", BadgeTone> = {
  danger: "danger",
  warning: "warning",
  neutral: "neutral",
  positive: "success",
};

/**
 * The end-of-day close-out (ADR 20260804-day-closeout): the evening mirror of
 * Today. One pass before walking out — how every boat ended, what from today
 * is still open (with an explicit carry/dismiss choice), and what tomorrow
 * opens with. Closing is a recorded act, never a lock: an open head count
 * makes the close deliberate (an acknowledgement, by name), not impossible,
 * and nothing downstream conditions on the day being closed.
 */
export default async function CloseOutPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ closed?: string }>;
}) {
  const [session, { shopSlug }, { closed }] = await Promise.all([
    requireStaffSession(),
    params,
    searchParams,
  ]);
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(`/shop/${shopSlug}`);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const now = nowDate();

  const { state, latest, closeCount } = await getDayCloseout(
    db,
    shop.id,
    shopSlug,
    shop.timezone,
    now,
    t,
    locale,
    // Same gate as Today's own queue: the leftovers list is "what the queue
    // still shows *you*", so it must hold the same rows for the same viewer.
    canViewShopReports(session.user.roles),
  );

  async function closeDayAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const actionDb = await getDb();
    const actionShop = await getShopById(actionDb, staff.user.shopId);
    if (!actionShop) redirect(`/shop/${staff.user.shopSlug}`);
    const actionLocale = await requestLocale(actionShop.defaultLocale);
    // `Object.create(null)`: the keys are form-supplied action ids, and a
    // prototype-shaped key ("__proto__") must land nowhere.
    const decisions: Record<string, LeftoverDecision> = Object.create(null);
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("decision:") && (value === "carry" || value === "dismiss")) {
        decisions[key.slice("decision:".length)] = value;
      }
    }
    await closeDay(actionDb, {
      shopId: actionShop.id,
      shopSlug: staff.user.shopSlug,
      timeZone: actionShop.timezone,
      actorPersonId: staff.user.personId,
      decisions,
      t: staffTranslator(actionLocale),
      locale: actionLocale,
      includeOpsAlerts: canViewShopReports(staff.user.roles),
    });
    revalidateAndRedirect(`/shop/${staff.user.shopSlug}/close-out?closed=1`);
  }

  const detailTime = (departure: CloseoutDeparture) =>
    formatTime(
      departure.status === "not_departed" ? departure.startsAt : departure.endsAt,
      locale,
      shop.timezone,
    );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["closed"]} />
      <ShopPageHeader
        eyebrow={`${t("closeout.title")} · ${formatShortDate(now, locale, shop.timezone)}`}
        title={t(CLOSEOUT_HEADLINE_KEYS[state.shape])}
        description={t(CLOSEOUT_SUBTITLE_KEYS[state.shape])}
      />

      {closed ? (
        <div className="mb-6">
          <ShopNotice tone="success" role="status">
            {t("closeout.notice.closed")}
          </ShopNotice>
        </div>
      ) : null}

      {latest ? (
        <section
          aria-labelledby="closeout-record-heading"
          // Success-tinted only when the record says nothing was outstanding:
          // a green box listing an unreconciled head count would be the card
          // contradicting its own contents.
          className={`mb-8 rounded-2xl border p-5 sm:p-6 ${
            latest.outstanding.departures.length === 0 && latest.outstanding.leftovers.length === 0
              ? "border-success/40 bg-success/5"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="closeout-record-heading" className="font-semibold">
              {t("closeout.record.heading")}
            </h2>
            {closeCount > 1 ? (
              <p className="text-sm text-muted">
                {t("closeout.record.closeCount", { count: closeCount })}
              </p>
            ) : null}
          </div>
          <p className="mt-1 text-muted">
            {t("closeout.record.closedBy", {
              name: latest.actorName,
              time: formatTime(latest.closedAt, locale, shop.timezone),
            })}
          </p>
          {latest.outstanding.departures.length === 0 &&
          latest.outstanding.leftovers.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t("closeout.record.nothingOutstanding")}</p>
          ) : (
            <div className="mt-3">
              <h3 className="text-xs font-bold tracking-wide text-muted uppercase">
                {t("closeout.record.outstandingHeading")}
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {latest.outstanding.departures.map((departure) => (
                  <li key={`dep-${departure.tripId}`}>
                    <span className="font-medium">{departure.title}</span>{" "}
                    <span className="text-muted">
                      — {t(CLOSEOUT_STATUS_KEYS[departure.status])}
                    </span>
                  </li>
                ))}
                {latest.outstanding.leftovers.map((leftover) => (
                  <li key={`left-${leftover.id}`}>
                    <span className="font-medium">{leftover.subject}</span>{" "}
                    <span className="text-muted">
                      — {t(CLOSEOUT_DECISION_KEYS[leftover.decision])}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-sm text-muted">{t("closeout.subtitle.closedSoFar")}</p>
        </section>
      ) : null}

      <section aria-labelledby="closeout-departures-heading" className="mb-10">
        <h2 id="closeout-departures-heading" className="text-lg font-semibold">
          {t("closeout.departures.heading")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("closeout.departures.subtitle")}</p>
        {state.departures.length === 0 ? (
          <EmptyState className="mt-4">
            <p className="text-sm text-muted">{t("closeout.departures.empty")}</p>
          </EmptyState>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {state.departures.map((departure) => {
              const tone = CLOSEOUT_STATUS_TONES[departure.status];
              const checkpoint =
                departure.diveNumber >= 1 ? `after_dive_${departure.diveNumber}` : "departure";
              return (
                <li
                  key={departure.tripId}
                  className={`rounded-2xl border bg-surface p-4 shadow-sm sm:p-5 ${
                    tone === "danger" ? "border-danger/40" : "border-border"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={STATUS_BADGE_TONES[tone]}>
                          {t(CLOSEOUT_STATUS_KEYS[departure.status])}
                        </Badge>
                        <p className="font-semibold">{departure.title}</p>
                        <p className="text-sm text-muted">
                          {formatTime(departure.startsAt, locale, shop.timezone)}
                        </p>
                      </div>
                      <p className="mt-1.5 text-muted">
                        {closeoutDepartureDetailText(t, departure, detailTime(departure))}
                      </p>
                    </div>
                    {departure.gapReason ? (
                      <Link
                        href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest?checkpoint=${checkpoint}`}
                        className={buttonClass({ variant: "secondary", className: "shrink-0" })}
                      >
                        {openRollCallActionText(t)}
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form action={closeDayAction}>
        <section aria-labelledby="closeout-leftovers-heading" className="mb-10">
          <h2 id="closeout-leftovers-heading" className="text-lg font-semibold">
            {t("closeout.leftovers.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("closeout.leftovers.subtitle")}</p>
          {state.leftovers.length === 0 ? (
            <EmptyState className="mt-4">
              <p className="text-sm text-muted">{t("closeout.leftovers.empty")}</p>
            </EmptyState>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {state.leftovers.map((action) => (
                <li
                  key={action.id}
                  className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <KindChip kind={action.kind} t={t} />
                        <Link href={action.href} className="font-semibold hover:underline">
                          {action.subject}
                        </Link>
                        {action.context ? (
                          <p className="text-sm text-muted">{action.context}</p>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-muted">{action.detail}</p>
                    </div>
                    <fieldset
                      className="flex shrink-0 items-center gap-4"
                      aria-label={t("closeout.leftovers.decisionLabel", {
                        subject: action.subject,
                      })}
                    >
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`decision:${action.id}`}
                          value="carry"
                          defaultChecked
                          className="size-4 shrink-0"
                        />
                        {t("closeout.leftovers.carry")}
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`decision:${action.id}`}
                          value="dismiss"
                          className="size-4 shrink-0"
                        />
                        {t("closeout.leftovers.dismiss")}
                      </label>
                    </fieldset>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="closeout-close-heading"
          className="mb-10 rounded-2xl border border-border bg-surface p-5 sm:p-6"
        >
          <h2 id="closeout-close-heading" className="font-semibold">
            {t("closeout.close.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("closeout.close.note")}</p>
          {state.mustAcknowledge.length > 0 ? (
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm">
              <input
                type="checkbox"
                name="acknowledge"
                required
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                {t("closeout.close.acknowledge", { count: state.mustAcknowledge.length })}
              </span>
            </label>
          ) : null}
          <div className="mt-4">
            <SubmitButton pendingLabel={t("closeout.close.button")} className={buttonClass()}>
              {latest ? t("closeout.close.buttonAgain") : t("closeout.close.button")}
            </SubmitButton>
          </div>
        </section>
      </form>

      {/* Tomorrow is a *handoff*, not a second queue. This section used to
          re-render tomorrow's `TodayAction` rows with none of Today's inline
          controls — the same row that sends a waiver, invites from the
          waitlist, or copies a payment link on the shop home was a dumb list
          here, which taught staff those jobs wait until morning. A surface that
          re-renders another's evidence is a view, not a route (ADR
          20260803-not-ready-is-a-view), and the same reasoning applies to a
          section: state how much is waiting, name it in the queue's own chips,
          and hand the work to the surface that owns it. */}
      <section aria-labelledby="closeout-tomorrow-heading" className="mb-6">
        <h2 id="closeout-tomorrow-heading" className="text-lg font-semibold">
          {t("closeout.tomorrow.heading")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("closeout.tomorrow.subtitle")}</p>
        {state.tomorrow.total === 0 ? (
          <EmptyState className="mt-4">
            <p className="text-sm text-muted">{t("closeout.tomorrow.empty")}</p>
          </EmptyState>
        ) : (
          <div className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
            <p className="font-semibold">
              {t("closeout.tomorrow.count", { count: state.tomorrow.total })}
            </p>
            {/* The tally rides *inside* each chip. Set beside one it was bound
                to its label by a 2px gap difference, and a row of them wrapping
                at 390px read as loose digits. */}
            <ul className="mt-3 flex flex-wrap items-center gap-2">
              {state.tomorrow.byKind.map((entry) => (
                <li key={entry.kind}>
                  <KindChip kind={entry.kind} count={entry.count} t={t} />
                </li>
              ))}
            </ul>
            <Link
              href={`/shop/${shopSlug}`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {t("closeout.tomorrow.openToday")}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
