import Link from "next/link";
import { DiverSheet } from "@/components/DiverSheet";
import { getDb } from "@/db/client";
import { getDiverProfile } from "@/db/divers";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { displayStoredPhone } from "@/lib/forgiving-fields";
import { shopPath } from "@/lib/staff-notices";
import { DiverStatusLedger } from "../divers/[personId]/_components/DiverStatusLedger";
import { DiverStory } from "../divers/[personId]/_components/DiverStory";
import type { Shop } from "../divers/[personId]/_components/shared";
import { diverStatusRows } from "../divers/[personId]/_lib/status-load";

/**
 * **The diver the search found, laid over the day.**
 *
 * Tide files everything under an hour and a diver with no booking has none, so
 * the search is the one door that does not start from a time (ADR
 * 20260919-one-idea, decision I · Tide). Answering it by navigating to the
 * record would cost the staffer the day they were reading — the boats, the
 * blockers, the hour they were standing in — to answer a question that is
 * usually one glance. This lays the person over it instead.
 *
 * **The same reads the record does, not a second narrower set.** `getDiverProfile`
 * and `diverStatusRows` are what `/divers/[personId]` runs, and `DiverStory` and
 * `DiverStatusLedger` are the components it renders — so a diver's standing
 * cannot read one way in the sheet and another on their page. It costs what the
 * record costs, which is why the day page gives it a `<Suspense>` of its own:
 * joining the reads the spine is already waiting on would blank the day to a
 * skeleton every time a staffer glanced at somebody.
 *
 * Returns nothing for an id that names no diver of this shop, which is also
 * the answer for a hand-typed `?diver=`: the day renders, with no sheet.
 */
export async function DiverSheetSection({
  shop,
  personId,
  locale,
}: {
  /** The session's own shop row, slug included — never resolved from the URL. */
  shop: Shop;
  /** Already validated as a UUID by the page above. */
  personId: string;
  locale: string;
}) {
  const db = await getDb();
  const diver = await getDiverProfile(db, shop.id, personId);
  if (!diver) return null;

  const t = staffTranslator(locale);
  const now = nowDate();
  const [status, stripeAccount] = await Promise.all([
    diverStatusRows(db, shop.id, diver, now),
    getShopStripeAccount(db, shop.id),
  ]);

  const recordPath = shopPath(shop.slug, "divers", personId);
  // The record's own spelling of a stored number, not the raw E.164 column:
  // "+13055550230" is what the database holds and not what anybody reads.
  const reach = [diver.person.email, displayStoredPhone(diver.person.phone)]
    .filter(Boolean)
    .join(" · ");

  return (
    <DiverSheet
      name={diver.person.fullName}
      subtitle={reach}
      closeLabel={t("shared.diverSheet.close")}
    >
      <DiverStatusLedger
        rows={status}
        t={t}
        locale={locale}
        timezone={shop.timezone}
        shopSlug={shop.slug}
        recordPath={recordPath}
      />
      <DiverStory
        diver={diver}
        shop={shop}
        shopSlug={shop.slug}
        personId={personId}
        locale={locale}
        t={t}
        paymentsConnected={canAcceptPayments(stripeAccount)}
        // **No act at the foot of a reading.** The shop's own answer about
        // payments is passed through unchanged — a sheet must not claim a shop
        // cannot take money — and the one door below is where an act happens.
        // Saying no here is what makes `canManageOrders` unaskable of a sheet
        // that never looked the reader up (issue #1920): the prop is `never` on
        // this arm, so there is no false answer to give.
        offersInvoice={false}
        now={now}
      />
      {/* **The one door out.** Everything this sheet does not hold — the
          certifications, the waiver, the fit, the notes, and every form — is on
          the record, and a form here would redirect with a `?notice=` and take
          the sheet off the screen with it. */}
      <Link
        href={recordPath}
        className="mt-6 inline-flex min-h-11 items-center font-semibold text-primary text-sm hover:underline"
      >
        {t("shared.diverSheet.openRecord")} <span aria-hidden="true">→</span>
      </Link>
    </DiverSheet>
  );
}
