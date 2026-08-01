import type { Metadata } from "next";
import { connection } from "next/server";
import { RentalFitForm } from "@/app/shop/[shopSlug]/schedule/[id]/_components/RentalFitForm";
import { DiveSitesPeek } from "@/components/DiveSitesPeek";
import { EarnedMoment } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import {
  resolveRevokedBookingCapability,
  verifyBookingCapability,
} from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getBookingPayment } from "@/db/payments";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { checklistCategoryText, checklistDetailText } from "@/i18n/readiness-summary-labels";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { telHref } from "@/lib/course-inquiry";
import { formatRelativeDay, formatShortDate, formatTime, formatTimeRangeTz } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import {
  buildDiverChecklist,
  type ChecklistState,
  type DiverChecklistItem,
  nextDiverStep,
} from "@/lib/readiness-summary";
import {
  cancelMyBookingAction,
  payFromReady,
  rescheduleMyBookingAction,
  saveEmergencyContactFromReady,
  saveFitFromReady,
  signWaiverFromReady,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("ready.metaTitle"),
    robots: { index: false, follow: false },
  };
}

const STATE_STYLE: Record<
  ChecklistState,
  { glyph: string; word: DiverMessageKey; box: string; text: string }
> = {
  done: {
    glyph: "✓",
    word: "ready.stateDone",
    box: "bg-success/10 text-success",
    text: "text-success",
  },
  action: {
    glyph: "→",
    word: "ready.stateAction",
    box: "bg-primary/10 text-primary",
    text: "text-primary",
  },
  waiting: {
    glyph: "•",
    word: "ready.stateWaiting",
    box: "bg-surface-sunken text-muted",
    text: "text-muted",
  },
};

