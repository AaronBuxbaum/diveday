import { StatusMark } from "@/components/ui/StatusMark";
import { segmentClass, segmentedTrackClass } from "@/components/ui/segmented";
import { FIGURE_INLINE_CLASS, SUB_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { AppBar, MOCK_BODY, MOCK_PRIMARY_BUTTON } from "./MarketingScreenFallbacks";
import { WalkField, WalkSelect, WalkTyped } from "./WalkTyped";

/**
 * The three screens of Priya's own side of the booking that no feature page draws: picking her
 * seat, paying for it, and telling the shop who she is. Each has the screen a moment before the
 * tap (`data-tap-target` on the control, her typing in `WalkTyped`) and the screen after it, so
 * the homepage walkthrough can type, press and swap. Every control is `disabled`: the
 * homepage's steps open no door into the demo.
 */

/**
 * **Picking a seat** — `BookSpotSection` on the public trip page
 * (`src/app/s/[shopSlug]/trips/[id]/_components/BookingSections.tsx`): the heading and the seats
 * left, the number of divers, and the money block over "Book and pay". Priya's is one diver on
 * the Two-Tank Reef. Left out: gear, nitrox, the contact fields, the promo code and a signed-in
 * diver's trip credit.
 *
 * @mirrors src/app/s/[shopSlug]/trips/[id]/_components/BookingSections.tsx
 * @mirrors src/app/s/[shopSlug]/trips/[id]/_components/BookingSubmit.tsx
 */
export function SeatPickFallback({
  locale,
  tapPay = false,
}: {
  locale: DiverLocale;
  /** The homepage walkthrough taps "Book and pay" (`data-tap-target`); no other caller does. */
  tapPay?: boolean;
}) {
  const t = diverTranslator(locale);
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.tripName")} />
      <div className={MOCK_BODY}>
        <div className="rounded-inset border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold">{t("fallback.bookingCard.heading")}</h3>
            <p className="text-xs font-medium text-primary tabular-nums">
              {t("fallback.spotsLeft", { count: 3 })}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted">{t("fallback.tomorrowTime")}</p>
          <p className="mt-4 text-xs font-semibold text-muted">
            {t("fallback.bookingCard.divers")}
          </p>
          <div className={`mt-2 w-fit max-w-full ${segmentedTrackClass}`}>
            {[1, 2, 3].map((count) => (
              <span
                key={count}
                className={`inline-flex min-h-9 min-w-9 flex-1 items-center justify-center px-2 text-sm tabular-nums ${segmentClass(
                  { selected: count === 1 },
                )}`}
              >
                {count}
              </span>
            ))}
          </div>
          <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted tabular-nums">{t("fallback.seatPick.fare")}</dt>
              <dd className="tabular-nums">{t("fallback.seatPick.total")}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
              <dt className="font-medium">{t("fallback.bookingCard.dueNow")}</dt>
              <dd className={FIGURE_INLINE_CLASS}>{t("fallback.seatPick.total")}</dd>
            </div>
          </dl>
          <button
            type="button"
            disabled
            data-tap-target={tapPay ? "" : undefined}
            className={`mt-3 w-full ${MOCK_PRIMARY_BUTTON}`}
          >
            {t("fallback.bookingCard.bookAndPay")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * **Paying by card** — the checkout a diver lands on from Book and pay: the order, the card's
 * three boxes, and the one button. `state="blank"` is the page the moment it loads, `state="entering"`
 * is Priya typing her card in, then the tap on Pay; `state="paid"` is the page a moment later, with the order paid and her trip link
 * on its way. The card number is the processor's own test number, no real card.
 */
export function CheckoutFallback({
  locale,
  state = "entering",
}: {
  locale: DiverLocale;
  state?: "blank" | "entering" | "paid";
}) {
  const t = diverTranslator(locale);
  const paid = state === "paid";
  const blank = state === "blank";
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.checkout.label")} />
      <div className={MOCK_BODY}>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h3 className={SUB_TITLE_CLASS}>{t("fallback.tripName")}</h3>
            <p className="mt-1 text-xs text-muted">{t("fallback.checkout.meta")}</p>
          </div>
          <p className={FIGURE_INLINE_CLASS}>{t("fallback.seatPick.total")}</p>
        </div>
        <div className="mt-4 rounded-inset border border-border bg-surface p-4">
          {paid ? (
            <div data-walk-pop="" className="flex items-start gap-3">
              <StatusMark variant="success" size="md" />
              <div>
                <p className="text-sm font-semibold text-success-strong">
                  {t("fallback.checkout.paidTitle")}
                </p>
                <p className="mt-1 text-xs text-muted">{t("fallback.checkout.paidBody")}</p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold">{t("fallback.checkout.cardHeading")}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <WalkField label={t("fallback.checkout.cardNumber")} className="col-span-2">
                  {/* i18n-exempt: the processor's test card, used only in marketing mockups */}
                  {blank ? null : <WalkTyped text="4242 4242 4242 4242" delay={300} />}
                </WalkField>
                <WalkField label={t("fallback.checkout.expiry")}>
                  {blank ? null : <WalkTyped text="08 / 29" delay={1300} />}
                </WalkField>
                <WalkField label={t("fallback.checkout.cvc")}>
                  {blank ? null : <WalkTyped text="123" delay={1700} />}
                </WalkField>
              </div>
              <button
                type="button"
                disabled
                data-tap-target={blank ? undefined : ""}
                className={`mt-4 w-full ${MOCK_PRIMARY_BUTTON}`}
              >
                {t("fallback.checkout.pay")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * **Registering with the shop** — the public register page
 * (`src/app/s/[shopSlug]/register/RegisterForm.tsx`): her name and email, the certification she
 * says she holds with its card number (the number the crew checks later), and Send it to the
 * shop. `state="filling"` is Priya typing; `state="done"` is the page after she sends it. Left
 * out: the card photo and the not-certified note.
 *
 * @mirrors src/app/s/[shopSlug]/register/RegisterForm.tsx
 */
export function RegisterFallback({
  locale,
  state = "filling",
}: {
  locale: DiverLocale;
  state?: "filling" | "done";
}) {
  const t = diverTranslator(locale);
  const done = state === "done";
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.register.label")} />
      <div className={MOCK_BODY}>
        {done ? (
          <div data-walk-pop="" className="rounded-inset border border-border bg-surface p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-success-strong">
              <StatusMark variant="success" size="md" />
              {t("register.doneTitle")}
            </p>
            {/* i18n-exempt: sample shop name used only in marketing mockups */}
            <p className="mt-2 text-sm text-muted">
              {t("register.doneBody", { shop: "Blue Mantis Divers" })}
            </p>
          </div>
        ) : (
          <>
            {/* i18n-exempt: sample shop name used only in marketing mockups */}
            <h3 className={SUB_TITLE_CLASS}>
              {t("register.title", { shop: "Blue Mantis Divers" })}
            </h3>
            <p className="mt-1 text-sm text-muted">{t("register.intro")}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <WalkField label={t("register.nameLabel")} className="col-span-2">
                {/* i18n-exempt: sample diver name used only in marketing mockups */}
                <WalkTyped text="Priya Sharma" delay={300} />
              </WalkField>
              <WalkField label={`${t("register.emailLabel")} ${t("common.optional")}`}>
                {/* i18n-exempt: sample address used only in marketing mockups */}
                <WalkTyped text="priya@example.com" delay={1000} />
              </WalkField>
              <WalkField label={`${t("register.phoneLabel")} ${t("common.optional")}`} />
            </div>
            <p className="mt-4 text-sm font-semibold">{t("register.certHeading")}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <WalkSelect
                label={t("register.agencyLabel")}
                placeholder={t("register.agencyNone")}
                // i18n-exempt: agency name used only in marketing mockups
                value="PADI"
                at={2000}
              />
              <WalkSelect
                label={t("register.levelLabel")}
                placeholder={t("register.levelPlaceholder")}
                // i18n-exempt: certification level used only in marketing mockups
                value="Advanced Open Water"
                at={2600}
              />
              <WalkField
                label={`${t("register.identifierLabel")} ${t("common.optional")}`}
                className="col-span-2"
              >
                {/* i18n-exempt: sample card number used only in marketing mockups */}
                <WalkTyped text="3481926" delay={3000} />
              </WalkField>
            </div>
            <p className="mt-4 text-sm font-semibold">{t("register.sizesHeading")}</p>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <WalkField label={`${t("register.wetsuitLabel")} ${t("common.optional")}`} />
              <WalkField label={`${t("register.bootLabel")} ${t("common.optional")}`} />
              <WalkField label={`${t("register.finLabel")} ${t("common.optional")}`} />
            </div>
            <button
              type="button"
              disabled
              data-tap-target=""
              className={`mt-4 w-full ${MOCK_PRIMARY_BUTTON}`}
            >
              {t("register.submit")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
