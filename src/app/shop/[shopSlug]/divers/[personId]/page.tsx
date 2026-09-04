import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EarnedMomentLine } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { UndoToast } from "@/components/UndoToast";
import {
  canPersonDeleteDiver,
  canPersonErasePersonalData,
  canPersonMergeDiver,
  canPersonOverrideGearRequest,
  canPersonReadMedicalClearanceDocument,
} from "@/db/authz";
import { listDiverMergeCandidates } from "@/db/diver-merge";
import { getDiverProfile } from "@/db/divers";
import { canPersonExportShopData } from "@/db/export";
import { listDiverRecordNotes, pagedDiverActivity } from "@/db/operations";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getSupportNeeds } from "@/db/support-needs";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import { noticeForForm } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { ActivitySection } from "./_components/ActivitySection";
import { BookActivity } from "./_components/BookActivity";
import { CertificationsGroup } from "./_components/CertificationsGroup";
import { DiverHeader } from "./_components/DiverHeader";
import { DiverNotesSection } from "./_components/DiverNotesSection";
import { DiverStatusLedger } from "./_components/DiverStatusLedger";
import { DiverStory } from "./_components/DiverStory";
import { DownloadDiverExportButton } from "./_components/DownloadDiverExportButton";
import { ErasePersonalData } from "./_components/ErasePersonalData";
import { GearAndSizes } from "./_components/GearAndSizes";
import { MergeDiver } from "./_components/MergeDiver";
import { NoticeBanner } from "./_components/NoticeBanner";
import { RemoveDiver } from "./_components/RemoveDiver";
import { RestoreDiver } from "./_components/RestoreDiver";
import { resolveDiverNotice } from "./_components/record-notices";
import { SupportNeedsPanel } from "./_components/SupportNeedsPanel";
import { WaiverGroup } from "./_components/WaiverGroup";
import { bookingIsAhead } from "./_lib/status";
import { diverStatusRows } from "./_lib/status-load";
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