function ChecklistRow({
  label,
  state,
  detail,
  action,
  t,
}: {
  label: string;
  state: ChecklistState;
  /** Already resolved by the caller — see `checklistDetailText`. */
  detail: string;
  action?: React.ReactNode;
  t: DiverTranslator;
}) {
  const style = STATE_STYLE[state];
  return (
    <li className="flex items-start gap-4 px-4 py-4 sm:px-5">
      <span
        aria-hidden="true"
        className={`grid size-10 shrink-0 place-items-center rounded-xl text-lg font-bold ${style.box}`}
      >
        {style.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 className="text-base font-semibold">{label}</h3>
          <span className={`text-sm font-semibold ${style.text}`}>{t(style.word)}</span>
        </div>
        <p className="mt-0.5 text-base text-muted">{detail}</p>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </li>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted">{text}</p>
      </section>
    </main>
  );
}

/** The action a checklist item enables on this page, if any. */
function itemAction(
  item: DiverChecklistItem,
  token: string,
  canPay: boolean,
  t: DiverTranslator,
): React.ReactNode {
  if (item.code === "waiver_pending") {
    return (
      <form action={signWaiverFromReady.bind(null, token)}>
        <SubmitButton pendingLabel={t("ready.opening")} className={buttonClass({ size: "sm" })}>
          {t("ready.signWaiver")}
        </SubmitButton>
      </form>
    );
  }
  if ((item.code === "payment_due" || item.code === "payment_refunded") && canPay) {
    return (
      <form action={payFromReady.bind(null, token)}>
        <SubmitButton
          pendingLabel={t("ready.openingPayment")}
          className={buttonClass({ size: "sm" })}
        >
          {t("ready.payForTrip")}
        </SubmitButton>
      </form>
    );
  }
  return null;
}

/**
 * Notice keys, not sentences: the query string carries a key, and the page
 * looks it up in the diver's own language. Storing the prose here would have
 * pinned every one of these to English no matter what the reader asked for
 * (docs ADR 20260729-diver-copy-localization).
 */
const READY_NOTICES: Record<
  string,
  { tone: "success" | "danger" | "neutral"; key: DiverMessageKey }
> = {
  "saved-contact": { tone: "success", key: "ready.contactSaved" },
  "saved-contact-empty": { tone: "neutral", key: "ready.contactIncomplete" },
  "pay-paid": { tone: "success", key: "ready.paymentReceived" },
  "error-waiver": { tone: "danger", key: "ready.waiverUnavailable" },
  "error-contact": { tone: "danger", key: "ready.contactTooLong" },
  "error-pay": { tone: "danger", key: "ready.paymentUnavailable" },
  "pay-cancelled": { tone: "neutral", key: "ready.paymentCancelled" },
  "error-cancel": { tone: "danger", key: "ready.cancelUnavailable" },
  "saved-rescheduled": { tone: "success", key: "ready.movedHeading" },
  "error-reschedule": { tone: "danger", key: "ready.moveFailed" },
  // Task 49: every throttled action used to redirect with no error param at
  // all, so a rate-limited tap just looked like the button did nothing.
  "error-rate": { tone: "danger", key: "ready.rateLimited" },
  // Task 49: a failed gear/setup save (`saveFitFromReady`'s `?error=fit`)
  // had no entry here either — the same silent-failure gap, one field over.
  "error-fit": { tone: "danger", key: "ready.fitUnavailable" },
};

/**
 * What to tell the diver about their own refund, right after they cancel —
 * derived from the booking's own current payment status, not from anything
 * the client sent back. `?cancelled=1` on the URL is only a trigger to look;
 * it carries no claim of its own, so an edited or replayed query string
 * can't be used to assert a refund that didn't happen, or hide one that did
 * (Codex finding). This collapses several distinct non-refund outcomes
 * (past the free-cancellation window, no stated window, a failed/manual
 * Stripe reversal) into one honest "still paid, shop handles it" message,
 * since none of those specific reasons survive as durable state to verify
 * against — only whether the payment row currently reads `refunded` or
 * still `paid`/`deposit_paid` does.
 */
function verifiedCancelNotice(paymentStatus: string | null | undefined): DiverMessageKey | null {
  if (paymentStatus === "refunded") return "ready.refundIssued";
  if (paymentStatus === "paid" || paymentStatus === "deposit_paid") return "ready.refundManual";
  return null;
}

/** What cancelling right now would mean for money already paid — shown before the diver commits. */
const CANCEL_PREVIEW_KEY: Record<ReadyPageData["cancelPreview"], DiverMessageKey | null> = {
  refund: "ready.cancelPreviewRefund",
  forfeit: "ready.cancelPreviewForfeit",
  // Genuinely paid — this trip just has no stated cancellation window, so
  // nothing is refunded automatically. Disclosing this only after the
  // irreversible cancel action (Codex finding) would leave a paid diver
  // finding out too late that the shop, not an automatic reversal, decides
  // their refund.
  no_policy: "ready.cancelPreviewNoPolicy",
  unpaid: null,
};

/** The "This booking was cancelled" notice, with refund copy derived from the booking's current payment status. */
function cancelledNotice(
  paymentStatus: string | null | undefined,
  tripTitle: string,
  shopName: string,
  t: DiverTranslator,
) {
  const refundKey = verifiedCancelNotice(paymentStatus);
  return (
    <Notice
      title={t("ready.cancelledHeading")}
      text={
        refundKey
          ? t(refundKey)
          : t("ready.cancelledSeatReleased", { trip: tripTitle, shop: shopName })
      }
    />
  );
}

export default async function DiverReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string; pay?: string; cancelled?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, pay, cancelled } = await searchParams;
  const db = await getDb();
  // A dead link resolves no shop, so there is no `shops.default_locale` to fall
  // back to — negotiate from the visitor's own device alone for those branches,
  // then re-negotiate below once the shop is known.
  const anonT = diverTranslator(await requestLocale());
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) {
    // A diver's own cancel action revokes this exact token as part of
    // cancelling, then redirects back to it with `?cancelled=1` — so the
    // normal verified-capability path above can never show the refund
    // notice for a self-cancel. Resolve the token with the revocation check
    // relaxed (never the cancelled-booking or shop-scoping checks) so that
    // one redirect still lands on an honest confirmation instead of the
    // generic "isn't available" notice. `cancelled` is only the trigger to
    // look — the refund copy itself comes from the booking's own current
    // payment row, fetched fresh here, never from the query string.
    if (cancelled) {
      const resolved = await resolveRevokedBookingCapability(db, { token, purpose: "readiness" });
      if (resolved) {
        const data = await getReadyPageData(db, resolved.bookingId);
        if (data?.detail.cancelled) {
          const payment = await getBookingPayment(db, data.shop.id, resolved.bookingId);
          return cancelledNotice(
            payment?.status,
            data.detail.trip.title,
            data.detail.shop.name,
            anonT,
          );
        }
      }
    }
    return (
      <Notice title={anonT("ready.unavailableHeading")} text={anonT("ready.unavailableBody")} />
    );
  }
  const { bookingId } = capability;

  const data = await getReadyPageData(db, bookingId);
  if (!data) {
    return (
      <Notice title={anonT("ready.unavailableHeading")} text={anonT("waiver.unavailableBody")} />
    );
  }

  const { detail, shop, person } = data;
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  const firstName = detail.person.fullName.split(" ")[0] || t("ready.namelessFallback");
  const when = formatShortDate(detail.trip.startsAt, shop.defaultLocale, detail.shop.timezone);
  const timeRange = formatTimeRangeTz(
    detail.trip.startsAt,
    detail.trip.endsAt,
    shop.defaultLocale,
    detail.shop.timezone,
  );
  // Task 46: the day-before email already tells a diver when to be at the
  // dock (`dockCallPhrase` in src/lib/notifications/email.ts) — this page
  // never did, so a diver re-checking it after reading the email couldn't
  // find the one number that actually matters that morning.
  const dockCallAt = new Date(detail.trip.startsAt.getTime() - shop.dockCallMinutes * 60_000);
  const dockCallLine = t("ready.dockCallLine", {
    time: formatTime(dockCallAt, shop.defaultLocale, detail.shop.timezone),
    dock: t("notifications.common.dockCallMinutes", { minutes: shop.dockCallMinutes }),
  });
  // Task 47: "in 2 days" / "tomorrow" / "today" — the page a diver opens the
  // night before should read at least as rich as the email that sent them
  // here, and a bare date is easy to misjudge at a glance the way a full
  // relative phrase isn't.
  const relativeWhen = formatRelativeDay(
    detail.trip.startsAt,
    nowDate(),
    shop.defaultLocale,
    detail.shop.timezone,
  );

  if (detail.cancelled) {
    // Reached when the capability check above succeeded but the booking was
    // cancelled in the gap before this fresh read (a tight race, not the
    // normal self-cancel redirect — that one is revoked and handled by the
    // branch above). `cancelled` here is still just the raw, untrusted query
    // string; deriving the notice from it directly would reopen exactly the
    // spoofable-notice gap already closed above (Codex finding) — a crafted
    // `?cancelled=refunded` could claim a refund that hasn't happened. Same
    // fix: read the booking's own current payment status fresh.
    const payment = await getBookingPayment(db, data.shop.id, bookingId);
    return cancelledNotice(payment?.status, detail.trip.title, detail.shop.name, t);
  }

  const cancelPreviewKey = CANCEL_PREVIEW_KEY[data.cancelPreview];
  const items = buildDiverChecklist(detail.requirement, detail.readiness);
  const nextStep = nextDiverStep(items);
  const ready = detail.readiness.status === "ready";
  const hasEmergencyContact = Boolean(person.emergencyContactName && person.emergencyContactPhone);
  const noticeKey = saved ? `saved-${saved}` : error ? `error-${error}` : pay ? `pay-${pay}` : null;
  const notice = noticeKey ? READY_NOTICES[noticeKey] : undefined;

  return (
    // The whole page under the provider, not just the one Client Component that
    // needs it today: a `useTranslations` call in a client child without it
    // throws during the server render and takes the entire page down to a blank
    // 200 (which is exactly how RentalFitForm broke this surface once). Its
    // namespaces are "rental" (RentalFitForm's own copy) and "common"
    // ("common.optional", shared with several field hints).
    <DiverIntlProvider
      locale={locale}
      timeZone={detail.shop.timezone}
      namespaces={["rental", "common"]}
    >
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
        <FlashParams params={["saved", "error", "pay"]} />
        <header>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">
            {t("capability.readinessTitle")}
          </p>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">
            {detail.shop.name}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
            {detail.trip.title}
          </h1>
          <p className="mt-1 text-base text-muted">
            {when} · {timeRange} · {relativeWhen}
          </p>
          <p className="mt-1 text-sm text-muted">{dockCallLine}</p>
        </header>

        {notice ? (
          <div className="mt-6">
            <ShopNotice tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>
              {t(notice.key)}
            </ShopNotice>
          </div>
        ) : null}

        {ready ? (
          <EarnedMoment
            className="mt-8"
            eyebrow={t("ready.allSetHeading")}
            title={t("ready.seeYou", { when, name: firstName })}
          >
            <p>{t("ready.allSetBodyReady")}</p>
          </EarnedMoment>
        ) : (
          <section className="mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <h2 className="text-xl font-semibold text-balance">
              {t("ready.almostThere", { name: firstName })}
            </h2>
            <p className="mt-2 text-base text-muted">
              {nextStep
                ? t("ready.nextDetail", { detail: checklistDetailText(t, nextStep) })
                : t("ready.allSetBody")}
            </p>
          </section>
        )}

        <DiveSitesPeek
          sites={data.sites}
          heading={t("ready.scheduledSites")}
          subheading={t("ready.sitesPeek")}
        />

        <section className="mt-6" aria-labelledby="checklist-heading">
          <h2
            id="checklist-heading"
            className="text-sm font-bold tracking-[0.16em] text-muted uppercase"
          >
            {t("ready.checklistHeading")}
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface">
            {items.map((item) => (
              <ChecklistRow
                key={item.category}
                label={checklistCategoryText(t, item.category)}
                state={item.state}
                detail={checklistDetailText(t, item)}
                action={itemAction(item, token, data.canPay, t)}
                t={t}
              />
            ))}
            <ChecklistRow
              label={t("ready.emergencyContact")}
              state={hasEmergencyContact ? "done" : "action"}
              detail={
                hasEmergencyContact
                  ? t("ready.emergencyOnFile", { name: person.emergencyContactName ?? "" })
                  : t("ready.emergencyContactBody")
              }
              // Already on file (most often captured on the waiver a moment
              // earlier — both write through the same `saveBookingEmergencyContact`)
              // reads as a plain "done" row, no form: two differently-labeled
              // capture forms for the same fact was the duplication this closes
              // (UX persona Lens 17, task 143). Correcting a wrong entry is staff
              // work from here on — the roster and diver-record edit form
              // (task 144) — not a second diver-facing input.
              action={
                hasEmergencyContact ? null : (
                  <form
                    action={saveEmergencyContactFromReady.bind(null, token)}
                    className="flex flex-col gap-3"
                  >
                    <FieldGrid columns={2}>
                      <Field label={t("ready.contactName")}>
                        <input
                          name="emergencyContactName"
                          autoComplete="name"
                          maxLength={120}
                          defaultValue={person.emergencyContactName ?? ""}
                          className={controlClass}
                        />
                      </Field>
                      <Field label={t("ready.contactPhone")}>
                        <input
                          name="emergencyContactPhone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={40}
                          defaultValue={person.emergencyContactPhone ?? ""}
                          className={controlClass}
                        />
                      </Field>
                    </FieldGrid>
                    <div>
                      <SubmitButton
                        pendingLabel={t("common.saving")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {t("ready.saveContact")}
                      </SubmitButton>
                    </div>
                  </form>
                )
              }
              t={t}
            />
          </ul>
        </section>

        <section className="mt-6" aria-labelledby="setup-heading">
          <h2
            id="setup-heading"
            className="text-sm font-bold tracking-[0.16em] text-muted uppercase"
          >
            {t("ready.gearAndSetup")}
          </h2>
          <RentalFitForm
            action={saveFitFromReady.bind(null, token)}
            rentalFit={data.rentalFit}
            rentalItems={data.shop.rentalItems}
            pricing={data.shop.rentalPricing}
            currency={toShopCurrency(data.shop.currency)}
            wantsNitrox={data.wantsNitrox}
            nitroxCardVerified={data.nitroxCardVerified}
            plannedDives={data.trip.plannedDives}
            saved={saved === "fit"}
          />
        </section>

        {data.canManageBooking ? (
          <section
            className="mt-6 rounded-2xl border border-border bg-surface p-5 sm:p-6"
            aria-labelledby="change-plans-heading"
          >
            <h2
              id="change-plans-heading"
              className="text-sm font-bold tracking-[0.16em] text-muted uppercase"
            >
              {t("ready.changePlans")}
            </h2>

            {data.rescheduleCandidates && data.rescheduleCandidates.length > 0 ? (
              <div className="mt-3">
                <p className="text-base text-muted">{t("ready.reschedulePitch")}</p>
                <form
                  action={rescheduleMyBookingAction.bind(null, token)}
                  className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                  <label htmlFor="newTripId" className="sr-only">
                    {t("ready.pickATrip")}
                  </label>
                  <select id="newTripId" name="newTripId" required className={controlClass}>
                    <option value="">{t("ready.chooseTrip")}</option>
                    {data.rescheduleCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title} —{" "}
                        {formatShortDate(candidate.startsAt, locale, detail.shop.timezone)} ·{" "}
                        {formatTimeRangeTz(
                          candidate.startsAt,
                          candidate.endsAt,
                          locale,
                          detail.shop.timezone,
                        )}{" "}
                        · {t("ready.spotsLeft", { count: candidate.spotsLeft })}
                      </option>
                    ))}
                  </select>
                  <InlineConfirm
                    triggerLabel={t("ready.moveBooking")}
                    triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
                    message={t("ready.moveConfirm")}
                    confirmLabel={t("ready.moveConfirmButton")}
                    cancelLabel={t("ready.neverMind")}
                    pendingLabel={t("ready.moving")}
                  />
                </form>
              </div>
            ) : null}

            <div
              className={
                data.rescheduleCandidates?.length ? "mt-6 border-t border-border pt-5" : "mt-3"
              }
            >
              <p className="text-base text-muted">
                {t("ready.cancelLead")} {cancelPreviewKey ? t(cancelPreviewKey) : null}
              </p>
              <form action={cancelMyBookingAction.bind(null, token)} className="mt-3">
                {/* Task 50: replaces window.confirm, which could only show a
                    fixed string — never the refund preview this page already
                    computed above. Repeating it right at the point of
                    commitment (task 41's "reassurance at the point of
                    anxiety" pattern, applied to a warning instead) means the
                    diver reads it once more, right before the irreversible
                    submit, not just once further up the page. */}
                <InlineConfirm
                  triggerLabel={t("ready.cancelSpot")}
                  triggerClassName={buttonClass({ variant: "danger", size: "sm" })}
                  message={[
                    t("ready.cancelConfirm", { trip: detail.trip.title }),
                    cancelPreviewKey ? t(cancelPreviewKey) : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  confirmLabel={t("ready.cancelConfirmButton")}
                  cancelLabel={t("ready.neverMind")}
                  pendingLabel={t("ready.cancelling")}
                  confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
                />
              </form>
            </div>
          </section>
        ) : null}

        <p className="mt-8 text-center text-sm text-muted">
          {(() => {
            const linkClass = "font-medium text-primary hover:underline";
            const phoneTag = (chunks: React.ReactNode) => (
              <a href={telHref(shop.contactPhone ?? "")} className={linkClass}>
                {chunks}
              </a>
            );
            const emailTag = (chunks: React.ReactNode) => (
              <a href={`mailto:${shop.contactEmail}`} className={linkClass}>
                {chunks}
              </a>
            );
            if (shop.contactPhone && shop.contactEmail) {
              return t.rich("ready.contactLineBoth", {
                shop: detail.shop.name,
                phoneNumber: shop.contactPhone,
                emailAddress: shop.contactEmail,
                phone: phoneTag,
                email: emailTag,
              });
            }
            if (shop.contactPhone) {
              return t.rich("ready.contactLinePhoneOnly", {
                shop: detail.shop.name,
                phoneNumber: shop.contactPhone,
                phone: phoneTag,
              });
            }
            if (shop.contactEmail) {
              return t.rich("ready.contactLineEmailOnly", {
                shop: detail.shop.name,
                emailAddress: shop.contactEmail,
                email: emailTag,
              });
            }
            return t("ready.contactLineNone", { shop: detail.shop.name });
          })()}
        </p>
      </main>
    </DiverIntlProvider>
  );
}
