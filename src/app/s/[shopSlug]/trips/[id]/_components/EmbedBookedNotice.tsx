import Link from "next/link";
import { EarnedMoment } from "@/components/EarnedMoment";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { publicSchedulePath } from "@/lib/public-routes";
import type { Confirmed, Shop, Trip } from "./types";

/**
 * What a diver sees after booking **inside the embed widget**, and nowhere
 * else. Everywhere else a booking redirects straight to the diver's own
 * `/ready` page, which is the one page after booking (ADR
 * 20260820-one-page-after-booking).
 *
 * The embed is the one place that honestly needs a second surface. `?embed=1`
 * is an iframe on a shop's own website (ADR 20260726-schedule-embed), and
 * `/ready/**` is deliberately outside the framing allowlist — so a redirect
 * there would hand the shop's visitor a frame the CSP blocks instead of a
 * confirmation. A server action cannot navigate the top-level window, so the
 * frame stays put and this says the two things that cannot wait: the seat is
 * taken, and here is the door out to everything else.
 *
 * Everything the old confirmation panel carried in here — the waiver step, the
 * payment forms, the rental fit, the party claim links — is one `target="_top"`
 * tap away on `/ready`, where it is not competing with a shop's own page for a
 * few hundred pixels of iframe. The waiver was already excluded from the embed
 * for the same framing reason, so it is the only one that loses nothing at all.
 */
export function EmbedBookedNotice({
  shop,
  shopSlug,
  locale,
  trip,
  confirmed,
  readinessLink,
  emailsOnTheWay,
  payCancelled,
  paymentUrl = null,
}: {
  shop: Shop;
  shopSlug: string;
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  trip: Trip;
  confirmed: Confirmed;
  /**
   * The diver backed out of the hosted payment page and Stripe returned them
   * here. The seat was committed before checkout ever started, so the one thing
   * worth saying is that it survived — the balance itself is on `/ready`, where
   * every other payment state now lives.
   */
  payCancelled: boolean;
  /**
   * Path to `./ready/route.ts`, which trades this booking's `confirm` token for
   * a readiness capability and redirects. A path rather than a minted
   * `/ready/[token]` on purpose — see the note where the page builds it.
   */
  readinessLink: string;
  /**
   * True only when this booking's confirmation email *and* its waiver-link
   * email both actually went out. A walk-in party member with no address of
   * their own gets neither, so the page must not promise them — see
   * `bookingConfirmationAndWaiverEmailsSent`.
   */
  emailsOnTheWay: boolean;
  /**
   * The hosted Stripe page for this booking, when paying was part of booking
   * and the diver is inside the embed — where that page cannot be framed, so
   * the frame says so and opens it at the top level (ADR
   * 20260901-diveday-reimagined, decision 2: the lightbox's payment "still
   * opens the real page, stated"). Null when nothing is owed, or after the
   * diver came back from Stripe.
   */
  paymentUrl?: string | null;
}) {
  const t = diverTranslator(locale);
  return (
    <>
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

      {/* Two messages land within seconds of each other; saying so up front
          stops the second one reading as a duplicate or a mistake. Claimed
          only when both actually left the building. */}
      {emailsOnTheWay ? (
        <p className="mt-3 text-sm text-muted">{t("booking.emailsOnTheWay")}</p>
      ) : null}

      {payCancelled ? (
        <p className="mt-3 text-sm text-muted">{t("booking.paymentStillOpen")}</p>
      ) : null}

      {/* Paying is the one thing this frame cannot do itself. Said in words,
          and the door is the page's primary — above the readiness link, which
          is where the balance lives if the diver leaves this for later. */}
      {paymentUrl ? (
        <div className="mt-4">
          <p className="text-sm text-muted">{t("booking.embedPayNext")}</p>
          <a href={paymentUrl} target="_top" className={`${buttonClass()} mt-3`}>
            {t("booking.continueToPayment")}
          </a>
        </div>
      ) : null}

      {/* The two ways onward, in the order they matter: out to everything this
          seat still needs, then back into the widget itself.

          `_top`, always, on the first: `/ready/[token]` isn't in the embed
          framing allowlist (ADR 20260726-schedule-embed), so a same-frame click
          would swap the working widget for a frame Content-Security-Policy
          silently blocks. The second stays inside the frame, and carries
          `embed=1` so the schedule doesn't reload into full page chrome.

          A bare `<a>` rather than `next/link` for the first: it leaves the app
          either way, and `next/link` would *prefetch* the route — which mints a
          capability, putting us straight back to the per-render minting this
          route exists to stop. */}
      <div className="mt-4 flex flex-col items-start gap-2">
        <a
          href={readinessLink}
          target="_top"
          className="inline-flex min-h-11 items-center text-base font-semibold text-primary hover:underline"
        >
          {t("booking.trackReadiness")}
        </a>
        <Link
          href={`${publicSchedulePath(shopSlug)}?embed=1`}
          className="inline-flex min-h-11 items-center text-base font-medium text-primary hover:underline"
        >
          {t("common.backToSchedule")}
        </Link>
      </div>
    </>
  );
}
