import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { restorePersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

/**
 * **The way back from a removal, on the record itself.**
 *
 * Removal was always reversible in the data — `restoreDiver` has worked from
 * the start — but the only way to reach it was the undo toast on the roster,
 * which is gone in twelve seconds. After that the diver matched no search, sat
 * in no view, and their record 404'd: a shop owner who removed the wrong person
 * on Tuesday had no way to put them back on Wednesday.
 *
 * Rendered at the top of the record, above everything a staffer might act on,
 * because the first thing to know about this page is that the person it
 * describes is off every list. Restoring takes the same owner/manager gate as
 * the removal it reverses (H-14); anyone else gets the record and the reason
 * they cannot act on it, rather than a button that bounces.
 */
export function RestoreDiver({
  shopSlug,
  personId,
  canRestore,
  t,
  status,
}: {
  shopSlug: string;
  personId: string;
  /** Owner/manager, same gate as removal. The action re-checks regardless. */
  canRestore: boolean;
  /**
   * This card's own outcome. A restore that was refused — an active diver now
   * holds this one's email — has to answer the button that tried it, and this
   * card sits at the top of the record precisely because it is what a staffer
   * is looking at when they press it.
   */
  status?: DiverNotice;
  t: StaffTranslator;
}) {
  return (
    <section
      aria-labelledby="removed-heading"
      className="mt-6 scroll-mt-24 rounded-panel border border-warning/40 bg-warning/5 p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="warning">{t("divers.removed.badge")}</Badge>
        <h2 id="removed-heading" className="scroll-mt-24 text-sm font-semibold">
          {t("divers.removed.heading")}
        </h2>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t("divers.removed.body")}</p>
      {canRestore ? (
        <form
          action={restorePersonAction.bind(null, shopSlug, personId)}
          className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <SubmitButton pendingLabel={t("divers.removed.restoring")} className={buttonClass()}>
            {t("divers.removed.restore")}
          </SubmitButton>
          <DiverFormStatus status={status} />
        </form>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">{t("divers.removed.restoreRestricted")}</p>
          <DiverFormStatus status={status} className="mt-3" />
        </>
      )}
    </section>
  );
}
