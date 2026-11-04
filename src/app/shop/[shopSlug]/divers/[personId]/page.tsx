import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { DownloadAcknowledgmentLink } from "@/components/DownloadAcknowledgmentLink";
import { EarnedMomentLine } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { getDiverRecord } from "@/db/diver-record";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { resolveDiverNotice } from "@/lib/diver-notices";
import { diverStanding } from "@/lib/diver-standing";
import { splitDiverStatus } from "@/lib/diver-status";
import { requireShopSurface } from "@/lib/session";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { readUndoOffer } from "@/lib/undo";
import { uuidParam } from "@/lib/uuid";
import { OfferedUndo } from "../../_components/OfferedUndo";
import { BookActivity } from "./_components/BookActivity";
import { DiverFile } from "./_components/DiverFile";
import { DiverHeader } from "./_components/DiverHeader";
import { DiverRecordFoot } from "./_components/DiverRecordFoot";
import { DiverStatusLedger } from "./_components/DiverStatusLedger";
import { DiverStory } from "./_components/DiverStory";
import { FoundItemLine } from "./_components/FoundItemLine";
import { NoticeBanner } from "./_components/NoticeBanner";
import { RestoreDiver } from "./_components/RestoreDiver";
import { bookingPageNumber, DIVER_RECORD_FLASH_PARAMS } from "./_lib/record-query";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Diver — DiveDay" };

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
 * 2. **The status ledger** — the open items the file below cannot hold
 *    (money, a seat to change on its departure), worst first, each with its
 *    one fix. A gap whose fix is in a file row's door — a missing contact, an
 *    unsigned release, a card to add or verify — is said by that row instead
 *    (`splitDiverStatus`), so nothing on the record is named twice. It renders
 *    **nothing at all** when there is nothing to hold, which is the other
 *    pinned rule.
 * 3. **The file** — inset groups in the settings grammar: waiver,
 *    certifications, contact details, conversation, gear and sizes, notes, and
 *    the folded activity trail — the boarding gates first, worst first. A row with a gap wears it: its fact in warning ink, or danger when
 *    the gap keeps the diver off a departure, with that departure beneath.
 * 4. **The story** — one chronological ledger of bookings, imported visits and
 *    person-level orders, each row carrying its own money fact.
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
    /** The Undo the last removal offered (`src/lib/undo.ts`), with its payload fields. */
    undo?: string;
    undoPerson?: string;
    undoCard?: string;
    cardType?: string;
    undoFrom?: string;
    by?: string;
    /** Signed, verified against this route's own `personId` — src/lib/trip-admission-gate.ts. */
    gate?: string | string[];
    /** Which form on this page the notice answers — see `resolveDiverNotice`. */
    form?: string;
    /** Which card a box-level refusal is about — see `DiverNotice.cardId`. */
    card?: string;
    edit?: string;
    /** The deleted diver note's id, carried by its Undo offer (never its text, #3701). */
    undoNote?: string;
    /** Which page of the Activity group is being read, independent of the booking picker. */
    activity?: string;
    /** Which page of eligible departures is open inside Add a booking. */
    bookingPage?: string | string[];
  }>;
}) {
  const { shopSlug, personId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(personId)) notFound();
  const query = await searchParams;
  const { notice, by, gate, form, card, edit, activity, bookingPage } = query;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const now = nowDate();
  // Shop-scoped from the session, never the slug (`getDiverRecord`). A removed
  // diver's record stays reachable: it is where the way back lives
  // (`RestoreDiver`), and this page drops the controls that would put a removed
  // person back into shop work by the back door.
  const record = await getDiverRecord(db, shop, personId, {
    viewerPersonId: session.user.personId,
    activityPage: Number.parseInt(activity ?? "", 10),
    bookingPage: bookingPageNumber(bookingPage),
    now,
  });
  if (!record) notFound();
  // A merged-away record is a pointer, not a second profile: follow it.
  if (record.kind === "merged") redirect(shopPath(shopSlug, "divers", record.mergedInto));
  const {
    diver,
    removed,
    can: {
      canDelete,
      canMerge,
      canOverrideFit,
      canErase,
      canExport,
      canOpenClearance,
      canManageOrders,
    },
    paymentsConnected,
    collectHasSomewhereToGo,
    notes,
    activityPage,
    thread,
    gear,
    packages,
    mergeCandidates,
    status,
    departures,
    guardianEmails,
    found,
    lastDive,
  } = record;
  /**
   * The page's `?notice=` resolved once, to words *and* to the group those
   * words belong beside. Each group is handed its own below with
   * `noticeForForm`; `pageNotice` is what is left over — a refusal that
   * bounced the staffer here from somewhere else, or one whose group this
   * staffer's role means the page never rendered.
   */
  const diverNotice = resolveDiverNotice({
    notice,
    form,
    gate,
    card,
    personId,
    personName: diver.person.fullName,
    locale,
    canRaiseInvoice: collectHasSomewhereToGo,
  });
  const detailsStatus = noticeForForm(diverNotice, "details");
  // Each gap is said once: by its own file row when the fix is in that row's
  // door, and in the ledger above the story only when it is not (money, or a
  // seat to change on its departure).
  const gaps = splitDiverStatus(status);
  const pageNotice = noticeForForm(diverNotice, "page");
  // A removal that offered Undo has one outcome: the toast. The `card-deleted`
  // and `note-deleted` notices remain their sections' fallback for an old or
  // malformed link that carries no offer, but showing both on the normal path
  // repeats the same confirmation in two places. Only this record's own
  // offers are drawn here.
  const offered = readUndoOffer(query);
  const undo =
    offered?.undoPerson === personId &&
    ((offered.undo === "diver-card" && notice === "card-deleted") ||
      (offered.undo === "diver-note" && notice === "note-deleted"))
      ? offered
      : null;
  const cardsStatus = undo?.undo === "diver-card" ? undefined : noticeForForm(diverNotice, "cards");
  const notesStatus = undo?.undo === "diver-note" ? undefined : noticeForForm(diverNotice, "notes");
  // **The record's one earned moment**, and the only accent ink this page may
  // carry (20260827-clearwater-surface-language, decision 11). Derived by the
  // action that redirected here — from a post-mutation `buildDiverStatus` that
  // came back empty — and stripped out of the URL by `FlashParams`, so a
  // reload never re-celebrates it.
  const cleared = detailsStatus?.code === "diver-clear" ? detailsStatus : undefined;
  // Who this person is to the shop, in one line (item 36); money only for a reader who may see it.
  const standing = diverStanding(diver, { now, shop, showMoney: canManageOrders });
  return (
    <StaffPage width="reading">
      <FlashParams params={DIVER_RECORD_FLASH_PARAMS} />
      <DiverHeader
        diver={diver}
        t={t}
        standing={standing}
        locale={locale}
        packages={packages}
        status={cleared ? undefined : detailsStatus}
        download={
          canExport ? (
            <DownloadAcknowledgmentLink
              href={`/shop/${shopSlug}/divers/${personId}/export`}
              idleLabel={t("divers.export.downloadButton.idle")}
              acknowledgedLabel={t("divers.export.downloadButton.acknowledged")}
              variant="secondary"
            />
          ) : null
        }
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
              upcoming={departures.trips}
              pagination={departures}
              query={query}
              shopSlug={shopSlug}
              personId={personId}
              status={noticeForForm(diverNotice, "book")}
            />
          )
        }
      />
      <FoundItemLine shopSlug={shopSlug} items={found.get(personId) ?? []} t={t} />
      {removed ? (
        <RestoreDiver
          shopSlug={shopSlug}
          personId={personId}
          canRestore={canDelete}
          t={t}
          status={noticeForForm(diverNotice, "restore")}
        />
      ) : null}
      {undo ? (
        <OfferedUndo shopSlug={shopSlug} offer={undo} by={by} t={t} />
      ) : (
        <NoticeBanner notice={pageNotice} />
      )}
      <DiverStatusLedger
        rows={gaps.ledger}
        t={t}
        locale={locale}
        timezone={shop.timezone}
        shopSlug={shopSlug}
      />
      {/* **One rhythm, owned here.** The file and the story are the record's
          two sections, and they stack on this wrapper's `space-y-10`
          (forms-and-controls.md, "Section rhythm"). A group that renders
          nothing (a diver who never wrote, an empty activity log) takes no
          row in the file.

          **The file comes first** because it is where a gap is said now
          (`splitDiverStatus`): a release that keeps the diver off Friday's
          boat is the first thing under the masthead, in its own row with its
          own door, rather than a ledger line pointing at a row below a long
          story. */}
      <div className="mt-10 space-y-10">
        {/* **The file is one list**, one row per group (`DiverFile`). */}
        <DiverFile
          diver={diver}
          shop={shop}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          t={t}
          now={now}
          removed={removed}
          edit={edit}
          notice={diverNotice}
          statuses={{ cards: cardsStatus, details: detailsStatus, notes: notesStatus }}
          gaps={gaps}
          gates={{ canOpenClearance, canOverrideFit }}
          gear={gear}
          thread={thread}
          notes={notes}
          activityPage={activityPage}
          lastDive={lastDive}
        />
        <DiverStory
          diver={diver}
          shop={shop}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          t={t}
          paymentsConnected={paymentsConnected}
          canManageOrders={canManageOrders}
          offersInvoice
          status={noticeForForm(diverNotice, "story")}
          now={now}
        />
      </div>
      <DiverRecordFoot
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        t={t}
        notice={diverNotice}
        removed={removed}
        mergeCandidates={canMerge && !removed ? mergeCandidates : []}
        guardianEmails={canErase ? guardianEmails : null}
        canErase={canErase}
        canDelete={canDelete}
      />
    </StaffPage>
  );
}
