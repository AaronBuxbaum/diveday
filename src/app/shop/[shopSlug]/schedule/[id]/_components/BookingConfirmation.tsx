import Link from "next/link";
import { EarnedMoment } from "@/components/EarnedMoment";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { checklistCategoryText, checklistDetailText } from "@/i18n/readiness-summary-labels";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { buildDiverChecklist, nextDiverStep } from "@/lib/readiness-summary";
import { payForBooking, type RentalFitRef, saveRentalFitRequest } from "../actions";
import { RememberBooker } from "./RememberBooker";
import { RentalFitForm } from "./RentalFitForm";
import type {
  Confirmed,
  PaymentPanel,
  Readiness,
  RentalFit,
  Requirement,
  Shop,
  Trip,
} from "./types";

/**
 * Money on the confirmation panel. The shop's locale decides grouping and
 * symbol placement (docs ADR 20260729-diver-copy-localization); the currency
 * stays USD until multi-currency is a real requirement.
 */
function moneyFormatter(locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
}

function PaymentSection({
  payment,
  payCancelled,
  payRef,
  locale,
}: {
  payment: PaymentPanel;
  payCancelled: boolean;
  payRef: RentalFitRef;
  locale: string;
}) {
  if (!payment) return null;
  const usd = moneyFormatter(locale);
  const t = diverTranslator(locale);

  if (payment.state === "paid") {
    const depositWithBalance = payment.isDeposit && payment.balanceDueCents > 0;
    return (
      <div className="mt-4 rounded-lg border border-success/40 bg-success/10 p-4 text-left">
        <h3 className="font-semibold text-success">
          {depositWithBalance ? t("booking.paymentDepositReceived") : t("booking.paymentReceived")}
          {payment.amountCents !== null ? ` — ${usd.format(payment.amountCents / 100)}` : ""} ✓
        </h3>
        <p className="mt-1 text-sm text-muted">
          {depositWithBalance
            ? t("booking.paymentDepositBalance", {
                balance: usd.format(payment.balanceDueCents / 100),
              })
            : t("booking.paymentSquare")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface/70 p-4 text-left">
      <h3 className="font-semibold">
        {payCancelled ? t("booking.paymentStillOpen") : t("booking.paymentOneThingLeft")}
      </h3>
      <p className="mt-1 text-sm text-muted">{t("booking.paymentBody")}</p>
      {payment.state === "pending" ? (
        <a
          href={payment.checkoutUrl}
          className={buttonClass({ className: "mt-3 px-5 py-2.5 text-base" })}
        >
          {t("booking.finishPaying")}
        </a>
      ) : (
        <form action={payForBooking.bind(null, payRef)} className="mt-3">
          <SubmitButton
            pendingLabel={t("booking.openingPayment")}
            className={buttonClass({ className: "px-5 py-2.5 text-base disabled:opacity-70" })}
          >
            {t("booking.payNow")}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

export function BookingConfirmation({
  shop,
  shopSlug,
  locale,
  trip,
  confirmed,
  readiness,
  requirement,
  fitRef,
  rentalFit,
  nitroxCardVerified,
  fitSaved,
  payment,
  payCancelled,
  readinessLink,
  progression,
}: {
  shop: Shop;
  shopSlug: string;
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  trip: Trip;
  confirmed: Confirmed;
  readiness: Readiness | null;
  requirement: Requirement | null;
  fitRef: RentalFitRef;
  rentalFit: RentalFit;
  nitroxCardVerified: boolean;
  fitSaved: boolean;
  payment: PaymentPanel;
  payCancelled: boolean;
  /** Null when no readiness capability could be issued (e.g. no canonical origin configured). */
  readinessLink: string | null;
  /**
   * The next rung of one of the shop's own certification paths, or null when
   * the shop has not built a path that reaches this diver. Never a guess — see
   * `nextPathStep` in src/db/course-paths.ts.
   */
  progression: {
    path: { title: string };
    step: { note: string | null; course: { title: string; slug: string } };
  } | null;
}) {
  const t = diverTranslator(locale);
  const checklist = readiness ? buildDiverChecklist(requirement, readiness) : [];
  const nextStep = nextDiverStep(checklist);

  return (
    <>
      {/* Client-only, per-device convenience (task 27) — never in the embed
          widget, whose whole point is to leave no trace on a shop's own
          site (docs ADR 20260726-schedule-embed). */}
      {!fitRef.embed && confirmed.person.email ? (
        <RememberBooker fullName={confirmed.person.fullName} email={confirmed.person.email} />
      ) : null}
      {/* Same shared component /ready and /recap use for their earned moment
          — this page hand-rolled its own accent box before, which is how its
          radius (rounded-lg) and missing eyebrow drifted from theirs
          (design/principles.md #3). */}
      <EarnedMoment
        className="mt-10"
        title={t("booking.confirmedHeading", {
          name: confirmed.person.fullName.split(" ")[0],
        })}
      >
        <p>
          {t("booking.confirmedDockCall", {
            date: formatShortDate(trip.startsAt, locale, shop.timezone),
            time: formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone),
            minutes: shop.dockCallMinutes,
          })}
        </p>
      </EarnedMoment>

      <PaymentSection
        payment={payment}
        payCancelled={payCancelled}
        payRef={fitRef}
        locale={locale}
      />

      {progression ? (
        <aside className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase">
            {progression.path.title}
          </p>
          <h3 className="mt-1 font-semibold">{t("booking.goDeeperHeading")}</h3>
          <p className="mt-1 text-sm text-muted">
            {t("booking.goDeeperBody", { course: progression.step.course.title })}
          </p>
          {progression.step.note ? (
            <p className="mt-1 text-sm text-muted italic">{progression.step.note}</p>
          ) : null}
          <Link
            href={`/shop/${shopSlug}/courses/${progression.step.course.slug}`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
          >
            {t("booking.goDeeperCta")}
          </Link>
        </aside>
      ) : null}

      <div className="mt-4 rounded-lg border border-border bg-surface/70 p-4 text-left">
        {nextStep ? (
          <>
            <h3 className="font-semibold">
              {t("booking.nextStep", {
                step: checklistCategoryText(t, nextStep.category).toLowerCase(),
              })}
            </h3>
            <p className="mt-1 text-sm text-muted">{checklistDetailText(t, nextStep)}</p>
          </>
        ) : readiness?.status === "ready" ? (
          <h3 className="font-semibold text-success">{t("booking.allSet")}</h3>
        ) : (
          <>
            <h3 className="font-semibold">{t("booking.shopTakesOver")}</h3>
            <p className="mt-1 text-sm text-muted">{t("booking.shopTakesOverBody")}</p>
          </>
        )}
        <Link
          href={readinessLink ?? "#"}
          aria-disabled={readinessLink === null}
          // /ready/[token] isn't in the embed framing allowlist (docs ADR
          // 20260726-schedule-embed) — inside the iframe this must break out
          // to the top-level window, or the click would swap the working
          // embed for a frame Content-Security-Policy silently blocks.
          target={fitRef.embed ? "_top" : undefined}
          className="mt-3 inline-block text-sm font-semibold text-primary hover:underline aria-disabled:pointer-events-none aria-disabled:opacity-60"
        >
          {t("booking.trackReadiness")}
        </Link>
      </div>

      <RentalFitForm
        action={saveRentalFitRequest.bind(null, fitRef)}
        rentalFit={rentalFit}
        rentalItems={shop.rentalItems}
        pricing={shop.rentalPricing}
        wantsNitrox={confirmed.booking.wantsNitrox}
        nitroxCardVerified={nitroxCardVerified}
        plannedDives={trip.plannedDives}
        saved={fitSaved}
      />
      <Link
        href={`/shop/${shopSlug}/schedule${fitRef.embed ? "?embed=1" : ""}`}
        className="mt-3 inline-flex min-h-11 items-center text-base font-medium text-primary hover:underline"
      >
        {t("common.backToSchedule")}
      </Link>
    </>
  );
}
