import type { ComponentProps } from "react";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { noticeForForm } from "@/lib/staff-notices";
import { ErasePersonalData } from "./ErasePersonalData";
import { GuardianEmailErasure } from "./GuardianEmailErasure";
import { MergeDiver } from "./MergeDiver";
import type { DiverNotice } from "./NoticeBanner";
import { RemoveDiver } from "./RemoveDiver";
import type { DiverProfile } from "./shared";

/**
 * The foot of a diver's record: merge, the guardian's address, delete
 * and erase, each present only for a staffer the page has already cleared for
 * it. Moved out of the route file whole, so the page reads as the record and
 * this reads as what you do *to* it.
 */
export function DiverRecordFoot({
  diver,
  shopSlug,
  personId,
  locale,
  t,
  notice,
  removed,
  mergeCandidates,
  guardianEmails,
  canErase,
  canDelete,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
  t: StaffTranslator;
  notice: DiverNotice | undefined;
  removed: boolean;
  /** Empty unless this staffer may merge and the record is live. */
  mergeCandidates: ComponentProps<typeof MergeDiver>["candidates"];
  /** Null unless this staffer may erase. */
  guardianEmails: string[] | null;
  canErase: boolean;
  canDelete: boolean;
}) {
  // **The quiet foot** — the things you do *to* a record rather than with
  // it. No rule of its own: the file's last hairline already closes the
  // record above it, and a second one 48px lower read as a stray line.
  // Nothing here is primary-weight, and reaching the two destructive ones
  // costs a scroll on purpose (ADR 20260802-diver-data-erasure).
  return (
    <div className="mt-10 space-y-6">
      {mergeCandidates.length > 0 ? (
        <MergeDiver
          candidates={mergeCandidates}
          shopSlug={shopSlug}
          personId={personId}
          t={t}
          status={noticeForForm(notice, "merge")}
        />
      ) : null}
      {guardianEmails ? (
        <GuardianEmailErasure
          emails={guardianEmails}
          shopSlug={shopSlug}
          personId={personId}
          locale={locale}
          status={noticeForForm(notice, "guardian-email")}
        />
      ) : null}
      {/* Delete on a line of its own. "Download record" moved to the
          header's action row (visual review 2026-10-24, A12), so it is no
          longer one slip from this red one (UX review 2026-10-10, item 37).
          Nothing to delete twice: a removed diver gets the Restore panel at
          the top of the record instead. */}
      {canDelete && !removed ? (
        <RemoveDiver
          diver={diver}
          shopSlug={shopSlug}
          personId={personId}
          t={t}
          status={noticeForForm(notice, "remove")}
        />
      ) : null}
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
          status={noticeForForm(notice, "erase")}
        />
      ) : null}
    </div>
  );
}
