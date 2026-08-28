import { diverTranslator } from "@/i18n/messages";
import { cancellationDeadline } from "@/lib/deposits";
import { formatDateTimeTz } from "@/lib/format";
import type { Shop, Trip } from "./types";

/**
 * **One sentence under the button: what it costs to change your mind.**
 *
 * ADR 20260827-the-divers-thread, decision 2 — the money resolves in one block
 * above the pay button, so nothing under it may state a figure. This used to
 * carry three lines of arithmetic (the course-fee split, the deposit-versus-
 * balance figures, and the cancellation window), which is half of how the
 * booking card came to say the price five ways; the two money lines belong to
 * `MoneyBlock` now and the window is all that is left, because it is the one
 * term still ahead of a diver who has already decided.
 *
 * A departure that states no window renders nothing at all rather than an
 * apology for the absence: "Cancellation questions? Ask the shop" invented a
 * worry about money nobody had handed over, and where it is genuinely useful —
 * a deposit-taking trip with no published window — the page's own contact line
 * below the form answers it in the same words for every case.
 *
 * The `cancellationOnly` prop is gone with it. It had no caller, and what it
 * selected — this sentence alone — is now the only thing this renders.
 *
 * Server component: the page renders it once and hands the node into
 * `BookSpotSection` (a Client Component) as a prop, so the cancellation
 * arithmetic in `src/lib/deposits.ts` never ships to the browser.
 */
export function TripTerms({ shop, trip, locale }: { shop: Shop; trip: Trip; locale: string }) {
  const t = diverTranslator(locale);
  const deadline = cancellationDeadline(trip);
  if (!deadline) return null;
  return (
    <p className="mt-3 text-sm text-muted">
      {t("trip.freeCancellationUntil", {
        when: formatDateTimeTz(deadline, locale, shop.timezone),
      })}
    </p>
  );
}
