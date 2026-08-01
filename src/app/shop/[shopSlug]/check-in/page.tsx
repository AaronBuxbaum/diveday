import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { EmptyState } from "@/components/EmptyState";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { WaiverSendControl } from "@/components/today/WaiverSendControl";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { listCheckInQueue } from "@/db/check-in";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { blockerFixFor } from "@/lib/blockers";
import { allDiversCheckedIn } from "@/lib/check-in";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { checkInAction } from "./actions";
import { CheckInSearch } from "./CheckInSearch";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Check-in — DiveDay",
};

/**
 * A notice query param maps to a message key, never to a sentence — the words
 * come from the staff bundle at render time (docs ADR
 * 20260730-staff-copy-localization). Typing the value as `StaffMessageKey`
 * makes a stale key a compile error rather than a rendered key on screen.
 */
const noticeCopy: Record<
  string,
  { tone: "success" | "danger" | "warning" | "neutral"; key: StaffMessageKey }
> = {
  checked_in: { tone: "success", key: "checkIn.notice.checkedIn" },
  already_checked_in: { tone: "neutral", key: "checkIn.notice.alreadyCheckedIn" },
  not_ready: { tone: "warning", key: "checkIn.notice.notReady" },
  not_bookable: { tone: "danger", key: "checkIn.notice.notBookable" },
  not_found: { tone: "danger", key: "checkIn.notice.notFound" },
  staff_not_found: { tone: "danger", key: "checkIn.notice.staffNotFound" },
  invalid: { tone: "danger", key: "checkIn.notice.invalid" },
  walkin_added: { tone: "success", key: "checkIn.notice.walkinAdded" },
  walkin_full: { tone: "danger", key: "checkIn.notice.walkinFull" },
  walkin_already: { tone: "neutral", key: "checkIn.notice.walkinAlready" },
  walkin_unavailable: { tone: "danger", key: "checkIn.notice.walkinUnavailable" },
  walkin_invalid: { tone: "danger", key: "checkIn.notice.walkinInvalid" },
};