/**
 * **The diver record, which answers one question**: can this diver dive with
 * us, and what's the story so far? (ADR 20260827-people-not-lists, decision 1,
 * closing issue #780; the language is 20260827-clearwater-surface-language.)
 *
 * The composition, top to bottom, and each part is load-bearing:
 *
 * 1. **The masthead** — who this is, how to reach them, and the page's *one*
 *    primary control (Book a departure). `_lib/record-primaries.test.ts` fails
 *    the build if a second joins it.
 * 2. **The status ledger** — the open items, worst first, each with its one
 *    fix. It renders **nothing at all** when the diver is clear, which is the
 *    other pinned rule.
 * 3. **The story** — one chronological ledger of bookings, imported visits and
 *    person-level orders, each row carrying its own money fact.
 * 4. **The file** — inset groups in the settings grammar: certifications,
 *    waiver, gear and sizes, dive support, notes, and the folded activity
 *    trail.
 * 5. **The quiet foot** — the things you do *to* a record: download it, merge a
 *    duplicate, delete it, and (on a deleted record, for an owner only) erase
 *    it.
 *
 * What this replaced: ten stacked sections under a jump nav, four stat tiles
 * restating facts the sections below them already carried, two near-identical
 * certification components, and three divided lists of the same bookings. It
 * led with money, and its heaviest control was Book-an-activity, seven sections
 * down.
 */
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
    /** Which card a box-level refusal is about — see `DiverNotice.cardId`. */
    card?: string;
    edit?: string;
    /** The deleted diver note's text, carried by the land-then-undo redirect. */
    noteBody?: string;
    /** Which page of the Activity group is being read. Not `?page=`: this record has one paged list, and it is not the page. */
    activity?: string;
  }>;
}) {
  const { shopSlug, personId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(personId)) notFound();
  const { notice, undo, cardType, by, gate, form, card, edit, noteBody, activity } =
    await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
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
  // A merged-away record is intentionally still a pointer, not a second
  // profile. Follow it before loading any of the old record's sections so a
  // stale bookmark cannot make a staffer act on the source row again.
  if (diver.person.mergedIntoPersonId) {
    redirect(`/shop/${shopSlug}/divers/${diver.person.mergedIntoPersonId}`);
  }
  const removed = Boolean(diver.person.deletedAt);
  const now = nowDate();
  // Diver deletion and merging are owner/manager only (H-14, ADR
  // 20260724-role-authorization); hide those controls from other staff. The
  // server actions re-check regardless — hiding is a courtesy, not the gate.
  // Rewriting a diver's stated rental fit is instructor/divemaster/manager work
  // (H-06); flagging them for hands-on fitting stays open to all staff.
  // Erasing a diver's personal and medical data is stricter still — owner only,
  // one way, and never offered to anyone else (ADR 20260802-diver-data-erasure).
  const [
    canDelete,
    canMerge,
    canOverrideFit,
    canErase,
    canExport,
    canOpenClearance,
    stripeAccount,
    notes,
    activityPage,
    supportNeeds,
    status,
  ] = await Promise.all([
    canPersonDeleteDiver(db, shop.id, session.user.personId),
    canPersonMergeDiver(db, shop.id, session.user.personId),
    canPersonOverrideGearRequest(db, shop.id, session.user.personId),
    canPersonErasePersonalData(db, shop.id, session.user.personId),
    // Same owner/manager gate the shop-wide export uses (issue #726) — a
    // subject-access request properly goes through the same door as the
    // shop's own copy of everything, re-checked against the database like
    // the other roles on this page.
    canPersonExportShopData(db, shop.id, session.user.personId),
    // The physician's evaluation itself (issue #1283). Owner/manager, and
    // deliberately not the staff who may *record* a clearance — the reasoning
    // is at `canReadMedicalClearanceDocument`. Hiding the link is a courtesy;
    // the route re-checks the same live roles before it signs anything.
    canPersonReadMedicalClearanceDocument(db, shop.id, session.user.personId),
    getShopStripeAccount(db, shop.id),
    listDiverRecordNotes(db, shop.id, personId),
    // Shop-scoped from the session, never the slug, like every read on this
    // page. A non-numeric `?activity=` reads as page 1 and the query clamps
    // anything past the end, so a stale bookmark lands on the last real page.
    pagedDiverActivity(db, shop.id, personId, { page: Number.parseInt(activity ?? "", 10) }),
    getSupportNeeds(db, shop.id, personId),
    // The readiness of the departure this diver is next on, read through the
    // entry the Today queue and the manifest already use — never a second
    // detector (`_lib/status-load.ts`).
    diverStatusRows(db, shop.id, diver, now),
  ]);
  const mergeCandidates =
    canMerge && !removed ? await listDiverMergeCandidates(db, shop.id, personId) : [];
  // `orders/new` refuses outright without a payable account, so the story's
  // foot simply omits "+ New invoice" rather than offering a link that bounces.
  // Connecting payments is a Settings errand and left this page with the ADR.
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
   * The page's `?notice=` resolved once, to words *and* to the group those
   * words belong beside. Each group is handed its own below with
   * `noticeForForm`; `pageNotice` is what is left over — a refusal that
   * bounced the staffer here from somewhere else, or one whose group this
   * staffer's role means the page never rendered.
   */
  const diverNotice = resolveDiverNotice({ notice, form, gate, card, personId, locale });
  const detailsStatus = noticeForForm(diverNotice, "details");
  const pageNotice = noticeForForm(diverNotice, "page");
  // A card deletion with its undo capability has one outcome: the toast. The
  // `card-deleted` notice remains a cards fallback for an old or malformed link
  // that has no undo payload, but showing both on the normal path repeats the
  // same confirmation in two places.
  const cardRemovalUndo = notice === "card-deleted" && undo && cardType;
  const cardsStatus = cardRemovalUndo ? undefined : noticeForForm(diverNotice, "cards");
  const diverNoteRemovalUndo = notice === "note-deleted" && noteBody;
  const notesStatus = diverNoteRemovalUndo ? undefined : noticeForForm(diverNotice, "notes");
  // **The record's one earned moment**, and the only accent ink this page may
  // carry (20260827-clearwater-surface-language, decision 11). Derived by the
  // action that redirected here — from a post-mutation `buildDiverStatus` that
  // came back empty — and stripped out of the URL by `FlashParams`, so a
  // reload never re-celebrates it.
  const cleared = detailsStatus?.code === "diver-clear" ? detailsStatus : undefined;
  // Times out with this shop: a seat that has sailed plus the visits the
  // importer brought across. Shares `bookingIsAhead`'s late-arrival buffer, so
  // the boat somebody is still boarding is not counted as a visit yet.
  const visits =
    diver.bookings.filter(
      (entry) => entry.booking.status !== "cancelled" && !bookingIsAhead(entry, now),
    ).length + diver.priorVisits.length;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "undo", "cardType", "by", "form", "edit", "noteBody"]} />
      <DiverHeader
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        t={t}
        visits={visits}
        status={cleared ? undefined : detailsStatus}
        moment={
          cleared ? (
            <EarnedMomentLine className="-mt-4 mb-4">
              {t("divers.notices.cleared", { name: diver.person.fullName })}
            </EarnedMomentLine>
          ) : null
        }
        // No new bookings for a removed diver: seating one would walk them
        // straight back onto a manifest and a prep list without anybody
        // deciding to restore them. Their existing story still shows — removal
        // takes a person off the lists, it does not rewrite what happened.
        book={
          removed ? null : (
            <BookActivity
              locale={locale}
              t={t}
              diver={diver}
              shop={shop}
              upcoming={upcoming}
              shopSlug={shopSlug}
              personId={personId}
              status={noticeForForm(diverNotice, "book")}
            />
          )
        }
        // Only ever set by the roster's "Add a diver" form, which lands here
        // with a name and little else. `FlashParams` strips it from the URL
        // straight away, so a reload or a shared link is the ordinary
        // collapsed page. Keep the editor open for a refused save so the
        // staffer can correct the fields in place.
        editOpen={edit === "1" || detailsStatus?.tone === "danger"}
      />
      {removed ? (
        <RestoreDiver
          shopSlug={shopSlug}
          personId={personId}
          canRestore={canDelete}
          t={t}
          status={noticeForForm(diverNotice, "restore")}
        />
      ) : null}
      {cardRemovalUndo ? (
        <UndoToast
          message={t("divers.notices.cardRemovedToast", {
            name: by ?? t("divers.certifications.noCertificationClearedByUnknown"),
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
        <NoticeBanner notice={pageNotice} />
      )}
      <DiverStatusLedger
        rows={status}
        t={t}
        locale={locale}
        timezone={shop.timezone}
        shopSlug={shopSlug}
      />
      <DiverStory
        diver={diver}
        shop={shop}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        t={t}
        paymentsConnected={paymentsConnected}
        status={noticeForForm(diverNotice, "story")}
        now={now}
      />
      <CertificationsGroup
        diver={diver}
        shop={shop}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        t={t}
        status={cardsStatus}
      />
      <WaiverGroup
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        t={t}
        timezone={shop.timezone}
        canOpenClearance={canOpenClearance}
        status={noticeForForm(diverNotice, "waiver")}
      />
      <GearAndSizes
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        rentalItems={shop.rentalItems}
        canOverride={canOverrideFit}
        locale={locale}
        t={t}
        status={noticeForForm(diverNotice, "fit")}
      />
      <DiverNotesSection
        notes={notes}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        timezone={shop.timezone}
        t={t}
        status={notesStatus}
      />
      {/* After notes in the file, because support is a quieter planning fact
          than the record context staff write for the crew. A staffer arriving
          from the prep panel's link still lands on this group's own #support
          target (issue #1069). */}
      <SupportNeedsPanel
        needs={supportNeeds}
        shopSlug={shopSlug}
        personId={personId}
        canOverride={canOverrideFit}
        t={t}
        status={noticeForForm(diverNotice, "support")}
      />
      <ActivitySection
        page={activityPage}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        timezone={shop.timezone}
        t={t}
      />
      {/* **The quiet foot** — the things you do *to* a record rather than with
          it. Nothing here is primary-weight, and reaching the two destructive
          ones costs a scroll on purpose (ADR 20260802-diver-data-erasure). */}
      <div className="mt-12 space-y-6 border-t border-border pt-8">
        {canMerge && !removed && mergeCandidates.length > 0 ? (
          <MergeDiver
            candidates={mergeCandidates}
            shopSlug={shopSlug}
            personId={personId}
            t={t}
            status={noticeForForm(diverNotice, "merge")}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {canExport ? (
            <DownloadDiverExportButton
              href={`/shop/${shopSlug}/divers/${personId}/export`}
              idleLabel={t("divers.export.downloadButton.idle")}
              acknowledgedLabel={t("divers.export.downloadButton.acknowledged")}
            />
          ) : null}
          {/* Nothing to delete twice: a removed diver gets the Restore panel at
              the top of the record instead. */}
          {canDelete && !removed ? (
            <RemoveDiver
              diver={diver}
              shopSlug={shopSlug}
              personId={personId}
              t={t}
              status={noticeForForm(diverNotice, "remove")}
            />
          ) : null}
        </div>
        {/* **Erasure is offered on a deleted record and nowhere else.** It is
            the one control in the product with no undo, and it used to sit at
            the foot of every diver's record — including the diver a staffer
            opened to take a payment from. Deleting first is the step that makes
            the erase a decision rather than a scroll: it is reversible, it is
            the state an erasure request describes anyway, and it puts the
            record's own "This diver is deleted" panel on screen above the
            control. `erasePersonAction` enforces the same rule, because this
            page's tab may be older than the record's state (ADR
            20260802-diver-data-erasure). */}
        {canErase && removed ? (
          <ErasePersonalData
            diver={diver}
            shopSlug={shopSlug}
            personId={personId}
            locale={locale}
            status={noticeForForm(diverNotice, "erase")}
          />
        ) : null}
      </div>
    </main>
  );
}
