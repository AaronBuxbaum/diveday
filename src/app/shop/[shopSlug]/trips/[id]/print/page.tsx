import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
import { AutoPrint } from "../_components/AutoPrint";
import { PACKET_READY_SELECTOR, PacketReady, TripPacket } from "./_components/TripPacket";

export const metadata: Metadata = {
  title: "Trip packet — DiveDay",
};

// The trip layout owns the blocking staff shell; this page still opts into the
// same instant-navigation contract as the four tabs it composes.
export const instant = true;

/**
 * **The browser-print packet for a departure: a document, not four live pages
 * stacked.**
 *
 * It used to compose all four human-facing trip tabs. Under print media that
 * left **42 buttons, 9 selects, 48 inputs and 13 textareas** on the sheet a
 * captain carries — including "Cancel trip", "Remove booking" nine times over,
 * and a bare "×" (issue #814). `docs/design/principles.md` §6 asks for "print
 * output as considered as screen output", and a rectangle labelled "Cancel
 * trip" beside a roster is not that.
 *
 * Two of the four tabs are working pages rather than documents, and they were
 * the whole problem — I attributed every control before changing anything:
 *
 * - **Overview** held 8 buttons, all 9 selects and most of the inputs, because
 *   it *is* the trip's edit form. Its facts existed only inside form controls,
 *   which is why hiding controls alone would have taken the dive plan off the
 *   sheet with them. `PacketDives` renders those facts as words instead, from
 *   the same reader the Overview page uses.
 * - **Guests** held the other 34. It contributes nothing to paper: the
 *   manifest section below already prints the same roster read-only, with each
 *   diver's emergency contact and the head count. What Guests uniquely offers
 *   is actions — send a waiver, remove a booking, save a contact — and none of
 *   those can happen on paper.
 *
 * **Manifest and Prep contribute zero controls** and are composed unchanged:
 * their own pages already carry `print:hidden` where it matters, and each stays
 * the source of truth for its facts so the packet cannot drift from the screen
 * staff just reviewed.
 *
 * A rule in `globals.css` scoped to `.trip-print-bundle` hides any control that
 * ever reaches this page again. It is a backstop rather than the fix, and it is
 * only safe *because* of the above: with the two form-bearing tabs gone,
 * nothing value-bearing is left inside a control, so hiding one loses nothing.
 * `e2e/trips.spec.ts` asserts the count is zero under print emulation.
 *
 * The three sections themselves live in {@link TripPacket}, because the day's
 * paper (N-54) prints the same block once per departure and a second assembly
 * of the same facts is exactly what would drift.
 */
export default async function TripPrintPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const resolvedParams = await params;
  const { id } = resolvedParams;
  const tripId = uuidParam(id);
  if (!tripId) notFound();

  const { shop, session } = await requireShopSurface(resolvedParams.shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const packet = await TripPacket({
    shopSlug: resolvedParams.shopSlug,
    shop,
    tripId,
    actorPersonId: session.user.personId,
    locale,
    t,
  });
  // The same answer the Overview page gives a trip that is gone or another
  // shop's — the reader is scoped by the shop this surface already resolved.
  if (!packet) notFound();

  return (
    <div className="trip-print-bundle">
      {/* The marker the packet itself renders. It used to wait on the Guests
          tab's `data-trip-guests-ready`, which this document has not composed
          since #814 — so every print sat out `AutoPrint`'s five-second
          fallback before the dialog opened. */}
      <AutoPrint readySelector={PACKET_READY_SELECTOR} />
      <header className="mb-10 border-b border-border pb-6 print:mb-6">
        <p className={EYEBROW_CLASS}>DiveDay</p>
        <h1 className={`mt-2 ${SHELL_TITLE_CLASS}`}>{t("shared.printPacket.title")}</h1>
      </header>
      {packet}
      <PacketReady />
    </div>
  );
}
