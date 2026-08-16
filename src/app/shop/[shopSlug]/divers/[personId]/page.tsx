import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { JumpNav } from "@/components/JumpNav";
import { UndoToast } from "@/components/UndoToast";
import {
  canPersonDeleteDiver,
  canPersonErasePersonalData,
  canPersonOverrideGearRequest,
  canPersonRefund,
} from "@/db/authz";
import { getDb } from "@/db/client";
import { getDiverProfile } from "@/db/divers";
import { listDiverRecordNotes } from "@/db/operations";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireStaffSession } from "@/lib/session";
import { noticeForForm } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { BookActivity } from "./_components/BookActivity";
import { CertificationCards } from "./_components/CertificationCards";
import { DiverHeader } from "./_components/DiverHeader";
import { DiverNotesSection } from "./_components/DiverNotesSection";
import { DIVER_SECTIONS, DiverSection } from "./_components/DiverSections";
import { ErasePersonalData } from "./_components/ErasePersonalData";
import { NoticeBanner, resolveDiverNotice } from "./_components/NoticeBanner";
import { PaperWaiver } from "./_components/PaperWaiver";
import { PaymentsSection } from "./_components/PaymentsSection";
import { RemoveDiver } from "./_components/RemoveDiver";
import { RentalFit } from "./_components/RentalFit";
import { RestoreDiver } from "./_components/RestoreDiver";
import { ShopHistory } from "./_components/ShopHistory";
import { SpecialtyCards } from "./_components/SpecialtyCards";
import { StatsSummary } from "./_components/StatsSummary";
import { UpcomingTripsSection } from "./_components/UpcomingTripsSection";
import { restoreCardAction, restoreDiverNoteAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Diver — DiveDay" };

/**
 * How many upcoming trips the "book on an upcoming trip" picker scans. Some
 * of the scanned trips get filtered out below (already booked, full), so
 * this is generously larger than what the picker actually shows.
 */
const BOOK_ACTIVITY_TRIP_SCAN_LIMIT = 50;

export default async function DiverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; personId: string }>;
  searchParams: Promise<{
    notice?: string;
    undo?: string;
    cardType?: string;
    by?: string;
    /** Signed, verified against this route's own `personId` — src/lib/trip-admission-gate.ts. */
    gate?: string | string[];
    /** Which form on this page the notice answers — see `resolveDiverNotice`. */
    form?: string;
    edit?: string;
    /** The deleted diver note's text, carried by the land-then-undo redirect. */
    noteBody?: string;
  }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, personId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(personId)) notFound();
  const { notice, undo, cardType, by, gate, form, edit, noteBody } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  // `includeRemoved`: a removed diver's record has to stay reachable, because
  // this page is where the way back lives once the roster's undo toast is gone
  // (`RestoreDiver`). It is a visibility affordance for staff and nothing more —
  // removal still holds everywhere it matters, and this page drops the controls
  // that would put a removed person back into shop work by the back door.
  const diver = shop
    ? await getDiverProfile(db, shop.id, personId, { includeRemoved: true })
    : null;
  if (!shop || !diver) notFound();
  const removed = Boolean(diver.person.deletedAt);
  // Refunds and diver deletion are owner/manager only (H-14, ADR
  // 20260724-role-authorization); hide those controls from other staff. The
  // server actions re-check regardless — hiding is a courtesy, not the gate.
  // Rewriting a diver's stated rental fit is instructor/divemaster/manager work
  // (H-06); flagging them for hands-on fitting stays open to all staff.
  // Erasing a diver's personal and medical data is stricter still — owner only,
  // one way, and never offered to anyone else (ADR 20260802-diver-data-erasure).
  const [canRefund, canDelete, canOverrideFit, canErase, stripeAccount, notes] = await Promise.all([
    canPersonRefund(db, shop.id, session.user.personId),
    canPersonDeleteDiver(db, shop.id, session.user.personId),
    canPersonOverrideGearRequest(db, shop.id, session.user.personId),
    canPersonErasePersonalData(db, shop.id, session.user.personId),
    getShopStripeAccount(db, shop.id),
    listDiverRecordNotes(db, shop.id, personId),
  ]);
  // `orders/new` refuses outright without a payable account, so the Payments
  // section offers "Connect payments" rather than invoice buttons that bounce.
  const paymentsConnected = canAcceptPayments(stripeAccount);
  const { trips: scannedTrips } = await pagedUpcomingTripsWithCounts(db, shop.id, {
    limit: BOOK_ACTIVITY_TRIP_SCAN_LIMIT,
  });
  const upcoming = scannedTrips.filter(
    (trip) =>
      !diver.bookings.some(
        ({ booking }) => booking.tripId === trip.id && booking.status !== "cancelled",
      ) && trip.booked < trip.capacity,
  );

  /**
   * The page's `?notice=` resolved once, to words *and* to the section those
   * words belong beside. This record is nine independent forms on one very
   * long scroll, and every one of their outcomes used to land in a single
   * banner under the `<h1>` — so saving a rental fit two screens down confirmed
   * it somewhere the staffer was not looking. Each section is handed its own
   * below; `pageNotice` is what is left over (ADR 20260730-staff-copy-localization,
   * and the trip page's `resolveTripNotice`, which this mirrors).
   */
  const diverNotice = resolveDiverNotice({ notice, form, gate, personId, locale });
  const detailsStatus = noticeForForm(diverNotice, "details");
  const pageNotice = noticeForForm(diverNotice, "page");
  // A card deletion with its undo capability has one outcome: the toast. The
  // `card-deleted` notice remains a cards-section fallback for an old or
  // malformed link that has no undo payload, but showing both on the normal
  // path repeats the same confirmation in two places.
  const cardRemovalUndo = notice === "card-deleted" && undo && cardType;
  const cardsStatus = cardRemovalUndo ? undefined : noticeForForm(diverNotice, "cards");
  const diverNoteRemovalUndo = notice === "note-deleted" && noteBody;
  const notesStatus = diverNoteRemovalUndo ? undefined : noticeForForm(diverNotice, "notes");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "undo", "cardType", "by", "form", "edit", "noteBody"]} />
      <DiverHeader
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        status={detailsStatus}
        // Only ever set by the roster's "Add a diver" form, which lands here
        // with a name and little else. `FlashParams` strips it from the URL
        // straight away, so a reload or a shared link is the ordinary
        // collapsed page.
        //
        // A details-form outcome opens it too: the form lives in a collapsed
        // `<details>`, and a refusal rendered inside a shut disclosure is worse
        // than the banner it replaced — invisible rather than merely far away.
        editOpen={edit === "1" || Boolean(detailsStatus)}
      />
      {removed ? (
        <RestoreDiver
          shopSlug={shopSlug}
          personId={personId}
          canRestore={canDelete}
          locale={locale}
          status={noticeForForm(diverNotice, "restore")}
        />
      ) : null}
      {cardRemovalUndo ? (
        <UndoToast
          message={staffTranslator(locale)("divers.notices.cardRemovedToast", {
            name:
              by ??
              staffTranslator(locale)("divers.certifications.noCertificationClearedByUnknown"),
          })}
          action={restoreCardAction.bind(null, shopSlug, personId)}
          fields={{ certificationId: undo, cardType }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : diverNoteRemovalUndo ? (
        <UndoToast
          message={t("divers.notices.noteDeleted")}
          action={restoreDiverNoteAction.bind(null, shopSlug, personId)}
          fields={{ body: noteBody }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : (
        <NoticeBanner notice={pageNotice} shopSlug={shopSlug} locale={locale} />
      )}
      {/* Above the stat cards, not below them: on a 390px phone those three
          cards stack, and a row sitting under them lands ~1,150px down — a spine
          you have to scroll to find is not a spine. */}
      <JumpNav
        ariaLabel={t("divers.subNav.ariaLabel")}
        items={DIVER_SECTIONS.map((section) => ({ id: section.id, label: t(section.labelKey) }))}
        className="mt-8"
      />
      <StatsSummary diver={diver} shop={shop} locale={locale} />
      {/* Beside the stat row it answers, not filed under a section heading of
          its own: the Waiver card is what tells a staffer the release is
          outstanding, so the one thing they can do about it from this page
          belongs directly beneath it. Renders nothing when there is nothing
          to record. */}
      <PaperWaiver
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        status={noticeForForm(diverNotice, "waiver")}
      />
      <DiverSection id="cards">
        <CertificationCards
          diver={diver}
          shopSlug={shopSlug}
          personId={personId}
          shop={shop}
          status={cardsStatus}
        />
        <SpecialtyCards
          diver={diver}
          shopSlug={shopSlug}
          personId={personId}
          shop={shop}
          locale={locale}
          status={noticeForForm(diverNotice, "specialty-cards")}
        />
      </DiverSection>
      <DiverSection id="notes">
        <DiverNotesSection
          notes={notes}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          timezone={shop.timezone}
          status={notesStatus}
        />
      </DiverSection>
      <DiverSection id="fit">
        <RentalFit
          diver={diver}
          shopSlug={shopSlug}
          personId={personId}
          rentalItems={shop.rentalItems}
          canOverride={canOverrideFit}
          locale={locale}
          status={noticeForForm(diverNotice, "fit")}
        />
      </DiverSection>
      {/* Above "Book an activity" deliberately: the errand that brings staff to
          this page in a hurry is a diver standing at the counter with a bill,
          not one browsing next week's boats. Both used to sit below the fold;
          only one of them has somebody waiting. */}
      <DiverSection id="payments">
        <PaymentsSection
          locale={locale}
          diver={diver}
          shop={shop}
          shopSlug={shopSlug}
          personId={personId}
          canRefund={canRefund}
          paymentsConnected={paymentsConnected}
          status={noticeForForm(diverNotice, "payments")}
        />
      </DiverSection>
      <DiverSection id="trips">
        {/* No new bookings for a removed diver: seating one would walk them
            straight back onto a manifest and a prep list without anybody
            deciding to restore them. Their existing trips still show — removal
            takes a person off the lists, it does not rewrite what happened. */}
        {removed ? null : (
          <BookActivity
            locale={locale}
            diver={diver}
            shop={shop}
            upcoming={upcoming}
            shopSlug={shopSlug}
            personId={personId}
            status={noticeForForm(diverNotice, "book-activity")}
          />
        )}
        <UpcomingTripsSection
          diver={diver}
          shop={shop}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          paymentsConnected={paymentsConnected}
        />
      </DiverSection>
      <DiverSection id="history">
        <ShopHistory
          locale={locale}
          diver={diver}
          shop={shop}
          shopSlug={shopSlug}
          personId={personId}
          paymentsConnected={paymentsConnected}
        />
      </DiverSection>
      {/* Nothing to remove twice: a removed diver gets the Restore card at the
          top of the record instead. Erasure stays offered either way — a
          removed diver is exactly who an erasure request tends to name. */}
      {canDelete && !removed ? (
        <RemoveDiver
          diver={diver}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          status={noticeForForm(diverNotice, "remove")}
        />
      ) : null}
      {canErase ? (
        <ErasePersonalData
          diver={diver}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          status={noticeForForm(diverNotice, "erase")}
        />
      ) : null}
    </main>
  );
}