export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ q?: string; notice?: string; bid?: string; tid?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { q, notice, bid, tid } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.id !== session.user.shopId) notFound();
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const query = q?.trim() ?? "";
  const queue = await listCheckInQueue(db, shop.id, { query });
  const copy = noticeFromParam(notice, noticeCopy);
  // The `not_ready` refusal links straight to the diver's guest row instead
  // of just naming the problem — the same rich-link pattern the manifest's
  // `not_ready` refusal already uses (trips/[id]/manifest/page.tsx). The
  // message itself always carries the `<guestsLink>` tag, so this always
  // resolves with `t.rich`, never plain `t()` — falling back to the queue
  // itself on the vanishingly unlikely chance `bid`/`tid` didn't round-trip.
  const notReadyHref =
    bid && tid
      ? `/shop/${shopSlug}/trips/${tid}/guests#booking-${bid}`
      : `/shop/${shopSlug}/check-in`;
  const noticeContent =
    copy?.key === "checkIn.notice.notReady"
      ? t.rich("checkIn.notice.notReady", {
          guestsLink: (chunks) => <Link href={notReadyHref}>{chunks}</Link>,
        })
      : copy
        ? t(copy.key)
        : null;
  // Only the full, unsearched day's roster can be "cleared" — a filtered
  // search matching one already-checked-in diver says nothing about anyone
  // else still pending elsewhere.
  const cleared = !query && allDiversCheckedIn(queue);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("checkIn.eyebrow")}
        title={t("checkIn.title")}
        description={t("checkIn.description")}
        // Today, Blockers, and Check-in each slice the same readiness data on
        // a different, undocumented horizon (task 141, UX persona lens 17) —
        // a diver "cleared" here can still show on one of the other two.
        meta={<p className="text-sm text-muted">{t("checkIn.windowNote")}</p>}
        actions={
          <Link href={`/shop/${shopSlug}/check-in/walk-in`} className={buttonClass()}>
            {t("checkIn.walkIn.title")}
          </Link>
        }
      />

      {copy ? (
        <ShopNotice tone={copy.tone} className="mb-6">
          {noticeContent}
        </ShopNotice>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <CheckInSearch
          query={query}
          copy={{
            label: t("checkIn.search.label"),
            hint: t("checkIn.search.hint"),
            placeholder: t("checkIn.search.placeholder"),
            submit: t("checkIn.search.submit"),
          }}
        />
      </section>

      <section aria-label={t("checkIn.queueAriaLabel")} className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{t("checkIn.readyHeading")}</h2>
            <p className="mt-1 text-sm text-muted">
              {query ? t("checkIn.searchResultsFor", { query }) : t("checkIn.todaysDepartures")}
            </p>
          </div>
          <Badge tone="neutral" tabularNums>
            {t("checkIn.diverCount", { count: queue.length })}
          </Badge>
        </div>

        {queue.length === 0 ? (
          <EmptyState>
            <h3 className="font-semibold">{t("checkIn.emptyTitle")}</h3>
            <p className="mt-1 text-sm text-muted">{t("checkIn.emptyDescription")}</p>
          </EmptyState>
        ) : cleared ? (
          <div className="rounded-2xl border border-dashed border-success/40 bg-success/5 p-8 text-center">
            <h3 className="font-semibold text-success">
              {t("checkIn.clearedTitle", { count: queue.length })}
            </h3>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map((row) => {
              const ready = row.readiness.status === "ready";
              const checkedIn = row.bookingStatus === "checked_in";
              const fix = ready
                ? null
                : blockerFixFor(
                    row.readiness.blockers,
                    {
                      shopSlug,
                      tripId: row.tripId,
                      personId: row.personId,
                      bookingId: row.bookingId,
                      fullName: row.personName,
                    },
                    t,
                  );
              return (
                <article
                  key={row.bookingId}
                  data-testid={`check-in-card-${row.bookingId}`}
                  className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/shop/${shopSlug}/divers/${row.personId}`}
                          className="text-lg font-semibold hover:text-primary hover:underline"
                        >
                          {row.personName}
                        </Link>
                        {checkedIn ? (
                          <Badge tone="success">{t("checkIn.checkedInBadge")}</Badge>
                        ) : null}
                        {/* The check-in queue's own description promises this
                            split — check-in is arrival, boarding is confirmed
                            on the manifest — but the queue never actually
                            showed it (task 149, UX persona lens 17). */}
                        {row.boarded ? (
                          <Badge tone="primary">{t("checkIn.boardedBadge")}</Badge>
                        ) : null}
                      </div>
                      <Link
                        href={`/shop/${shopSlug}/trips/${row.tripId}/manifest`}
                        className="mt-1 block text-sm font-medium text-primary hover:underline"
                      >
                        {row.tripTitle}
                      </Link>
                      <p className="mt-1 text-sm text-muted">
                        {formatShortDate(row.startsAt, locale, shop.timezone)} ·{" "}
                        {formatTimeRange(row.startsAt, row.endsAt, locale, shop.timezone)}
                      </p>
                      {row.email ? (
                        <p className="mt-1 truncate text-xs text-muted">{row.email}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={ready ? "success" : "warning"}>
                        {ready ? t("checkIn.readyBadge") : t("checkIn.needsAttentionBadge")}
                      </Badge>
                      {checkedIn ? null : ready ? (
                        <form action={checkInAction.bind(null, shopSlug)}>
                          <input type="hidden" name="bookingId" value={row.bookingId} />
                          <button
                            type="submit"
                            className={buttonClass({ className: "whitespace-nowrap" })}
                            aria-label={t("checkIn.checkInAriaLabel", { name: row.personName })}
                          >
                            {t("checkIn.checkInButton")}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  {!ready ? (
                    <>
                      <ul className="mt-4 space-y-1 border-t border-border pt-3 text-sm text-warning">
                        {row.readiness.blockers.slice(0, 3).map((blocker) => (
                          <li key={blocker.code}>• {readinessBlockerText(t, blocker)}</li>
                        ))}
                        {row.readiness.blockers.length > 3 ? (
                          <li>
                            {t("checkIn.blockersMore", {
                              count: row.readiness.blockers.length - 3,
                            })}
                          </li>
                        ) : null}
                      </ul>
                      {fix ? (
                        <div className="mt-3">
                          {fix.sendsWaiver ? (
                            <WaiverSendControl
                              shopSlug={shopSlug}
                              surface="check_in"
                              bookingIds={[fix.bookingId]}
                              label={fix.label}
                              copy={waiverSendCopy(t)}
                            />
                          ) : (
                            <Link
                              href={fix.href}
                              className={buttonClass({ variant: "secondary", size: "sm" })}
                            >
                              {fix.label}
                            </Link>
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
