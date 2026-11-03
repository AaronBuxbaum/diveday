import { undoAction } from "@/app/actions/undo";
import { UndoToast } from "@/components/UndoToast";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { UndoOffer } from "@/lib/undo";

/**
 * **The Undo a removal declared** (issue #2764), drawn the one way every such
 * Undo is drawn: the page reads the offer its landing carried
 * (`readUndoOffer(searchParams)`) and renders this, which says what was
 * removed and posts the same offer back to the one `undoAction`. A page adds
 * no inverse action, no hidden fields and no toast wiring of its own.
 *
 * The words are the kind's, chosen here because this is the renderer; `by` is
 * the name of whoever removed a card, when the landing carried it.
 */
export function OfferedUndo({
  shopSlug,
  offer,
  by,
  t,
}: {
  shopSlug: string;
  offer: UndoOffer;
  by?: string;
  t: StaffTranslator;
}) {
  return (
    <UndoToast
      message={undoMessage(offer, by, t)}
      action={undoAction.bind(null, shopSlug)}
      fields={{ ...offer }}
      pendingLabel={t("shared.undoToast.pendingLabel")}
      undoLabel={t("shared.undoToast.undo")}
      dismissLabel={t("shared.undoToast.dismiss")}
    />
  );
}

function undoMessage(offer: UndoOffer, by: string | undefined, t: StaffTranslator): string {
  switch (offer.undo) {
    case "diver-card":
      return t("divers.notices.cardRemovedToast", {
        name: by ?? t("divers.certifications.noCertificationClearedByUnknown"),
      });
    case "diver-note":
      return t("divers.notices.noteDeleted");
    case "diver-removal":
      return t("divers.page.removedToast");
  }
}
