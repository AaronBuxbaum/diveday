import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KindChip } from "@/app/shop/[shopSlug]/_components/today/KindChip";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { canPersonExportIncidentRecord } from "@/db/authz";
import { getDb } from "@/db/client";
import { CloseoutAcknowledgementRequired, closeDay, getDayCloseout } from "@/db/closeout";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import {
  addCrewRecapPhoto,
  canAddCrewRecapPhoto,
  deleteCrewRecapPhoto,
  deleteRecapPhoto,
  hasSentTripRecap,
  sendTripRecaps,
  setTripRecapShoutout,
} from "@/db/recap";
import { getShopById } from "@/db/shops";
import {
  CLOSEOUT_ADMIN_STATUS_KEYS,
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
  type CloseoutAdminTaskStatus,
  type CloseoutDeparture,
  type LeftoverDecision,
} from "@/lib/closeout";
import { formatShortDate, formatTime } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { recapEligibleAt } from "@/lib/recap-schedule";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { deleteStoredImage, storeRecapImage } from "@/lib/storage";
import { RecapNoteEditor } from "./_components/RecapNoteEditor";

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

const ADMIN_STATUS_BADGE_TONES: Record<CloseoutAdminTaskStatus, BadgeTone> = {
  complete: "success",
  pending: "warning",
  attention: "danger",
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
  searchParams: Promise<{ closed?: string; noted?: string; notice?: string }>;
}) {
  const [{ shopSlug }, { closed, noted, notice }] = await Promise.all([params, searchParams]);
  const { session, db, shop } = await requireShopSurface(shopSlug);
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

  // Whether this staffer may generate a departure's log at all. Owner-only
  // (ADR 20260804-incident-export-owner-gate), checked against the database
  // rather than the session's roles so a demotion takes effect at once — and
  // resolved once here rather than per row. Absent, not disabled: the door
  // simply is not on anyone else's rows (AGENTS.md: gate by not rendering).
  const canGenerateLog = await canPersonExportIncidentRecord(db, shop.id, session.user.personId);

  async function closeDayAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const actionDb = await getDb();
    const actionShop = await getShopById(actionDb, staff.user.shopId);
    if (!actionShop) redirect(shopPath(staff.user.shopSlug));
    const actionLocale = await requestLocale(actionShop.defaultLocale);
    // `Object.create(null)`: the keys are form-supplied action ids, and a
    // prototype-shaped key ("__proto__") must land nowhere.
    const decisions: Record<string, LeftoverDecision> = Object.create(null);
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("decision:") && (value === "carry" || value === "dismiss")) {
        decisions[key.slice("decision:".length)] = value;
      }
    }
    const closeOut = shopPath(staff.user.shopSlug, "close-out");
    try {
      await closeDay(actionDb, {
        shopId: actionShop.id,
        shopSlug: staff.user.shopSlug,
        timeZone: actionShop.timezone,
        actorPersonId: staff.user.personId,
        decisions,
        acknowledged: formData.get("acknowledge") === "on",
        t: staffTranslator(actionLocale),
        locale: actionLocale,
        includeOpsAlerts: canViewShopReports(staff.user.roles),
      });
    } catch (error) {
      if (error instanceof CloseoutAcknowledgementRequired) {
        revalidateAndRedirect(closeOut, `${closeOut}?notice=acknowledge-required`);
      }
      throw error;
    }
    revalidateAndRedirect(`${closeOut}?closed=1`);
  }

  /**
   * Save one departure's post-trip recap note, from its own row. Every staff
   * role may write one, the same rule as closing the day itself: whoever came
   * back with the boat is who remembers the dive. `?noted=<tripId>` is what
   * re-opens that row with its confirmation after the redirect — a page-level
   * banner would answer a question asked six rows down.
   */
  async function saveRecapNoteAction(tripId: string, formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const actionDb = await getDb();
    if (await hasSentTripRecap(actionDb, staff.user.shopId, tripId)) {
      revalidateAndRedirect(
        shopPath(staff.user.shopSlug, "close-out"),
        noticeUrl(shopPath(staff.user.shopSlug, "close-out"), "recap-locked", { noted: tripId }),
      );
    }
    const note = String(formData.get("recapShoutout") ?? "").slice(0, 400);
    await setTripRecapShoutout(await getDb(), staff.user.shopId, tripId, note);
    const closeOut = shopPath(staff.user.shopSlug, "close-out");
    revalidateAndRedirect(closeOut, `${closeOut}?noted=${encodeURIComponent(tripId)}`);
  }

  async function deleteRecapPhotoAction(tripId: string, formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const photoId = String(formData.get("photoId") ?? "");
    const closeOut = shopPath(staff.user.shopSlug, "close-out");
    if (!photoId) redirect(closeOut);
    const db = await getDb();
    if (await hasSentTripRecap(db, staff.user.shopId, tripId)) redirect(closeOut);
    const result = await deleteRecapPhoto(db, staff.user.shopId, photoId);
    if (result.deleted) {
      await queueAndAttemptMediaDeletion(db, {
        shopId: staff.user.shopId,
        kind: "recap_photo",
        url: result.imageUrl,
      });
    }
    revalidateAndRedirect(
      closeOut,
      `${closeOut}?notice=recap-photo-removed&noted=${encodeURIComponent(tripId)}`,
    );
  }

  /** Store a staff image on the close-out and share it with every diver recap. */
  async function uploadCrewRecapPhotoAction(tripId: string, formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const closeOut = shopPath(staff.user.shopSlug, "close-out");
    const actionDb = await getDb();
    if (await hasSentTripRecap(actionDb, staff.user.shopId, tripId)) {
      revalidateAndRedirect(closeOut, noticeUrl(closeOut, "recap-locked", { noted: tripId }));
    }
    const file = formData.get("crewPhoto");
    if (!(file instanceof File) || file.size === 0) {
      revalidateAndRedirect(closeOut, noticeUrl(closeOut, "crew-photo-failed", { noted: tripId }));
    }
    const db = await getDb();
    const eligibility = await canAddCrewRecapPhoto(db, {
      shopId: staff.user.shopId,
      tripId,
      uploadedByPersonId: staff.user.personId,
    });
    if (!eligibility.ok) {
      const notice = eligibility.reason === "limit" ? "crew-photo-limit" : "invalid";
      revalidateAndRedirect(closeOut, noticeUrl(closeOut, notice, { noted: tripId }));
    }
    const stored = await storeRecapImage({
      filename: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer(),
    });
    if (stored.status !== "stored") {
      revalidateAndRedirect(
        closeOut,
        noticeUrl(
          closeOut,
          stored.status === "not_configured" ? "crew-photo-unconfigured" : "crew-photo-failed",
          {
            noted: tripId,
          },
        ),
      );
    }
    const result = await addCrewRecapPhoto(db, {
      shopId: staff.user.shopId,
      tripId,
      uploadedByPersonId: staff.user.personId,
      imageUrl: stored.url,
    });
    if (!result.ok) {
      await deleteStoredImage(stored.url);
      const notice = result.reason === "limit" ? "crew-photo-limit" : "crew-photo-failed";
      revalidateAndRedirect(closeOut, noticeUrl(closeOut, notice, { noted: tripId }));
    }
    revalidateAndRedirect(closeOut, noticeUrl(closeOut, "crew-photo-added", { noted: tripId }));
  }

  async function deleteCrewRecapPhotoAction(tripId: string, formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const photoId = String(formData.get("photoId") ?? "");
    const closeOut = shopPath(staff.user.shopSlug, "close-out");
    if (!photoId) redirect(closeOut);
    const db = await getDb();
    if (await hasSentTripRecap(db, staff.user.shopId, tripId)) redirect(closeOut);
    const result = await deleteCrewRecapPhoto(db, staff.user.shopId, photoId);
    if (result.deleted) {
      await queueAndAttemptMediaDeletion(db, {
        shopId: staff.user.shopId,
        kind: "recap_photo",
        url: result.imageUrl,
      });
    }
    revalidateAndRedirect(closeOut, noticeUrl(closeOut, "crew-photo-removed", { noted: tripId }));
  }

  /**
   * A deliberate send for one returned departure. `sendTripRecaps` carries the
   * same four-hour floor as the automatic scheduler, so a crafted POST cannot
   * turn the countdown into an early message.
   */
  async function sendRecapAction(tripId: string, _formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const closeOut = shopPath(staff.user.shopSlug, "close-out");
    const result = await sendTripRecaps(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
    });
    if (!result.ok) {
      revalidateAndRedirect(
        closeOut,
        noticeUrl(closeOut, result.reason === "not_eligible" ? "recap-not-ready" : "invalid"),
      );
    }
    revalidateAndRedirect(
      closeOut,
      noticeUrl(closeOut, result.summary.failed > 0 ? "recap-send-attention" : "recap-sent", {
        noted: tripId,
      }),
    );
  }

  /** Retry every ended departure represented by the failed close-out task. */
  async function retryFailedPostDiveReportsAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const closeOut = shopPath(staff.user.shopSlug, "close-out");
    const tripIds = [
      ...new Set(
        formData
          .getAll("tripId")
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    ];
    if (tripIds.length === 0) {
      revalidateAndRedirect(closeOut, noticeUrl(closeOut, "recap-send-attention"));
    }

    const db = await getDb();
    let failed = 0;
    let notReady = 0;
    for (const tripId of tripIds) {
      const result = await sendTripRecaps(db, { shopId: staff.user.shopId, tripId });
      if (!result.ok) {
        if (result.reason === "not_eligible") notReady++;
        continue;
      }
      failed += result.summary.failed;
    }

    revalidateAndRedirect(
      closeOut,
      noticeUrl(closeOut, failed > 0 || notReady > 0 ? "recap-send-attention" : "recap-sent"),
    );
  }

  const detailTime = (departure: CloseoutDeparture) =>
    formatTime(
      departure.status === "not_departed" ? departure.startsAt : departure.endsAt,
      locale,
      shop.timezone,
    );
  const latestHasOutstanding = latest
    ? latest.outstanding.departures.length > 0 ||
      latest.outstanding.leftovers.length > 0 ||
      latest.outstanding.adminTasks.length > 0
    : false;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["closed", "noted", "notice"]} />
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

      {/* Where the owner-only departure log lands everyone else. The link on
          each row is absent for them, so this is for a bookmark, a deep link,
          or a role that changed under them. */}
      {notice === "log-not-authorized" ? (
        <div className="mb-6">
          <ShopNotice tone="neutral" role="status">
            {t("incidentExport.ownerOnlyNotice")}
          </ShopNotice>
        </div>
      ) : null}

      {notice === "recap-photo-removed" ? (
        <div className="mb-6">
          <ShopNotice tone="success" role="status">
            {t("trips.notices.recapPhotoRemoved")}
          </ShopNotice>
        </div>
      ) : null}
      {notice === "crew-photo-added" ? (
        <div className="mb-6">
          <ShopNotice tone="success" role="status">
            {t("closeout.notice.crewPhotoAdded")}
          </ShopNotice>
        </div>
      ) : null}
      {notice === "crew-photo-removed" ? (
        <div className="mb-6">
          <ShopNotice tone="success" role="status">
            {t("closeout.notice.crewPhotoRemoved")}
          </ShopNotice>
        </div>
      ) : null}
      {notice === "crew-photo-limit" ? (
        <div className="mb-6">
          <ShopNotice tone="danger" role="alert">
            {t("closeout.notice.crewPhotoLimit")}
          </ShopNotice>
        </div>
      ) : null}
      {notice === "crew-photo-unconfigured" ? (
        <div className="mb-6">
          <ShopNotice tone="danger" role="alert">
            {t("closeout.notice.crewPhotoUnsupported")}
          </ShopNotice>
        </div>
      ) : null}
      {notice === "crew-photo-failed" ? (
        <div className="mb-6">
          <ShopNotice tone="danger" role="alert">
            {t("closeout.notice.crewPhotoFailed")}
          </ShopNotice>
        </div>
      ) : null}

      {notice === "recap-sent" ? (
        <div className="mb-6">
          <ShopNotice tone="success" role="status">
            {t("closeout.notice.recapSent")}
          </ShopNotice>
        </div>
      ) : null}

      {notice === "recap-send-attention" ? (
        <div className="mb-6">
          <ShopNotice tone="warning" role="status">
            {t("closeout.notice.recapAttention")}
          </ShopNotice>
        </div>
      ) : null}

      {notice === "recap-not-ready" ? (
        <div className="mb-6">
          <ShopNotice tone="neutral" role="status">
            {t("closeout.notice.recapNotReady")}
          </ShopNotice>
        </div>
      ) : null}

      {notice === "recap-locked" ? (
        <div className="mb-6">
          <ShopNotice tone="neutral" role="status">
            {t("closeout.notice.recapLocked")}
          </ShopNotice>
        </div>
      ) : null}

      {notice === "acknowledge-required" ? (
        <div className="mb-6">
          <ShopNotice tone="warning" role="alert">
            {t("closeout.notice.acknowledgeRequired")}
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
            latestHasOutstanding ? "border-border bg-surface" : "border-success/40 bg-success/5"
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
          {!latestHasOutstanding ? (
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
                {latest.outstanding.adminTasks.map((task) => (
                  <li key={`admin-${task.id}`}>
                    <span className="font-medium">{t("closeout.admin.postDiveReports.label")}</span>{" "}
                    <span className="text-muted">
                      — {t(CLOSEOUT_ADMIN_STATUS_KEYS[task.status])}
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
                // The departure row carries a live close-out status tone (the
                // danger border is meaningful), so it stays hand-typed rather
                // than losing that operational signal in neutral SectionCard
                // chrome.
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
                    {/* A boat still out is exactly the row you'd chase — it
                        gets the manifest door too, not only the rows with a
                        recorded gap (principle 10: no dead ends on the row
                        that matters most). */}
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {departure.gapReason || departure.status === "still_out" ? (
                        <Link
                          href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest?checkpoint=${checkpoint}`}
                          className={buttonClass({ variant: "secondary" })}
                        >
                          {openRollCallActionText(t)}
                        </Link>
                      ) : null}
                      {/* Writing the day up belongs to the evening, so the
                          departure log is generated from here rather than from
                          the manifest a crew works at the rail. On every row,
                          not only the boats that are back: the moment a shop
                          most needs a departure's recorded facts is while the
                          departure is still happening, and the document has
                          always reported what is on record *so far* rather
                          than claiming a day is finished. */}
                      {canGenerateLog ? (
                        <Link
                          href={`/shop/${shopSlug}/trips/${departure.tripId}/log`}
                          className={buttonClass({ variant: "secondary" })}
                        >
                          {t("incidentExport.openLink")}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  {/* The one thing this evening can still add to a departure
                      that is behind the shop. Only on an ended boat: a trip
                      still out has no day to write about yet, and one that
                      never left has no recap coming. */}
                  {departure.ended ? (
                    <RecapNoteEditor
                      action={saveRecapNoteAction.bind(null, departure.tripId)}
                      shoutout={departure.recapShoutout}
                      saved={noted === departure.tripId}
                      t={t}
                      photos={departure.photos}
                      deletePhotoAction={deleteRecapPhotoAction.bind(null, departure.tripId)}
                      crewPhotos={departure.crewPhotos}
                      crewPhotoInputId={`crew-recap-photo-${departure.tripId}`}
                      uploadCrewPhotoAction={uploadCrewRecapPhotoAction.bind(
                        null,
                        departure.tripId,
                      )}
                      deleteCrewPhotoAction={deleteCrewRecapPhotoAction.bind(
                        null,
                        departure.tripId,
                      )}
                      recapSendAction={sendRecapAction.bind(null, departure.tripId)}
                      recapEligibleAt={recapEligibleAt(departure.endsAt)}
                      recapNowMs={now.getTime()}
                      recapSentAt={departure.recapSentAt}
                      recapSentAtLabel={
                        departure.recapSentAt
                          ? formatTime(departure.recapSentAt, locale, shop.timezone)
                          : undefined
                      }
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {state.adminTasks.length > 0 ? (
        <section aria-labelledby="closeout-admin-heading" className="mb-10">
          <h2 id="closeout-admin-heading" className="text-lg font-semibold">
            {t("closeout.admin.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("closeout.admin.subtitle")}</p>
          <ul className="mt-4 flex flex-col gap-3">
            {state.adminTasks.map((task) => (
              <SectionCard as="li" key={task.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-semibold">{t("closeout.admin.postDiveReports.label")}</p>
                      <Badge tone={ADMIN_STATUS_BADGE_TONES[task.status]}>
                        {t(CLOSEOUT_ADMIN_STATUS_KEYS[task.status])}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-muted">
                      {t("closeout.admin.postDiveReports.description")}
                    </p>
                    <p className="mt-2 text-sm font-medium">
                      {t("closeout.admin.postDiveReports.progress", {
                        completed: task.completed,
                        total: task.total,
                      })}
                    </p>
                    {task.pending > 0 ? (
                      <p className="mt-1 text-sm text-muted">
                        {t("closeout.admin.postDiveReports.pending", { count: task.pending })}
                      </p>
                    ) : null}
                    {task.failed > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <p className="text-danger">
                          {t("closeout.admin.postDiveReports.failed", { count: task.failed })}
                        </p>
                        <form
                          action={retryFailedPostDiveReportsAction}
                          className="flex flex-wrap items-center gap-2"
                        >
                          {state.departures
                            .filter((departure) => departure.ended)
                            .map((departure) => (
                              <input
                                key={departure.tripId}
                                type="hidden"
                                name="tripId"
                                value={departure.tripId}
                              />
                            ))}
                          <SubmitButton
                            pendingLabel={t("closeout.admin.postDiveReports.retrying")}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            {t("closeout.admin.postDiveReports.retry")}
                          </SubmitButton>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </div>
              </SectionCard>
            ))}
          </ul>
        </section>
      ) : null}

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
                <SectionCard as="li" key={action.id} className="list-none">
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
                </SectionCard>
              ))}
            </ul>
          )}
        </section>

        <SectionCard
          className="mb-10"
          padding="lg"
          title={t("closeout.close.heading")}
          description={t("closeout.close.note")}
        >
          {state.mustAcknowledge.length > 0 ? (
            <label className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm">
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
        </SectionCard>
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
          <SectionCard as="div" className="mt-4">
            <p className="font-semibold">
              {t("closeout.tomorrow.count", { count: state.tomorrow.total })}
            </p>
            {/* The tally rides *inside* each chip. Set beside one it was bound
                to its label by a 2px gap difference, and a row of them wrapping
                at 390px read as loose digits. The gap between chips must
                stay visibly wider than the gap around the interpunct inside
                one, or proximity regroups "PREP · 2  FILL SEATS" into
                "2 FILL SEATS" on a narrow screen. */}
            <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {state.tomorrow.byKind.map((entry) => (
                <li key={entry.kind}>
                  <KindChip kind={entry.kind} count={entry.count} t={t} />
                </li>
              ))}
            </ul>
            {/* No "Open Today" button. This card is a heads-up about the
                morning, not a hand-off — and Today is a permanent tab in the
                header and a permanent slot in the phone dock, one tap from
                here and from everywhere else. A button that only repeats
                standing chrome adds a control without adding a destination. */}
          </SectionCard>
        )}
      </section>
    </main>
  );
}
